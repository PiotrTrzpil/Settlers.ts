/**
 * E2E timeline capture — bridges browser TimelineCapture to the same
 * SQLite format used by integration tests, so `pnpm timeline` works.
 *
 * Usage in a test:
 *   const tl = await E2eTimeline.start(page, 'my-test-name');
 *   // ... do stuff ...
 *   await tl.stop('passed');
 *
 * Query after failure:
 *   pnpm timeline -- --db tests/e2e/.timeline/<file>.db --test <name>
 */

import type { Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3';

const TIMELINE_DIR = 'tests/e2e/.timeline';
interface RawEntry {
    tick: number;
    category: string;
    entityId?: number;
    entityType?: string;
    unitId?: number;
    buildingId?: number;
    player?: number;
    x?: number;
    y?: number;
    event: string;
    detail: string;
    level?: string;
    unitType?: string;
    buildingType?: string;
    meta?: string;
}

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
    CREATE INDEX IF NOT EXISTS idx_event    ON timeline(test_id, event);
    CREATE INDEX IF NOT EXISTS idx_entity   ON timeline(test_id, entity_id);

    CREATE TABLE IF NOT EXISTS test_runs (
        test_id     TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'running',
        tick_count  INTEGER,
        entry_count INTEGER,
        error_count INTEGER
    );
`;

const SQL_INSERT = `
    INSERT INTO timeline (test_id, tick, category, entity_id, entity_type, unit_id, building_id, player, x, y, event, detail, level, unit_type, building_type, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

let sharedDb: DatabaseType | undefined;
let sharedDbPath: string | undefined;

function getDb(): DatabaseType {
    if (sharedDb) return sharedDb;
    if (!existsSync(TIMELINE_DIR)) {
        mkdirSync(TIMELINE_DIR, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    sharedDbPath = `${TIMELINE_DIR}/e2e_${ts}.db`;
    sharedDb = new Database(sharedDbPath);
    sharedDb.pragma('journal_mode = WAL');
    sharedDb.pragma('synchronous = NORMAL');
    sharedDb.exec(SCHEMA);
    return sharedDb;
}

export class E2eTimeline {
    private readonly page: Page;
    private readonly testId: string;
    private readonly db: DatabaseType;
    private readonly stmtInsert: Statement;
    private buffer: RawEntry[] = [];
    private totalCount = 0;

    private constructor(page: Page, testId: string) {
        this.page = page;
        this.testId = testId;
        this.db = getDb();
        this.stmtInsert = this.db.prepare(SQL_INSERT);
        this.db.prepare('INSERT OR REPLACE INTO test_runs (test_id, status) VALUES (?, ?)').run(testId, 'running');
    }

    static async start(page: Page, testId: string): Promise<E2eTimeline> {
        const tl = new E2eTimeline(page, testId);

        // Expose a function for the browser to push batches of events
        await page.exposeFunction('__e2eTimelineBatch', (entries: RawEntry[]) => {
            for (const e of entries) {
                tl.buffer.push(e);
                tl.totalCount++;
            }
            if (tl.buffer.length >= 200) tl.flush();
        });

        // Enable TimelineCapture in the browser and wire its onFlush
        await page.evaluate(() => {
            const tc = window.__settlers__?.timelineCapture;
            if (!tc) return;
            tc.onFlush = entries => {
                (window as any).__e2eTimelineBatch(entries);
            };
            tc.addSubscriber();
        });

        if (sharedDbPath) {
            console.log(`[e2e-timeline] DB: ${sharedDbPath}`);
        }

        return tl;
    }

    flush(): void {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
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
    }

    async stop(status: 'passed' | 'failed' = 'passed'): Promise<void> {
        // Trigger a final flush from the browser
        try {
            await this.page.evaluate(() => {
                const tc = window.__settlers__?.timelineCapture;
                if (tc) tc.removeSubscriber();
            });
            // Wait briefly for the last batch to arrive
            await this.page.waitForTimeout(200);
        } catch {
            // Page may have navigated away
        }

        this.flush();
        this.db
            .prepare('UPDATE test_runs SET status = ?, entry_count = ? WHERE test_id = ?')
            .run(status, this.totalCount, this.testId);
    }

    /** Path to the SQLite DB for diagnostic queries. */
    static get dbPath(): string | undefined {
        return sharedDbPath;
    }
}
