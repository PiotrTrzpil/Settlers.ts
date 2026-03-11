# In-Game Timeline Recording via WS Bridge — Design

## Overview

Stream game timeline events from the browser to a Node.js process via the existing CLI WebSocket channel. This enables live recording of all `EventBus.emit()` calls to a SQLite database during development, using the same TimelineWriter and query tools already used in tests.

## Current State

- **Timeline recording** lives entirely in `tests/unit/helpers/`: `simulation-timeline.ts` (event extraction), `timeline-recorder.ts` (recording API), `timeline-store.ts` (SQLite storage), `timeline-formatter.ts` (display formatting).
- **Event formatting** (`EventFmt`) already lives in `src/game/debug/event-formatting.ts` — properly placed.
- **CLI WS channel** (`/__cli__`) is command/response only: commanders send `{id, cmd}`, executor responds `{id, ok, output}`. The relay serializes one command at a time.
- **`wireSimulationTimeline()`** monkey-patches `eventBus.emit()` to capture all events — same approach will work in the browser.

## Summary for Review

- **Interpretation**: Extract the pure event-extraction logic from test helpers into `src/game/debug/` so both test and browser code share it. In the browser, wire `EventBus.emit()` the same way tests do, but instead of writing to SQLite, buffer and push entries over WS to a subscribed Node.js receiver that writes to SQLite via the existing `TimelineWriter`.
- **Key decisions**:
  - Extend the WS relay with a pub/sub channel alongside the existing command/response protocol (new message types, not CLI commands)
  - The browser only captures and sends when at least one subscriber exists (opt-in, zero overhead when unused)
  - The receiver process is a standalone script (like `scripts/cli.ts`), not embedded in the Vite plugin
  - Reuse `TimelineWriter` and `TimelineQueryOpts` directly — the same SQLite schema, same `pnpm timeline` CLI
- **Assumptions**:
  - Timeline entries are batched (every N entries or every M ms) to avoid per-event WS overhead
  - DB files go to `data/.timeline/` (not `tests/unit/.timeline/`) to separate live recordings from test runs
  - The `pnpm timeline` script gets a `--dir` flag to switch between test and live directories
- **Scope**: Recording + querying. No UI timeline viewer. No production builds (dev-only like the CLI).

## Conventions

- Optimistic programming: no `?.` on required deps, throw with context, no silent fallbacks
- Events use `domain:pastTense` naming (e.g., `timeline:subscribed`)
- Max 140 chars per line (TS), max cyclomatic complexity 15
- Feature code in `src/game/`, debug tooling in `src/game/debug/`
- CLI commands implement `CliCommand` interface (`name`, `aliases`, `usage`, `desc`, `execute`)
- WS message types defined in `src/game/cli/types.ts`
- Node.js scripts in `scripts/`, use `tsx` runner
- Dev-only code guards: `import.meta.env.DEV` in browser, Vite plugin `apply: 'serve'`

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Shared extraction | Pure functions to convert `(event, payload)` → `TimelineEntry` | — | `src/game/debug/` |
| 2 | Browser capture | Wire EventBus → buffer entries → push over WS when subscribed | 1 | `src/game/debug/` |
| 3 | WS protocol | Relay extension for timeline subscribe/unsubscribe/batch messages | — | `vite-plugins/`, `src/game/cli/types.ts` |
| 4 | Node.js receiver | Subscribe to timeline stream, write batches to SQLite | 3 | `scripts/` |
| 5 | CLI integration | `timeline` CLI command + `pnpm timeline` multi-dir support | 4 | `scripts/`, `src/game/cli/` |

## Shared Contracts

```typescript
// ─── src/game/cli/types.ts (add to existing file) ────────────────

/** Commander → relay → executor: start streaming timeline entries. */
interface WsTimelineSubscribe {
    type: 'timeline:subscribe';
}

/** Commander → relay → executor: stop streaming timeline entries. */
interface WsTimelineUnsubscribe {
    type: 'timeline:unsubscribe';
}

/** Executor → relay → subscribed commanders: batch of timeline entries. */
interface WsTimelineBatch {
    type: 'timeline:batch';
    entries: SerializedTimelineEntry[];
}

/** Executor → relay → all subscribers: recording stopped (e.g., game destroyed). */
interface WsTimelineEnd {
    type: 'timeline:end';
}

/** Union of all WS messages that bypass the command/response queue. */
type WsPushMessage = WsTimelineBatch | WsTimelineEnd;
type WsControlMessage = WsTimelineSubscribe | WsTimelineUnsubscribe;

// ─── src/game/debug/timeline-recording.ts (new, extracted from tests) ─

/** Serializable timeline entry — matches the SQLite schema columns. */
interface SerializedTimelineEntry {
    tick: number;
    category: string;          // TimelineCategory
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
    meta?: string;             // JSON string of remaining payload fields
}

/**
 * Convert a raw EventBus event + payload into a SerializedTimelineEntry.
 * Pure function — no side effects, no DB access.
 */
function recordTimelineEvent(
    tick: number,
    event: string,
    payload: Record<string, unknown>
): SerializedTimelineEntry;

/** Map event namespace → timeline category. */
const CATEGORY_MAP: Record<string, string>;

/** Entity ID field priority — first match wins. */
const ENTITY_ID_KEYS: readonly { key: string; type: string }[];

/** Keys extracted into dedicated columns (excluded from `meta`). */
const EXTRACTED_KEYS: ReadonlySet<string>;
```

## Subsystem Details

### 1 — Shared Extraction
**Files**: `src/game/debug/timeline-recording.ts`
**Key decisions**:
- Move `recordTimelineEvent`, `CATEGORY_MAP`, `ENTITY_ID_KEYS`, `EXTRACTED_KEYS`, `CATEGORY_ENTITY_TYPE`, `extractNum`, `buildMeta`, `formatSlots` from `tests/unit/helpers/simulation-timeline.ts` into this new file
- `recordTimelineEvent` returns a `SerializedTimelineEntry` instead of calling `timeline.record()` — the caller decides what to do with it (write to DB in tests, send over WS in browser)
- `wireSimulationTimeline` stays in `tests/unit/helpers/simulation-timeline.ts` but imports from here and adapts (calls `recordTimelineEvent` → passes result to `timeline.record()`)
- `SerializedTimelineEntry` matches the existing `TimelineEntry` from `timeline-recorder.ts` — tests can use either type (they're structurally identical)

### 2 — Browser Capture
**Files**: `src/game/debug/timeline-capture.ts`, modifications to `src/game/game.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- New class `TimelineCapture` with `start(eventBus, getTickCount)` / `stop()` / `addSubscriber()` / `removeSubscriber()` methods
- Monkey-patches `eventBus.emit` the same way `wireSimulationTimeline` does — calls `recordTimelineEvent()`, buffers entries
- Buffers entries in an array, flushes via a callback (`onFlush: (entries) => void`) every 200 entries or every 500ms (whichever comes first), using `setInterval`
- Only captures when `subscriberCount > 0` — on first subscriber, patches emit; on last unsubscribe, restores original emit and flushes remaining
- `Game` constructor wires this up: creates `TimelineCapture`, connects it to the WS client so `addSubscriber`/`removeSubscriber` are called on subscribe/unsubscribe messages, and `onFlush` sends a `WsTimelineBatch`
- Dev-only: guarded by `import.meta.env.DEV`
- Expose on debug bridge: `getBridge().timelineCapture = capture`

### 3 — WS Protocol Extension
**Files**: `vite-plugins/cli-ws-plugin.ts`, `src/game/cli/types.ts`, `src/game/cli/ws-client.ts`
**Key decisions**:
- The relay maintains a `Set<WebSocket>` of timeline subscribers
- When a commander sends `timeline:subscribe`, relay adds it to the set and forwards to executor
- When executor sends `timeline:batch`, relay forwards to all subscribers (bypasses the pending command queue)
- When a commander disconnects, relay removes it from subscribers and notifies executor if count dropped to 0
- When executor sends `timeline:end`, relay forwards to all subscribers and clears the set
- Message discrimination: check for `type` field presence first — existing `WsCommandMessage` and `WsResultMessage` don't have a `type` field, so there's no ambiguity
- `ws-client.ts`: extend `onmessage` to handle `timeline:subscribe`/`timeline:unsubscribe` messages by calling `TimelineCapture.addSubscriber()`/`removeSubscriber()`. The subscriber count is abstract (the WS client just increments/decrements a counter on the capture instance)

### 4 — Node.js Receiver
**Files**: `scripts/timeline-receiver.ts`
**Depends on**: Subsystem 3
**Key decisions**:
- Standalone script: `pnpm timeline:record` (or started automatically by the CLI `timeline` command)
- Connects to `/__cli__` as a commander, sends `timeline:subscribe`
- On `timeline:batch` messages, writes entries to SQLite via `TimelineWriter` (import from `tests/unit/helpers/timeline-store.ts` — it's pure Node.js + better-sqlite3, works outside tests)
- Uses `data/.timeline/` directory with timestamp-based DB filenames (same naming as test runs)
- `testId` for the writer: use a session ID like `live_<ISO-timestamp>`
- On `timeline:end` or WS close, calls `writer.finalize()` and exits
- On SIGINT, sends `timeline:unsubscribe`, finalizes, exits cleanly

### 5 — CLI Integration
**Files**: `scripts/timeline.mjs`, `src/game/cli/commands/queries.ts` (optional in-game command)
**Depends on**: Subsystem 4
**Key decisions**:
- `scripts/timeline.mjs`: add `--dir` flag (`test` | `live`, default `test`). When `live`, reads from `data/.timeline/` instead of `tests/unit/.timeline/`
- Add `pnpm timeline:live` script alias that runs `pnpm timeline -- --dir live`
- Optional in-game CLI command `timeline` that starts recording via the WS channel (sends subscribe from within the browser — useful for debugging from the game's own CLI, less useful for external tooling)
- The in-game `timeline` command is lower priority — the Node.js receiver is the primary path

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/debug/timeline-recording.ts` | 1 | Pure event extraction (shared by test + browser) |
| `src/game/debug/timeline-capture.ts` | 2 | Browser-side EventBus → WS buffer |
| `scripts/timeline-receiver.ts` | 4 | Node.js subscriber that writes to SQLite |

### Modified Files
| File | Change |
|------|--------|
| `tests/unit/helpers/simulation-timeline.ts` | Import extraction functions from `timeline-recording.ts` instead of defining them |
| `src/game/cli/types.ts` | Add `WsTimelineSubscribe`, `WsTimelineUnsubscribe`, `WsTimelineBatch`, `WsTimelineEnd` types |
| `vite-plugins/cli-ws-plugin.ts` | Add subscriber tracking and timeline message routing |
| `src/game/cli/ws-client.ts` | Handle incoming subscribe/unsubscribe control messages, wire to `TimelineCapture` |
| `src/game/game.ts` | Create `TimelineCapture` instance, wire to WS client (dev-only) |
| `src/game/debug/debug-bridge.ts` | Add `timelineCapture` to `SettlersBridge` interface |
| `scripts/timeline.mjs` | Add `--dir` flag for live vs test timeline directories |
| `package.json` | Add `timeline:record` and `timeline:live` script aliases |

## Verification

1. **Round-trip**: Start dev server → run `pnpm timeline:record` → play the game for 10 seconds → Ctrl-C the receiver → `pnpm timeline:live` shows events with correct ticks, categories, and entity IDs
2. **Lazy capture**: With no receiver connected, confirm zero overhead — `EventBus.emit` is not patched, no buffering occurs
3. **Reconnect**: Kill and restart the receiver — it gets a new DB file, starts recording cleanly without duplicate entries
4. **Shared code**: Run `pnpm test:unit` — existing integration tests still pass using the same extraction logic from the new shared location
