# Timeline System

The timeline is an event recording and diagnostics system that captures every `EventBus.emit()` into SQLite for post-mortem analysis. It has two paths:

1. **Test timeline** — records during `pnpm test:unit`, one DB per test run at `output/timeline/unit/`
2. **Live timeline** — records during `pnpm dev`, one DB per session at `output/timeline/live/`

Both share the same schema and query CLI.

## Schema

```sql
timeline (
    id            INTEGER PRIMARY KEY,
    test_id       TEXT NOT NULL,         -- test name or 'live_<timestamp>'
    tick          INTEGER NOT NULL,
    category      TEXT NOT NULL,         -- unit, building, carrier, logistics, inventory, ...
    entity_id     INTEGER,
    entity_type   TEXT,                  -- Unit, Building, etc.
    unit_id       INTEGER,
    building_id   INTEGER,
    player        INTEGER,
    x             INTEGER,
    y             INTEGER,
    event         TEXT NOT NULL,         -- e.g. 'building:placed', 'unit:moved'
    detail        TEXT NOT NULL,         -- human-readable summary
    level         TEXT,                  -- debug, info, warn, error
    unit_type     TEXT,                  -- e.g. 'Carrier', 'Swordsman'
    building_type TEXT,                  -- e.g. 'Sawmill', 'StorageArea'
    meta          TEXT                   -- JSON of remaining payload fields
)

test_runs (
    test_id       TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'running',  -- 'passed' | 'failed'
    tick_count    INTEGER,
    entry_count   INTEGER,
    error_count   INTEGER
)

console_log (
    test_id       TEXT,
    level         TEXT,                  -- log, warn, error
    message       TEXT
)
```

Indexed on: `test_id`, `tick`, `category`, `entity_id`, `unit_id`, `building_id`, `event`, `player`, `level`.

## Event Extraction

The pure function `recordTimelineEvent(tick, event, payload)` in `src/game/debug/timeline-recording.ts` converts every EventBus emission into a `SerializedTimelineEntry`:

- **event**: the raw EventBus event name (e.g. `building:placed`)
- **category**: derived from event namespace via `CATEGORY_MAP` (e.g. `building` → `building`, `settler` → `unit`)
- **entity_id**: extracted by priority: `unitId` > `buildingId` > `entityId`
- **detail**: human-readable via `EventFmt[event]` formatters, falls back to JSON
- **meta**: JSON of any payload fields not in the extracted columns (`unitId`, `buildingId`, `player`, `x`, `y`, `level`, `unitType`, `buildingType`)

## Integration Tests

Timeline recording is automatic. Every `createSimulation()` wires the EventBus to a `TimelineRecorder` that writes to the shared run DB.

### How it works

1. `wireSimulationTimeline()` patches `EventBus.emit()` to intercept all events
2. Each event is passed through `recordTimelineEvent()` and written to SQLite
3. On test completion, `finalize()` records pass/fail status and tick count
4. All tests in a `pnpm test:unit` run share one DB: `output/timeline/unit/run_<timestamp>.db`

### Querying after tests

The DB path is printed at the start of each test run. Always use `--db <path>` when multiple sessions may be running concurrently.

```sh
# Auto-show failed test summary
pnpm timeline

# List all tests in a run
pnpm timeline -- --db <path> --list

# Show a specific test
pnpm timeline -- --db <path> --test <id>

# Entity history
pnpm timeline -- --db <path> --entity 42

# Filter by category
pnpm timeline -- --db <path> --cat logistics --test <id>

# Filter by event name
pnpm timeline -- --db <path> --event "building:placed"

# Tick range
pnpm timeline -- --db <path> --tick 1000-2000 --test <id>

# Console output
pnpm timeline -- --db <path> --console --test <id>
pnpm timeline -- --db <path> --console --level error
```

### Using timeline in test code

The `TimelineRecorder` instance is available on the simulation for programmatic queries:

```typescript
const sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

// ... run simulation ...

// Query recorded events
sim.timeline.entityHistory(entityId);
sim.timeline.errors();
sim.timeline.countByCategory();
sim.timeline.countByEvent();
sim.timeline.query({ category: 'logistics', event: 'carrier:pickup' });

// Formatted diagnostics (useful in test failure messages)
sim.timeline.formatDiagnostics({ entityId: 42 });
sim.timeline.formatSummary();
```

### Concurrency

- WAL mode for multi-process SQLite access (Vitest workers)
- Retry wrapper with exponential backoff handles `SQLITE_BUSY`
- Each run generates a unique `TIMELINE_RUN_ID` (set in `vite.config.ts`)

## Live Timeline

### Recording

Timeline events are recorded automatically when the dev server runs. The Vite plugin (`vite-plugins/cli-ws-plugin.ts`) writes all events to `output/timeline/live/live_<timestamp>.db`.

For external recording (e.g. remote servers):

```sh
pnpm timeline:record                                        # connects to ws://localhost:5173
CLI_URL=ws://localhost:5174/__cli__ pnpm timeline:record     # custom port
```

### How it works (browser side)

1. `TimelineCapture` (`src/game/debug/timeline-capture.ts`) patches `EventBus.emit()` lazily — only when subscribers exist
2. Events are buffered (200 entries or 500ms) and flushed as `timeline:batch` over WebSocket
3. The Vite plugin relay receives batches, writes to local SQLite, and forwards to any external subscribers
4. Zero overhead when no subscribers are connected

### Querying live timelines

```sh
# List live sessions
pnpm timeline:live

# Query the current/latest live session
pnpm timeline:live -- --entity 42
pnpm timeline:live -- --cat logistics
pnpm timeline:live -- --sql "SELECT ..."

# Query a specific DB
pnpm timeline -- --db output/timeline/live/live_2025-03-10T14-30-00.db --entity 42
```

### Limits

- **MAX_ENTRIES**: 50,000 per session (rolling window, old entries pruned)
- **MAX_DB_FILES**: 10 (oldest DBs auto-deleted)
- **Flush**: every 500 entries or 1s
- **Prune**: every 30s

## Query CLI Reference

```
pnpm timeline [options]

Options:
  (no args)             Auto-show summary of failed test, or list if multiple
  --list                List all tests (default: only failed)
  --test <id>           Select a specific test
  --entity <id>         Filter by entity (searches entity_id, unit_id, building_id)
  --cat <category>      Filter by category
  --level <lvl>         Filter by level (debug, info, warn, error)
  --event <name>        Filter by event name
  --tick <from-to>      Filter by tick range
  --sql <query>         Run raw SQL
  --db <path>           Use a specific DB file
  --dir <test|live>     Directory: 'test' (default) or 'live'
  --console             Show captured console output
  --clean               Delete all timeline DBs
```

Also accessible from the game CLI: `pnpm cli "log --tail"` shows recent console output from the running game.

## SQL Examples

### Debugging a failed test

```sql
-- What happened? Top events by frequency
SELECT event, COUNT(*) AS n FROM timeline
WHERE test_id='<id>' GROUP BY event ORDER BY n DESC LIMIT 20

-- Errors and warnings
SELECT tick, event, detail FROM timeline
WHERE test_id='<id>' AND level IN ('warn', 'error') ORDER BY tick

-- Last 50 events before tick 5000
SELECT tick, category, event, detail FROM timeline
WHERE test_id='<id>' AND tick <= 5000 ORDER BY tick DESC LIMIT 50
```

### Entity investigation

```sql
-- Full history of an entity
SELECT tick, event, detail, meta FROM timeline
WHERE test_id='<id>' AND entity_id=42 ORDER BY tick

-- Where did a unit go?
SELECT tick, x, y, event FROM timeline
WHERE test_id='<id>' AND unit_id=42 AND x IS NOT NULL ORDER BY tick

-- What happened at a building?
SELECT tick, event, detail FROM timeline
WHERE test_id='<id>' AND building_id=100 ORDER BY tick
```

### Logistics debugging

```sql
-- Carrier activity
SELECT tick, unit_id, event, detail FROM timeline
WHERE test_id='<id>' AND category='carrier' ORDER BY tick

-- Logistics requests
SELECT tick, event, detail, meta FROM timeline
WHERE test_id='<id>' AND category='logistics' ORDER BY tick

-- Material flow: pickups and deliveries
SELECT tick, unit_id, event, detail FROM timeline
WHERE test_id='<id>' AND event IN ('carrier:pickup', 'carrier:delivered') ORDER BY tick
```

### Economy and production

```sql
-- Inventory changes
SELECT tick, building_id, event, detail FROM timeline
WHERE test_id='<id>' AND category='inventory' ORDER BY tick

-- Construction progress
SELECT tick, building_id, event, detail FROM timeline
WHERE test_id='<id>' AND event LIKE 'building:construction%' ORDER BY tick

-- Production events
SELECT tick, building_id, event, detail FROM timeline
WHERE test_id='<id>' AND event LIKE '%:produced' ORDER BY tick
```

### Live game analysis

```sql
-- Event distribution in live session
SELECT category, COUNT(*) AS n FROM timeline GROUP BY category ORDER BY n DESC

-- Hot entities (most events)
SELECT entity_id, entity_type, COUNT(*) AS n FROM timeline
WHERE entity_id IS NOT NULL GROUP BY entity_id ORDER BY n DESC LIMIT 20

-- Recent movement
SELECT tick, unit_id, unit_type, x, y FROM timeline
WHERE category='movement' ORDER BY tick DESC LIMIT 50

-- Player activity comparison
SELECT player, category, COUNT(*) AS n FROM timeline
WHERE player IS NOT NULL GROUP BY player, category ORDER BY player, n DESC
```

## Architecture

```
Browser (EventBus.emit)
  │
  ├── Test path: wireSimulationTimeline() patches emit
  │     └── recordTimelineEvent() → TimelineRecorder → SQLite (output/timeline/unit/)
  │
  └── Live path: TimelineCapture patches emit (lazy, only when subscribers > 0)
        └── batch buffer (200 entries / 500ms)
              └── WebSocket timeline:batch
                    └── Vite plugin relay
                          ├── auto-writes to SQLite (output/timeline/live/)
                          └── forwards to external subscribers (pnpm timeline:record)
```

### Key source files

| File | Role |
|------|------|
| `src/game/debug/timeline-recording.ts` | Pure event → entry extraction |
| `src/game/debug/timeline-capture.ts` | Browser-side lazy capture + batching |
| `src/game/debug/event-formatting.ts` | Human-readable event formatters |
| `scripts/timeline.mjs` | Query CLI |
| `scripts/lib/live-timeline-writer.ts` | SQLite writer (shared by both paths) |
| `scripts/timeline-receiver.ts` | Standalone WS → SQLite recorder |
| `vite-plugins/cli-ws-plugin.ts` | Vite relay + auto-recording |
| `tests/unit/helpers/simulation-timeline.ts` | Test harness EventBus wiring |
| `tests/unit/helpers/timeline-recorder.ts` | Test-side recorder with query API |
| `tests/unit/helpers/timeline-store.ts` | Multi-process-safe SQLite storage |
