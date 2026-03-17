/**
 * SQLite storage layer for timeline data.
 *
 * Manages a shared on-disk DB per Vitest worker process.
 * Each test writes to its own test_id partition via TimelineWriter.
 *
 * Old DB files are pruned automatically (keeps last MAX_DB_FILES).
 * Since Vitest workers don't fire process.on('exit'), we don't try
 * to delete DBs on clean runs — pruning handles it.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';
import type { TimelineCategory, TimelineEntry } from './timeline-recorder';

// ─── Constants ───────────────────────────────────────────────────

const TIMELINE_DIR = 'output/timeline/unit';
const MAX_DB_FILES = 10;
const FLUSH_THRESHOLD = 500;
const BUSY_TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 50;

// ─── Retry helper (handles SQLITE_BUSY across worker forks) ─────

function isBusyError(err: unknown): boolean {
    return err instanceof Error && (err.message.includes('database is locked') || err.message.includes('SQLITE_BUSY'));
}

/**
 * Retries a synchronous SQLite operation that may fail with "database is locked"
 * under concurrent multi-process access. Uses exponential backoff with jitter.
 */
export function withRetry<T>(fn: () => T): T {
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        try {
            return fn();
        } catch (err) {
            if (!isBusyError(err) || attempt === RETRY_ATTEMPTS - 1) throw err;
            // Exponential backoff with jitter: 50-100ms, 100-200ms, 200-400ms, ...
            // eslint-disable-next-line sonarjs/pseudo-random -- backoff jitter, not security
            const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (1 + Math.random());
            const until = Date.now() + delay;
            while (Date.now() < until) {
                /* spin-wait (sync API, no await) */
            }
        }
    }
    throw new Error('unreachable');
}

// ─── Schema ──────────────────────────────────────────────────────

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

// ─── Prepared statement SQL ──────────────────────────────────────

const SQL_INSERT = `
    INSERT INTO timeline (test_id, tick, category, entity_id, entity_type, unit_id, building_id, player, x, y, event, detail, level, unit_type, building_type, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_REGISTER_TEST = `
    INSERT OR REPLACE INTO test_runs (test_id, status) VALUES (?, 'running')
`;

const SQL_FINALIZE_TEST = `
    UPDATE test_runs
    SET status = ?, tick_count = ?, entry_count = ?, error_count = ?
    WHERE test_id = ?
`;

const SQL_SELECT = `
    SELECT tick, category, entity_id AS entityId, entity_type AS entityType, player, x, y, event, detail
    FROM timeline
`;

const SQL_LAST_N = `${SQL_SELECT} WHERE test_id = ? ORDER BY id DESC LIMIT ?`;

const SQL_HEAD = `${SQL_SELECT} WHERE test_id = ? ORDER BY id LIMIT ?`;

const SQL_COUNT_BY_CATEGORY = `
    SELECT category, COUNT(*) AS count
    FROM timeline WHERE test_id = ?
    GROUP BY category ORDER BY count DESC
`;

const SQL_COUNT_BY_EVENT = `
    SELECT event, COUNT(*) AS count
    FROM timeline WHERE test_id = ?
    GROUP BY event ORDER BY count DESC LIMIT ?
`;

const SQL_MIDDLE_PATTERNS = `
    SELECT category || ':' || event AS pattern, COUNT(*) AS count
    FROM timeline
    WHERE test_id = ?
      AND id >  (SELECT MIN(id) + ? FROM timeline WHERE test_id = ?)
      AND id <= (SELECT MAX(id) - ? FROM timeline WHERE test_id = ?)
    GROUP BY pattern ORDER BY count DESC LIMIT 20
`;

const SQL_DELETE_TEST = `DELETE FROM timeline WHERE test_id = ?`;

// ─── Shared DB singleton (all workers share one file per run) ────

let sharedDb: DatabaseType | undefined;
let sharedDbPath: string | undefined;

export function getOrCreateSharedDb(): DatabaseType {
    if (sharedDb) return sharedDb;

    if (!existsSync(TIMELINE_DIR)) {
        mkdirSync(TIMELINE_DIR, { recursive: true });
    }
    pruneOldDbFiles();

    // TIMELINE_RUN_ID is set in vite.config.ts so all workers converge on one file.
    // Fallback to a timestamp for non-vitest usage (e.g. manual scripts).
    const runId = process.env['TIMELINE_RUN_ID'] ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    sharedDbPath = `${TIMELINE_DIR}/run_${runId}.db`;
    sharedDb = new Database(sharedDbPath);
    sharedDb.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // journal_mode=WAL requires an exclusive lock — retry if another worker holds it
    withRetry(() => {
        sharedDb!.pragma('journal_mode = WAL');
        sharedDb!.pragma('synchronous = NORMAL');
        sharedDb!.exec(SCHEMA);
    });

    return sharedDb;
}

function pruneOldDbFiles() {
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

/** Get the current worker's DB file path (for diagnostic messages). */
export function getSharedDbPath(): string | undefined {
    return sharedDbPath;
}

// ─── Per-test writer ─────────────────────────────────────────────

/**
 * Per-test handle to the shared timeline DB.
 *
 * Buffers inserts and flushes in batched transactions.
 * All queries are scoped to this writer's testId.
 */
export class TimelineWriter {
    private readonly db: DatabaseType;
    private readonly stmtInsert: Statement;
    private readonly testId: string;
    private buffer: TimelineEntry[] = [];
    private totalCount = 0;

    constructor(testId: string) {
        this.testId = testId;
        this.db = getOrCreateSharedDb();
        this.stmtInsert = this.db.prepare(SQL_INSERT);
        withRetry(() => this.db.prepare(SQL_REGISTER_TEST).run(testId));
    }

    // ─── Write ────────────────────────────────────────────────────

    record(entry: TimelineEntry) {
        this.buffer.push(entry);
        this.totalCount++;
        if (this.buffer.length >= FLUSH_THRESHOLD) {
            this.flush();
        }
    }

    flush() {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
        withRetry(() => {
            this.db.transaction(() => {
                for (const e of batch) {
                    this.stmtInsert.run(
                        this.testId,
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
        });
    }

    finalize(status: 'passed' | 'failed', tickCount: number, errorCount: number) {
        this.flush();
        withRetry(() => {
            this.db.prepare(SQL_FINALIZE_TEST).run(status, tickCount, this.totalCount, errorCount, this.testId);
        });
    }

    // ─── Read ─────────────────────────────────────────────────────

    lastN(n: number): TimelineEntry[] {
        this.flush();
        return (this.db.prepare(SQL_LAST_N).all(this.testId, n) as TimelineEntry[]).reverse();
    }

    head(n: number): TimelineEntry[] {
        this.flush();
        return this.db.prepare(SQL_HEAD).all(this.testId, n) as TimelineEntry[];
    }

    countByCategory(): { category: string; count: number }[] {
        this.flush();
        return this.db.prepare(SQL_COUNT_BY_CATEGORY).all(this.testId) as { category: string; count: number }[];
    }

    countByEvent(limit = 20): { event: string; count: number }[] {
        this.flush();
        return this.db.prepare(SQL_COUNT_BY_EVENT).all(this.testId, limit) as { event: string; count: number }[];
    }

    middlePatterns(headSkip: number, tailSkip: number): { pattern: string; count: number }[] {
        this.flush();
        return this.db.prepare(SQL_MIDDLE_PATTERNS).all(this.testId, headSkip, this.testId, tailSkip, this.testId) as {
            pattern: string;
            count: number;
        }[];
    }

    /** Dynamic query with optional filters. */
    query(opts: TimelineQueryOpts = {}): TimelineEntry[] {
        this.flush();
        const clauses: string[] = ['test_id = ?'];
        const params: unknown[] = [this.testId];

        if (opts.category) {
            clauses.push('category = ?');
            params.push(opts.category);
        }
        if (opts.entityId !== undefined) {
            clauses.push('entity_id = ?');
            params.push(opts.entityId);
        }
        if (opts.entityType) {
            clauses.push('entity_type = ?');
            params.push(opts.entityType);
        }
        if (opts.player !== undefined) {
            clauses.push('player = ?');
            params.push(opts.player);
        }
        if (opts.event) {
            clauses.push('event = ?');
            params.push(opts.event);
        }
        if (opts.level) {
            clauses.push('level = ?');
            params.push(opts.level);
        }
        if (opts.tickFrom !== undefined) {
            clauses.push('tick >= ?');
            params.push(opts.tickFrom);
        }
        if (opts.tickTo !== undefined) {
            clauses.push('tick <= ?');
            params.push(opts.tickTo);
        }

        params.push(opts.limit ?? 200);
        const sql = `${SQL_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`;
        return this.db.prepare(sql).all(...params) as TimelineEntry[];
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    get length(): number {
        return this.totalCount;
    }

    getTestId(): string {
        return this.testId;
    }

    clear() {
        this.buffer = [];
        this.totalCount = 0;
        withRetry(() => this.db.prepare(SQL_DELETE_TEST).run(this.testId));
    }

    close() {
        this.flush();
    }
}

export interface TimelineQueryOpts {
    category?: TimelineCategory;
    entityId?: number;
    entityType?: string;
    player?: number;
    event?: string;
    level?: string;
    tickFrom?: number;
    tickTo?: number;
    limit?: number;
}
