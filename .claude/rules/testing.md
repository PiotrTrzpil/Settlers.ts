---
paths:
  - "tests/**"
description: Testing rules — loaded when working with test files
---

# Testing Rules

**Read `docs/testing/guide.md` before writing or updating tests.**

## Prefer Integration Tests

**Always write integration tests over unit tests.** Integration tests exercise real game systems together (construction, logistics, movement, combat) and catch bugs that unit tests miss. Place them in `tests/unit/integration/`. Only write isolated unit tests when testing pure logic with no system dependencies.

All integration tests must look clean. Use/add more helpers if you need, to test-simulation.ts or next to it.

All integration tests must use real data. There must be even no possibility for them to use any stub or mock data.

## CRITICAL: TDD for Bug Fixes

**Always use TDD when fixing bugs.** Before writing any fix:
1. Write a failing test that reproduces the bug
2. Confirm the test fails for the right reason
3. Implement the fix
4. Confirm the test passes

Never fix a bug without a reproducing test first. The test is proof the bug existed and proof it's fixed.

## Use Timeline DB to Investigate

**Always query the timeline SQLite DB to understand what happened in a test.** Do not guess or add `console.log` — the timeline already captures all events, entity state changes, and console output. All timelines are saved to `tests/unit/.timeline/*.db` (SQLite), one DB per run.

**IMPORTANT:** Multiple sessions may run tests concurrently. Always use `--db <path>` with the specific DB from your run, not the default (which picks the latest and may belong to another session). The DB path is printed at the start of each test run.

```sh
pnpm timeline -- --db <path>                              # show failed tests
pnpm timeline -- --db <path> --entity 42                  # entity history
pnpm timeline -- --db <path> --cat logistics --test <id>  # filter by category
pnpm timeline -- --db <path> --console --test <id>        # console output
pnpm timeline -- --db <path> --console --list             # list tests with console output
pnpm timeline -- --db <path> --console --level error      # only console.error
pnpm timeline -- --db <path> --sql "SELECT * FROM timeline WHERE category='movement' AND test_id=<id> ORDER BY tick"
```

Use `--sql` for custom queries when the built-in filters aren't enough.

### Timeline DB Schema (quick ref)

**`timeline`** columns: `id`, `test_id`, `tick`, `category`, `entity_id`, `entity_type`, `unit_id`, `building_id`, `player`, `x`, `y`, `event`, `detail`, `level`, `unit_type`, `building_type`, `meta` (JSON).

- **category**: `unit`, `building`, `carrier`, `logistics`, `inventory`, `movement`, `construction`, etc. (derived from event namespace)
- **event**: raw EventBus name, e.g. `building:placed`, `unit:moved`, `carrier:pickup`, `carrier:delivered`
- **entity_id**: extracted by priority `unitId > buildingId > entityId`
- **detail**: human-readable summary; **meta**: JSON of remaining payload fields
- **level**: `debug`, `info`, `warn`, `error`

**`test_runs`**: `test_id`, `status` (`passed`|`failed`), `tick_count`, `entry_count`, `error_count`.
**`console_log`**: `test_id`, `level` (`log`|`warn`|`error`), `message`.

Indexed on: `test_id`, `tick`, `category`, `entity_id`, `unit_id`, `building_id`, `event`, `player`, `level`.

### Essential SQL patterns

```sql
-- Top events by frequency
SELECT event, COUNT(*) AS n FROM timeline WHERE test_id='<id>' GROUP BY event ORDER BY n DESC LIMIT 20

-- Errors and warnings
SELECT tick, event, detail FROM timeline WHERE test_id='<id>' AND level IN ('warn', 'error') ORDER BY tick

-- Entity history (full)
SELECT tick, event, detail, meta FROM timeline WHERE test_id='<id>' AND entity_id=42 ORDER BY tick

-- Carrier pickups & deliveries
SELECT tick, unit_id, event, detail FROM timeline WHERE test_id='<id>' AND event IN ('carrier:pickup', 'carrier:delivered') ORDER BY tick

-- Construction progress
SELECT tick, building_id, event, detail FROM timeline WHERE test_id='<id>' AND event LIKE 'building:construction%' ORDER BY tick
```

### Programmatic API (in test code)

```typescript
sim.timeline.entityHistory(entityId);
sim.timeline.errors();
sim.timeline.query({ category: 'logistics', event: 'carrier:pickup' });
sim.timeline.formatDiagnostics({ entityId: 42 }); // useful in failure messages
sim.timeline.formatSummary();
```


## Running Tests

**NEVER run tests more than once per validation cycle.** Capture output to a file and read/grep from it:
```sh
pnpm test:unit 2>&1 | tee /tmp/test.txt   # run ONCE
grep "FAIL\|error" /tmp/test.txt           # then filter from the file
```
Re-running tests just to see different output is forbidden. Read `/tmp/test.txt` instead.

If some tests fail, ALWAYS RUN JUST ONE FAILING TEST to investigate, then after fixing it, run another failing test. Only run all if you have fixed the failing test.

Do not fix one test -> rerun all tests. If you previously saw many failures, ALWAYS run them one by one. Only if many previously failing tests are now passing, run all tests to see the new picture.

## E2E Testing

- Always lint first before running tests.
- **Never use `--reporter=line`** — it suppresses stdout. Use `--reporter=list` instead.
- Playwright `outputDir` writes to `tests/e2e/.results/` (gitignored).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are committed.
