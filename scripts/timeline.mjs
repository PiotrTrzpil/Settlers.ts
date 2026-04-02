#!/usr/bin/env node
/* global console, process */
/**
 * Query timeline SQLite databases from test runs.
 *
 * Usage:
 *   pnpm timeline                               # summary of failed test (or list if multiple)
 *   pnpm timeline --list                        # list all tests
 *   pnpm timeline --test <id>                   # summary for a specific test
 *   pnpm timeline --entity 42                   # entity history (searches entity_id, unit_id, building_id)
 *   pnpm timeline --cat logistics               # filter by category
 *   pnpm timeline --level warn                  # filter by level
 *   pnpm timeline --event bump_failed           # filter by event name
 *   pnpm timeline --tick 1000-2000              # filter by tick range
 *   pnpm timeline --sql "SELECT ..."            # raw SQL
 *   pnpm timeline --db <path>                   # use specific DB file
 *   pnpm timeline --dir live                    # read from live recording dir (output/timeline/live/)
 *   pnpm timeline --clean                       # delete all timeline DBs
 *   pnpm timeline --console                     # console output from failed/auto-picked test
 *   pnpm timeline --console --test <id>         # console output from specific test
 *   pnpm timeline --console --level error       # only console.error calls
 */

import { parseArgs } from 'node:util';
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// ─── Constants & CLI ─────────────────────────────────────────────

const TIMELINE_DIRS = { test: 'output/timeline/unit', live: 'output/timeline/live' };
const ENTRY_COLS = 'tick, category, entity_id AS entityId, event, detail';

// Strip bare '--' inserted by pnpm when forwarding args
const { values: args } = parseArgs({
    args: process.argv.filter(a => a !== '--').slice(2),
    options: {
        list:   { type: 'boolean', default: false },
        test:   { type: 'string' },
        entity: { type: 'string' },
        cat:    { type: 'string' },
        level:  { type: 'string' },
        event:  { type: 'string' },
        tick:   { type: 'string' },
        sql:    { type: 'string' },
        db:     { type: 'string' },
        console: { type: 'boolean', default: false },
        dir:    { type: 'string', default: 'test' },
        clean:  { type: 'boolean', default: false },
        help:   { type: 'boolean', short: 'h', default: false },
    },
    strict: false,
});

if (args.dir !== 'test' && args.dir !== 'live') {
    die(`Invalid --dir value '${args.dir}'. Must be 'test' or 'live'.`);
}
const TIMELINE_DIR = TIMELINE_DIRS[args.dir];

// ─── Helpers ─────────────────────────────────────────────────────

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

function formatEntry(e) {
    const tick = String(e.tick).padStart(6);
    const cat  = e.category.padEnd(10);
    const id   = e.entityId != null ? `#${e.entityId}`.padEnd(6) : '      ';
    const ev   = e.event.padEnd(22);
    return `  tick ${tick}  [${cat}] ${id} ${ev} ${e.detail}`;
}

function printEntries(entries) {
    if (entries.length === 0) return console.log('  (no entries)');
    for (const e of entries) console.log(formatEntry(e));
}

function printTable(rows, columns) {
    if (rows.length === 0) return console.log('  (no rows)');
    const widths = columns.map(c =>
        Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)),
    );
    const header = columns.map((c, i) => c.padEnd(widths[i])).join('  ');
    const sep    = widths.map(w => '─'.repeat(w)).join('──');
    console.log(`  ${header}\n  ${sep}`);
    for (const r of rows) {
        console.log(`  ${columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ')}`);
    }
}

// ─── DB discovery ────────────────────────────────────────────────

function allDbs() {
    if (!existsSync(TIMELINE_DIR)) die('No timeline directory. Run tests first.');
    const dbs = readdirSync(TIMELINE_DIR)
        .filter(f => f.endsWith('.db'))
        .map(f => ({ path: join(TIMELINE_DIR, f), mtime: statSync(join(TIMELINE_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    if (dbs.length === 0) die('No timeline DB files found.');
    return dbs;
}

function findLatestDb() {
    return allDbs()[0].path;
}

function findLatestFailedDb() {
    for (const { path } of allDbs()) {
        try {
            const d = new Database(path);
            const row = d.prepare("SELECT COUNT(*) AS n FROM test_runs WHERE status = 'failed'").get();
            d.close();
            if (row?.n > 0) return path;
        } catch { /* skip unreadable */ }
    }
    return findLatestDb();
}

function autoPickTest(db) {
    const failed = db.prepare(
        `SELECT test_id FROM test_runs WHERE status = 'failed' ORDER BY entry_count DESC LIMIT 1`,
    ).get();
    return failed?.test_id
        ?? db.prepare('SELECT test_id FROM test_runs ORDER BY entry_count DESC LIMIT 1').get()?.test_id;
}

// ─── Commands ────────────────────────────────────────────────────

function cmdList(db) {
    const where = args.list ? '' : "WHERE status = 'failed'";
    const rows = db.prepare(
        `SELECT test_id, status, tick_count, entry_count, error_count FROM test_runs ${where} ORDER BY entry_count DESC`,
    ).all();

    if (rows.length === 0) { console.log('\n  No failed tests. Use --list to see all.\n'); return; }
    if (!args.list && rows.length === 1) { cmdSummary(db, rows[0].test_id); return; }

    console.log(`\n${args.list ? 'All' : 'Failed'} tests (${rows.length}):\n`);
    printTable(rows, ['test_id', 'status', 'tick_count', 'entry_count', 'error_count']);
    console.log();
}

function cmdSummary(db, testId) {
    const run = db.prepare('SELECT * FROM test_runs WHERE test_id = ?').get(testId);
    if (!run) die(`Test '${testId}' not found.`);

    console.log(`\nTest: ${run.test_id}  status=${run.status}  ticks=${run.tick_count}  entries=${run.entry_count}  errors=${run.error_count}`);

    // Errors first
    const errors = db.prepare(
        `SELECT ${ENTRY_COLS} FROM timeline WHERE test_id = ? AND category = 'error' ORDER BY id`,
    ).all(testId);
    if (errors.length > 0) { console.log(`\nErrors (${errors.length}):`); printEntries(errors); }

    // Hot entities in the last 2000 ticks
    const since = Math.max(0, run.tick_count - 2000);
    const hot = db.prepare(`
        SELECT entity_id, COUNT(*) AS events,
            (SELECT event FROM timeline t2
             WHERE t2.test_id = ? AND t2.entity_id = t.entity_id AND t2.tick >= ?
             GROUP BY event ORDER BY COUNT(*) DESC LIMIT 1) AS top_event,
            (SELECT x || ',' || y FROM timeline t3
             WHERE t3.test_id = ? AND t3.entity_id = t.entity_id AND t3.x IS NOT NULL
             ORDER BY t3.id DESC LIMIT 1) AS last_pos
        FROM timeline t
        WHERE test_id = ? AND tick >= ? AND entity_id IS NOT NULL
        GROUP BY entity_id ORDER BY events DESC LIMIT 8
    `).all(testId, since, testId, testId, since);
    if (hot.length > 0) {
        console.log(`\nHot entities (last ${run.tick_count - since} ticks):`);
        printTable(hot, ['entity_id', 'events', 'top_event', 'last_pos']);
    }

    // Top events
    const events = db.prepare(
        'SELECT event, COUNT(*) AS count FROM timeline WHERE test_id = ? GROUP BY event ORDER BY count DESC LIMIT 12',
    ).all(testId);
    console.log('\nTop events:');
    printTable(events, ['event', 'count']);

    // Tail
    const tail = db.prepare(
        `SELECT ${ENTRY_COLS} FROM timeline WHERE test_id = ? ORDER BY id DESC LIMIT 30`,
    ).all(testId).reverse();
    console.log('\nLast 30 entries:');
    printEntries(tail);
    console.log();
}

function cmdQuery(db, testId) {
    const clauses = ['test_id = ?'];
    const params  = [testId];

    if (args.cat)   { clauses.push('category = ?'); params.push(args.cat); }
    if (args.level) { clauses.push('level = ?'); params.push(args.level); }
    if (args.event) { clauses.push('event = ?'); params.push(args.event); }
    if (args.entity) {
        const id = Number(args.entity);
        clauses.push('(entity_id = ? OR unit_id = ? OR building_id = ?)');
        params.push(id, id, id);
    }
    if (args.tick) {
        const [from, to] = args.tick.split('-').map(Number);
        if (from != null) { clauses.push('tick >= ?'); params.push(from); }
        if (to != null)   { clauses.push('tick <= ?'); params.push(to); }
    }

    const rows = db.prepare(
        `SELECT ${ENTRY_COLS} FROM timeline WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 200`,
    ).all(...params).reverse();

    const desc = [
        args.cat    && `category=${args.cat}`,
        args.level  && `level=${args.level}`,
        args.entity && `entity=#${args.entity}`,
        args.event  && `event=${args.event}`,
        args.tick   && `tick=${args.tick}`,
    ].filter(Boolean).join(', ') || 'all';

    console.log(`\nQuery: ${desc}  (${rows.length} entries, limit 200):\n`);
    printEntries(rows);
    console.log();
}

function cmdSql(db, sql) {
    const rows = db.prepare(sql).all();
    if (rows.length === 0) return console.log('  (no rows)');
    printTable(rows, Object.keys(rows[0]));
    console.log(`\n  ${rows.length} row(s)`);
}

function cmdClean() {
    if (!existsSync(TIMELINE_DIR)) { console.log('Nothing to clean.'); return; }
    const files = readdirSync(TIMELINE_DIR);
    for (const f of files) unlinkSync(join(TIMELINE_DIR, f));
    console.log(`Deleted ${files.length} file(s).`);
}

function cmdConsole(db, testId) {
    const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='console_log'",
    ).get();
    if (!hasTable) die('No console_log table in this DB (tests may not have run with console capture).');

    const clauses = ['test_id = ?'];
    const params  = [testId];

    if (args.level) { clauses.push('level = ?'); params.push(args.level); }

    const rows = db.prepare(
        `SELECT level, message FROM console_log WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT 500`,
    ).all(...params);

    const levelFilter = args.level ? ` level=${args.level}` : '';
    console.log(`\nConsole output for: ${testId}${levelFilter}  (${rows.length} entries)\n`);
    if (rows.length === 0) { console.log('  (no console output)'); }
    for (const r of rows) {
        const lvl = r.level === 'log' ? '' : `[${r.level.toUpperCase()}] `;
        console.log(`  ${lvl}${r.message}`);
    }
    console.log();
}

function cmdConsoleList(db) {
    const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='console_log'",
    ).get();
    if (!hasTable) die('No console_log table in this DB.');

    const rows = db.prepare(
        'SELECT test_id, COUNT(*) AS entries FROM console_log GROUP BY test_id ORDER BY entries DESC',
    ).all();

    if (rows.length === 0) { console.log('\n  No tests with console output.\n'); return; }
    console.log(`\nTests with console output (${rows.length}):\n`);
    printTable(rows, ['test_id', 'entries']);
    console.log();
}

function autoPickConsoleTest(db) {
    const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='console_log'",
    ).get();
    if (!hasTable) return undefined;
    // Pick test with most console output
    const row = db.prepare(
        'SELECT test_id, COUNT(*) AS n FROM console_log GROUP BY test_id ORDER BY n DESC LIMIT 1',
    ).get();
    return row?.test_id;
}

// ─── Main ────────────────────────────────────────────────────────

if (args.help) {
    console.log(`
Usage: pnpm timeline [options]

Options:
  (no args)             Auto-show summary of failed test, or list if multiple
  --list                List all tests (default: only failed)
  --test <id>           Select a specific test (default: auto-pick failed)
  --entity <id>         Filter by entity (searches entity_id, unit_id, building_id)
  --cat <category>      Filter by category (unit, building, carrier, logistics, ...)
  --level <lvl>         Filter by level (debug, info, warn, error)
  --event <name>        Filter by event name
  --tick <from-to>      Filter by tick range (e.g. 1000-2000)
  --sql <query>         Run raw SQL query against the DB
  --db <path>           Use a specific DB file (recommended when multiple sessions run tests)
  --dir <test|live>     Timeline directory: 'test' (default) or 'live' (output/timeline/)
  --console             Show captured console output for a test
  --console --list      List all tests that have console output
  --console --level <l> Filter console output by level (log, warn, error)
  --clean               Delete all timeline DB files
  -h, --help            Show this help

Tables (for --sql):
  timeline      Game events: tick, category, entity_id, unit_id, building_id,
                player, x, y, event, detail, level, entity_type, unit_type,
                building_type, meta
  test_runs     Per-test metadata: test_id, status, tick_count, entry_count, error_count
  console_log   Captured console output: test_id, level, message

Example SQL queries:
  --sql "SELECT DISTINCT test_id FROM test_runs"
  --sql "SELECT * FROM timeline WHERE category='movement' AND test_id='<id>' ORDER BY tick"
  --sql "SELECT event, COUNT(*) AS n FROM timeline WHERE test_id='<id>' GROUP BY event ORDER BY n DESC"
  --sql "SELECT * FROM timeline WHERE entity_id=42 AND test_id='<id>' ORDER BY tick"
  --sql "SELECT * FROM console_log WHERE test_id='<id>' AND level='error'"

Live recording (from a running dev server):
  pnpm timeline:record                                      # start recording (Ctrl-C to stop)
  CLI_URL=ws://localhost:5174/__cli__ pnpm timeline:record   # custom port
  pnpm timeline:live                                        # query live recordings (--dir live)
  pnpm timeline -- --dir live --sql "SELECT category, COUNT(*) AS n FROM timeline GROUP BY category ORDER BY n DESC"
`);
    process.exit(0);
}

if (args.clean) { cmdClean(); process.exit(0); }

const hasFilter = args.entity || args.cat || args.level || args.event || args.tick;
const wantFailures = !args.db && !args.sql && !args.test && !args.list && !hasFilter && !args.console;
const dbPath = args.db || (wantFailures ? findLatestFailedDb() : findLatestDb());
console.log(`DB: ${dbPath}`);
const db = new Database(dbPath);

if (args.console) {
    if (args.list) {
        cmdConsoleList(db);
    } else {
        const testId = args.test || autoPickConsoleTest(db);
        if (!testId) die('No tests with console output found.');
        cmdConsole(db, testId);
    }
} else if (args.sql) {
    cmdSql(db, args.sql);
} else if (!args.test && !hasFilter) {
    cmdList(db);
} else {
    const testId = args.test || autoPickTest(db);
    if (!testId) die('No tests found in DB.');
    if (hasFilter) cmdQuery(db, testId);
    else cmdSummary(db, testId);
}

db.close();
