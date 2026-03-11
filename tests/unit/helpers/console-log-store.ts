/**
 * Writes captured console output to the timeline SQLite DB.
 *
 * Uses the same shared DB as TimelineWriter (via getOrCreateSharedDb)
 * but writes to a separate `console_log` table.
 */
import { getOrCreateSharedDb, withRetry } from './timeline-store';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { inspect } from 'node:util';

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS console_log (
        id      INTEGER PRIMARY KEY,
        test_id TEXT NOT NULL,
        level   TEXT NOT NULL,
        message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_test  ON console_log(test_id);
    CREATE INDEX IF NOT EXISTS idx_console_level ON console_log(test_id, level);
`;

let schemaCreated = false;

function ensureSchema(db: DatabaseType) {
    if (schemaCreated) return;
    withRetry(() => db.exec(SCHEMA));
    schemaCreated = true;
}

const FLUSH_THRESHOLD = 200;

export class ConsoleLogWriter {
    private readonly db: DatabaseType;
    private readonly stmtInsert: Statement;
    private readonly testId: string;
    private buffer: Array<{ level: string; message: string }> = [];

    constructor(testId: string) {
        this.testId = testId;
        this.db = getOrCreateSharedDb();
        ensureSchema(this.db);
        this.stmtInsert = this.db.prepare('INSERT INTO console_log (test_id, level, message) VALUES (?, ?, ?)');
    }

    record(level: string, args: unknown[]) {
        const message = args.map(a => (typeof a === 'string' ? a : inspect(a, { depth: 4, colors: false }))).join(' ');
        this.buffer.push({ level, message });
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
                for (const entry of batch) {
                    this.stmtInsert.run(this.testId, entry.level, entry.message);
                }
            })();
        });
    }
}
