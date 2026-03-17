/**
 * Shared SQLite writer for live timeline recording.
 *
 * Used by both the Vite plugin (auto-records during dev) and the
 * standalone timeline-receiver script.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import type { SerializedTimelineEntry } from '../../src/game/cli/types';

// ─── Constants ───────────────────────────────────────────────

const TIMELINE_DIR = resolve('output/timeline/live');
const MAX_DB_FILES = 10;
const FLUSH_THRESHOLD = 500;
const FLUSH_INTERVAL_MS = 1_000;
const PRUNE_INTERVAL_MS = 30_000;
const MAX_ENTRIES = 50_000;
const BUSY_TIMEOUT_MS = 30_000;

// ─── Schema ──────────────────────────────────────────────────

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS timeline (
        id          INTEGER PRIMARY KEY,
        test_id     TEXT    NOT NULL,
        tick        INTEGER NOT NULL,
        category    TEXT    NOT NULL,
        entity_id   INTEGER,
        entity_type TEXT,
        unit_id     INTEGER,
        building_id INTEGER,
        player      INTEGER,
        x           INTEGER,
        y           INTEGER,
        event       TEXT    NOT NULL,
        detail      TEXT    NOT NULL,
        level       TEXT,
        unit_type   TEXT,
        building_type TEXT,
        meta        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_test     ON timeline(test_id);
    CREATE INDEX IF NOT EXISTS idx_tick     ON timeline(test_id, tick);
    CREATE INDEX IF NOT EXISTS idx_category ON timeline(test_id, category);
    CREATE INDEX IF NOT EXISTS idx_entity   ON timeline(test_id, entity_id);
    CREATE INDEX IF NOT EXISTS idx_unit     ON timeline(test_id, unit_id);
    CREATE INDEX IF NOT EXISTS idx_building ON timeline(test_id, building_id);
    CREATE INDEX IF NOT EXISTS idx_event    ON timeline(test_id, event);
    CREATE INDEX IF NOT EXISTS idx_player   ON timeline(test_id, player);
    CREATE INDEX IF NOT EXISTS idx_level    ON timeline(test_id, level);

    CREATE TABLE IF NOT EXISTS test_runs (
        test_id     TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'running',
        tick_count  INTEGER,
        entry_count INTEGER,
        error_count INTEGER
    );
`;

const SQL_INSERT = `
    INSERT INTO timeline (
        test_id, tick, category, entity_id, entity_type,
        unit_id, building_id, player, x, y,
        event, detail, level, unit_type, building_type, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_REGISTER = `
    INSERT OR REPLACE INTO test_runs (test_id, status) VALUES (?, 'running')
`;

const SQL_FINALIZE = `
    UPDATE test_runs
    SET status = ?, tick_count = ?, entry_count = ?, error_count = ?
    WHERE test_id = ?
`;

const SQL_PRUNE = `
    DELETE FROM timeline WHERE test_id = ? AND id <= (
        SELECT id FROM timeline WHERE test_id = ?
        ORDER BY id DESC LIMIT 1 OFFSET ?
    )
`;

// ─── DB setup ────────────────────────────────────────────────

function pruneOldDbFiles(): void {
    try {
        const files = readdirSync(TIMELINE_DIR)
            .filter(f => f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm'))
            .map(f => ({ name: f, mtime: statSync(`${TIMELINE_DIR}/${f}`).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

        const bases = new Set(files.map(f => f.name.replace(/-(wal|shm)$/, '')));
        for (const base of [...bases].slice(MAX_DB_FILES)) {
            for (const ext of ['', '-wal', '-shm']) {
                const p = `${TIMELINE_DIR}/${base}${ext}`;
                if (existsSync(p)) unlinkSync(p);
            }
        }
    } catch {
        // Best-effort cleanup
    }
}

function createDb(dbPath: string): DatabaseType {
    if (!existsSync(TIMELINE_DIR)) {
        mkdirSync(TIMELINE_DIR, { recursive: true });
    }
    pruneOldDbFiles();

    const db = new Database(dbPath);
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(SCHEMA);
    return db;
}

// ─── Writer ──────────────────────────────────────────────────

export class LiveTimelineWriter {
    private readonly db: DatabaseType;
    private readonly stmtInsert: Statement;
    private readonly sessionId: string;
    private buffer: SerializedTimelineEntry[] = [];
    private totalCount = 0;
    private maxTick = 0;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private pruneTimer: ReturnType<typeof setInterval> | null = null;
    private stmtPrune: Statement;

    constructor(db: DatabaseType, sessionId: string) {
        this.db = db;
        this.sessionId = sessionId;
        this.stmtInsert = db.prepare(SQL_INSERT);
        this.stmtPrune = db.prepare(SQL_PRUNE);
        db.prepare(SQL_REGISTER).run(sessionId);
        this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
        this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    }

    record(entry: SerializedTimelineEntry): void {
        this.buffer.push(entry);
        this.totalCount++;
        if (entry.tick > this.maxTick) this.maxTick = entry.tick;
        if (this.buffer.length >= FLUSH_THRESHOLD) {
            this.flush();
        }
    }

    recordBatch(entries: SerializedTimelineEntry[]): void {
        for (const entry of entries) {
            this.record(entry);
        }
    }

    flush(): void {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
        this.db.transaction(() => {
            for (const e of batch) {
                this.stmtInsert.run(
                    this.sessionId,
                    e.tick,
                    e.category,
                    e.entityId ?? null,
                    e.entityType ?? null,
                    e.unitId ?? null,
                    e.buildingId ?? null,
                    e.player ?? null,
                    e.x ?? null,
                    e.y ?? null,
                    e.event,
                    e.detail,
                    e.level ?? null,
                    e.unitType ?? null,
                    e.buildingType ?? null,
                    e.meta ?? null
                );
            }
        })();
    }

    /** Delete entries beyond the rolling window (keeps last MAX_ENTRIES). */
    private prune(): void {
        this.flush();
        const deleted = this.stmtPrune.run(this.sessionId, this.sessionId, MAX_ENTRIES);
        if (deleted.changes > 0) {
            this.totalCount -= deleted.changes;
        }
    }

    finalize(status: 'passed' | 'failed'): void {
        this.flush();
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
            this.pruneTimer = null;
        }
        this.db.prepare(SQL_FINALIZE).run(status, this.maxTick, this.totalCount, 0, this.sessionId);
    }

    /** Clear all entries (e.g. on HMR reload when ticks reset to 0). */
    reset(): void {
        this.flush();
        this.db.prepare('DELETE FROM timeline WHERE test_id = ?').run(this.sessionId);
        this.totalCount = 0;
        this.maxTick = 0;
    }

    get entryCount(): number {
        return this.totalCount;
    }

    close(): void {
        this.finalize('passed');
        this.db.close();
    }
}

// ─── Factory ─────────────────────────────────────────────────

export interface LiveTimelineSession {
    writer: LiveTimelineWriter;
    dbPath: string;
    sessionId: string;
}

/** Create a new live timeline recording session. */
export function createLiveTimeline(): LiveTimelineSession {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionId = `live_${timestamp}`;
    const dbPath = `${TIMELINE_DIR}/live_${timestamp}.db`;
    const db = createDb(dbPath);
    const writer = new LiveTimelineWriter(db, sessionId);
    return { writer, dbPath, sessionId };
}
