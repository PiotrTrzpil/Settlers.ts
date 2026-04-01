/**
 * IndexedDB persistence layer for the deterministic replay system.
 *
 * Database: `settlers_saves`, version 1
 * Object stores:
 *   - `sessions`  — keyed by `id`, holds SaveSession records
 *   - `keyframes` — keyed by compound `[sessionId, tick]`, holds Keyframe records
 *   - `journals`  — keyed by `sessionId`, holds JournalEntry[] arrays
 *
 * Falls back to localStorage when IndexedDB is unavailable (private browsing
 * on some browsers). Serialization uses superjson for native Map/Set support.
 */

import superjson from 'superjson';
import type { SaveSession, Keyframe, JournalEntry } from './replay-types';

const DB_NAME = 'settlers_saves';
const DB_VERSION = 1;
const MAX_SESSIONS = 3;

const LS_PREFIX = 'settlers_idb_fallback_';
const LS_SESSIONS_KEY = `${LS_PREFIX}sessions`;
const LS_SIZE_WARN_THRESHOLD = 3 * 1024 * 1024; // 3 MB

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('keyframes')) {
                // Compound key: [sessionId, tick]
                db.createObjectStore('keyframes', { keyPath: ['sessionId', 'tick'] });
            }
            if (!db.objectStoreNames.contains('journals')) {
                db.createObjectStore('journals', { keyPath: 'sessionId' });
            }
        };

        request.onsuccess = event => resolve((event.target as IDBOpenDBRequest).result);
        request.onerror = event => reject((event.target as IDBOpenDBRequest).error);
    });
}

function idbGet<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
}

function idbPut(store: IDBObjectStore, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = store.put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function idbDelete(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
    });
}

/** idbGetAll using an explicit key range — used for compound-key stores. */
function idbGetAllByRange<T>(store: IDBObjectStore, range: IDBKeyRange): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const req = store.getAll(range);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
    });
}

// ─── localStorage fallback ───────────────────────────────────────────────────

function lsGet<T>(key: string): T | undefined {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return undefined;
        }
        return superjson.parse<T>(raw);
    } catch {
        return undefined;
    }
}

function lsSet(key: string, value: unknown): void {
    const json = superjson.stringify(value);
    if (json.length > LS_SIZE_WARN_THRESHOLD) {
        console.warn(
            `[IndexedDBStore] localStorage fallback: key "${key}" is ${(json.length / 1024).toFixed(0)} KB — approaching storage limits`
        );
    }
    localStorage.setItem(key, json);
}

function lsDelete(key: string): void {
    localStorage.removeItem(key);
}

function lsKeyframeKey(sessionId: string): string {
    return `${LS_PREFIX}keyframe_${sessionId}`;
}

function lsJournalKey(sessionId: string): string {
    return `${LS_PREFIX}journal_${sessionId}`;
}

// ─── Module state ────────────────────────────────────────────────────────────

/** Opened IndexedDB instance; null means fallback to localStorage. */
let _db: IDBDatabase | null = null;
/** True once open() has been called — prevents double-open. */
let _opened = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Open (or create) the database.
 * Must be called once before any other operations.
 * Falls back to localStorage if IndexedDB is unavailable.
 */
export async function open(): Promise<void> {
    if (_opened) {
        return;
    }
    _opened = true;

    if (typeof indexedDB === 'undefined') {
        console.warn('[IndexedDBStore] IndexedDB unavailable — falling back to localStorage');
        return;
    }

    try {
        _db = await openDatabase();
    } catch (err) {
        console.warn('[IndexedDBStore] Failed to open IndexedDB, falling back to localStorage:', err);
        _db = null;
    }
}

// ─── Session operations ──────────────────────────────────────────────────────

/** Upsert a session record. Auto-prunes oldest sessions when total > MAX_SESSIONS. */
export async function saveSession(session: SaveSession): Promise<void> {
    if (_db) {
        const tx = _db.transaction(['sessions'], 'readwrite');
        await idbPut(tx.objectStore('sessions'), session);
        await pruneSessionsIdb(_db, session.id);
    } else {
        // eslint-disable-next-line no-restricted-syntax -- localStorage may have no sessions yet; [] is correct empty-list default at storage boundary
        const sessions = lsGet<SaveSession[]>(LS_SESSIONS_KEY) ?? [];
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) {
            sessions[idx] = session;
        } else {
            sessions.push(session);
        }
        pruneSessionsLs(sessions, session.id);
        lsSet(LS_SESSIONS_KEY, sessions);
    }
}

/** Get a session by ID. Returns undefined if not found. */
export async function getSession(id: string): Promise<SaveSession | undefined> {
    if (_db) {
        const tx = _db.transaction(['sessions'], 'readonly');
        return idbGet<SaveSession>(tx.objectStore('sessions'), id);
    } else {
        // eslint-disable-next-line no-restricted-syntax -- localStorage may have no sessions yet; [] is correct empty-list default at storage boundary
        const sessions = lsGet<SaveSession[]>(LS_SESSIONS_KEY) ?? [];
        return sessions.find(s => s.id === id);
    }
}

/** Find the most-recently-updated session for a given map. Returns undefined if none. */
export async function getLatestSession(mapId: string): Promise<SaveSession | undefined> {
    const all = await listSessions();
    const forMap = all.filter(s => s.mapId === mapId);
    if (forMap.length === 0) {
        return undefined;
    }
    return forMap.reduce((latest, s) => (s.updatedAt > latest.updatedAt ? s : latest), forMap[0]!);
}

/** List all sessions, sorted newest-first by updatedAt. */
export async function listSessions(): Promise<SaveSession[]> {
    let sessions: SaveSession[];
    if (_db) {
        const tx = _db.transaction(['sessions'], 'readonly');
        sessions = await idbGetAll<SaveSession>(tx.objectStore('sessions'));
    } else {
        // eslint-disable-next-line no-restricted-syntax -- localStorage may have no sessions yet; [] is correct empty-list default at storage boundary
        sessions = lsGet<SaveSession[]>(LS_SESSIONS_KEY) ?? [];
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete a session and all its associated keyframes and journal entries. */
export async function deleteSession(id: string): Promise<void> {
    if (_db) {
        await deleteSessionIdb(_db, id);
    } else {
        deleteSessionLsData(id);
        // eslint-disable-next-line no-restricted-syntax -- localStorage may have no sessions yet; [] is correct empty-list default at storage boundary
        const sessions = lsGet<SaveSession[]>(LS_SESSIONS_KEY) ?? [];
        lsSet(
            LS_SESSIONS_KEY,
            sessions.filter(s => s.id !== id)
        );
    }
}

// ─── Keyframe operations ─────────────────────────────────────────────────────

/** Store a keyframe under (sessionId, tick). Overwrites any existing keyframe at the same tick. */
export async function saveKeyframe(sessionId: string, keyframe: Keyframe): Promise<void> {
    const record = { sessionId, ...keyframe };
    if (_db) {
        const tx = _db.transaction(['keyframes'], 'readwrite');
        await idbPut(tx.objectStore('keyframes'), record);
    } else {
        // localStorage fallback: keep only the single latest keyframe per session
        lsSet(lsKeyframeKey(sessionId), record);
    }
}

/**
 * Get the keyframe with the highest tick number for a session.
 * Returns undefined if no keyframe exists.
 */
export async function getLatestKeyframe(sessionId: string): Promise<Keyframe | undefined> {
    if (_db) {
        const tx = _db.transaction(['keyframes'], 'readonly');
        const store = tx.objectStore('keyframes');

        const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
        const all = await idbGetAllByRange<{ sessionId: string } & Keyframe>(store, range);

        if (all.length === 0) {
            return undefined;
        }
        const latest = all.reduce((best, kf) => (kf.tick > best.tick ? kf : best), all[0]!);
        return { tick: latest.tick, snapshot: latest.snapshot, journalIndex: latest.journalIndex };
    } else {
        const record = lsGet<{ sessionId: string } & Keyframe>(lsKeyframeKey(sessionId));
        if (!record) {
            return undefined;
        }
        return { tick: record.tick, snapshot: record.snapshot, journalIndex: record.journalIndex };
    }
}

// ─── Journal operations ──────────────────────────────────────────────────────

/** Store (replace) journal entries for a session. */
export async function saveJournal(sessionId: string, entries: JournalEntry[]): Promise<void> {
    const record = { sessionId, entries };
    if (_db) {
        const tx = _db.transaction(['journals'], 'readwrite');
        await idbPut(tx.objectStore('journals'), record);
    } else {
        lsSet(lsJournalKey(sessionId), record);
    }
}

/** Get journal entries for a session. Returns empty array if none stored. */
export async function getJournal(sessionId: string): Promise<JournalEntry[]> {
    if (_db) {
        const tx = _db.transaction(['journals'], 'readonly');
        const record = await idbGet<{ sessionId: string; entries: JournalEntry[] }>(
            tx.objectStore('journals'),
            sessionId
        );
        // eslint-disable-next-line no-restricted-syntax -- journal may not exist for a session yet; [] is correct empty default at storage boundary
        return record?.entries ?? [];
    } else {
        const record = lsGet<{ sessionId: string; entries: JournalEntry[] }>(lsJournalKey(sessionId));
        // eslint-disable-next-line no-restricted-syntax -- journal may not exist in localStorage yet; [] is correct empty default at storage boundary
        return record?.entries ?? [];
    }
}

/** Delete ALL sessions, keyframes, and journal entries. Clears game-state localStorage keys too. */
export async function clearAllGameState(): Promise<void> {
    if (_db) {
        const tx = _db.transaction(['sessions', 'keyframes', 'journals'], 'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('keyframes').clear();
        tx.objectStore('journals').clear();
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } else {
        // Clear all localStorage fallback keys
        const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX));
        for (const key of keysToRemove) {
            localStorage.removeItem(key);
        }
    }

    // Clear the legacy game-state keys used by the reset CLI command
    localStorage.removeItem('settlers_game_state');
    localStorage.removeItem('settlers_initial_state');
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Prune sessions in IndexedDB down to MAX_SESSIONS, deleting oldest first. Protected session is spared. */
async function pruneSessionsIdb(db: IDBDatabase, protectedId: string): Promise<void> {
    const tx = db.transaction(['sessions'], 'readonly');
    const all = await idbGetAll<SaveSession>(tx.objectStore('sessions'));
    if (all.length <= MAX_SESSIONS) {
        return;
    }
    const sorted = all.toSorted((a, b) => a.updatedAt - b.updatedAt);
    const toDelete = sorted.slice(0, all.length - MAX_SESSIONS).filter(s => s.id !== protectedId);
    for (const session of toDelete) {
        await deleteSessionIdb(db, session.id);
    }
}

/** Delete a session + its keyframes + journal from IndexedDB. */
async function deleteSessionIdb(db: IDBDatabase, id: string): Promise<void> {
    const tx = db.transaction(['sessions', 'keyframes', 'journals'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const keyframes = tx.objectStore('keyframes');
    const journals = tx.objectStore('journals');

    await idbDelete(sessions, id);
    await idbDelete(journals, id);

    // Delete all keyframes belonging to this session
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    const kfsToDelete = await idbGetAllByRange<{ sessionId: string; tick: number }>(keyframes, range);
    for (const kf of kfsToDelete) {
        await idbDelete(keyframes, [kf.sessionId, kf.tick]);
    }
}

/**
 * Prune sessions in the in-memory list down to MAX_SESSIONS, deleting associated
 * localStorage data for removed sessions. Mutates the sessions array in-place.
 */
function pruneSessionsLs(sessions: SaveSession[], protectedId: string): void {
    if (sessions.length <= MAX_SESSIONS) {
        return;
    }
    const sorted = [...sessions].sort((a, b) => a.updatedAt - b.updatedAt);
    const toDelete = sorted.slice(0, sessions.length - MAX_SESSIONS).filter(s => s.id !== protectedId);
    for (const session of toDelete) {
        deleteSessionLsData(session.id);
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) {
            sessions.splice(idx, 1);
        }
    }
}

/** Delete per-session localStorage keys (keyframe + journal). Does NOT update the sessions list. */
function deleteSessionLsData(id: string): void {
    lsDelete(lsKeyframeKey(id));
    lsDelete(lsJournalKey(id));
}
