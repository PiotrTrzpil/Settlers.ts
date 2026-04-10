/**
 * Game mode save/load manager.
 *
 * Supports multiple save slots:
 * - 3 rotating auto-saves (every 60 seconds)
 * - Unlimited manual saves (user-triggered)
 *
 * Each save is stored in IndexedDB under a prefixed key with embedded metadata.
 */

import superjson from 'superjson';
import type { GameCore } from '../game-core';
import { idbGet, idbSet, idbDelete, idbKeys } from './persistence-store';
import { createSnapshot, restoreFromSnapshot, getCurrentMapId, type GameStateSnapshot } from './game-state-persistence';

const AUTO_SAVE_PREFIX = 'gm_auto_';
const MANUAL_SAVE_PREFIX = 'gm_manual_';
const AUTO_SAVE_SLOTS = 3;
const AUTO_SAVE_INTERVAL_MS = 60_000; // 60 seconds

export interface SaveEntry {
    id: string;
    type: 'auto' | 'manual';
    timestamp: number;
    mapId: string;
    label: string;
}

interface StoredSave {
    meta: SaveEntry;
    snapshot: string; // superjson-encoded GameStateSnapshot
}

/** Format a timestamp for display. */
function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function writeSave(key: string, game: GameCore, meta: SaveEntry): Promise<boolean> {
    try {
        const snapshot = createSnapshot(game);
        const stored: StoredSave = { meta, snapshot: superjson.stringify(snapshot) };
        await idbSet(key, superjson.stringify(stored));
        return true;
    } catch (e) {
        console.warn('Failed to write game mode save:', e);
        return false;
    }
}

async function readSave(key: string): Promise<StoredSave | null> {
    try {
        const raw = await idbGet<string>(key);
        if (!raw) {
            return null;
        }
        return superjson.parse<StoredSave>(raw);
    } catch {
        return null;
    }
}

/**
 * Game mode save/load manager. One instance per game session.
 */
export class GameModeSaveManager {
    private game: GameCore | null = null;
    private autoSaveIndex = 0;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    /** Start auto-saving at the game mode interval (60s). */
    start(game: GameCore): void {
        this.game = game;
        this.stop();
        this.intervalId = setInterval(() => {
            if (this.game) {
                void this.autoSave();
            }
        }, AUTO_SAVE_INTERVAL_MS);
    }

    /** Stop auto-saving. */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Perform a rotating auto-save. */
    async autoSave(): Promise<boolean> {
        if (!this.game) {
            return false;
        }
        const slotIndex = this.autoSaveIndex % AUTO_SAVE_SLOTS;
        const key = `${AUTO_SAVE_PREFIX}${slotIndex}`;
        const meta: SaveEntry = {
            id: key,
            type: 'auto',
            timestamp: Date.now(),
            mapId: getCurrentMapId(),
            label: `Auto Save ${slotIndex + 1}`,
        };
        const ok = await writeSave(key, this.game, meta);
        if (ok) {
            this.autoSaveIndex++;
        }
        return ok;
    }

    /** Create a manual save. Returns the save entry on success. */
    async manualSave(): Promise<SaveEntry | null> {
        if (!this.game) {
            return null;
        }
        const ts = Date.now();
        const key = `${MANUAL_SAVE_PREFIX}${ts}`;
        const meta: SaveEntry = {
            id: key,
            type: 'manual',
            timestamp: ts,
            mapId: getCurrentMapId(),
            label: `Save - ${formatTimestamp(ts)}`,
        };
        const ok = await writeSave(key, this.game, meta);
        return ok ? meta : null;
    }

    /** List all saves (manual + auto), sorted newest first. Optionally filter by mapId. */
    async listSaves(mapId?: string): Promise<SaveEntry[]> {
        const allKeys = await idbKeys();
        const saveKeys = allKeys.filter(k => k.startsWith(AUTO_SAVE_PREFIX) || k.startsWith(MANUAL_SAVE_PREFIX));

        const entries: SaveEntry[] = [];
        for (const key of saveKeys) {
            const stored = await readSave(key);
            if (stored && (!mapId || stored.meta.mapId === mapId)) {
                entries.push(stored.meta);
            }
        }

        entries.sort((a, b) => b.timestamp - a.timestamp);
        return entries;
    }

    /** Load a save by its ID and restore into the current game. Returns true on success. */
    async loadSave(saveId: string): Promise<boolean> {
        if (!this.game) {
            return false;
        }
        const stored = await readSave(saveId);
        if (!stored) {
            return false;
        }
        try {
            const snapshot = superjson.parse<GameStateSnapshot>(stored.snapshot);
            restoreFromSnapshot(this.game, snapshot);
            return true;
        } catch (e) {
            console.warn('Failed to load game mode save:', e);
            return false;
        }
    }

    /** Delete a save by its ID. */
    async deleteSave(saveId: string): Promise<void> {
        await idbDelete(saveId);
    }
}
