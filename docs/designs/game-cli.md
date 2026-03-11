# Game CLI — Design

## Overview

A text-based command interface for controlling the browser game from an external Node.js process (LLM agent). The CLI engine runs in-browser, executing commands against the game's existing `Command` system. A WebSocket bridge (via Vite plugin) connects external clients to the in-browser CLI. Commands are short and token-efficient; state queries return compact text optimized for LLM consumption.

## Summary for Review

- **Interpretation**: Two-layer system: (1) an in-browser CLI engine (`GameCli`) that parses text commands and calls `game.execute()`, and (2) a WebSocket bridge via a Vite dev server plugin that relays commands from external Node.js clients to the browser and returns results. An LLM agent connects to `ws://localhost:5173/__cli__`, sends `"b WoodcutterHut 50 60"`, the browser executes it, and the result string comes back over the same WS.
- **Key decisions**:
  - **Two-layer split**: CLI engine is pure game logic (browser, testable headless). WS bridge is infrastructure (Vite plugin + browser WS client). Cleanly separated.
  - **Vite plugin as WS relay**: The Vite dev server's `configureServer` hook attaches a WebSocket upgrade handler at `/__cli__`. The browser game connects as the "executor" client. External clients (LLM) connect as "commander" clients. The plugin relays commands from commander → executor and results back.
  - Commands are short aliases (2-5 chars) to minimize tokens: `b` = build, `r` = recruit, `mv` = move, `inv` = inventory, `ls` = list entities
  - State queries return fixed-width columnar text, not JSON — compact and scannable
  - The CLI resolves enum names case-insensitively: `woodcutterhut` or `WoodcutterHut` both work
  - Player defaults to `currentPlayer` but can be overridden with `--p N`
  - `help` command lists all commands with syntax — the LLM can bootstrap itself
- **Assumptions**:
  - The game is already running (map loaded, systems ticking) when CLI is used
  - CLI command execution is synchronous (game.execute is sync). The WS layer is async but each command is a simple request/response — no streaming.
  - Only one game instance (one executor) at a time. Multiple commanders can connect but commands are serialized.
- **Scope**: Core action commands + state queries + WS bridge. Deferred: command macros, batch execution, scripted sequences, undo, authentication.
- **New dependency**: `minimist` + `@types/minimist` — lightweight argv parser (~1KB, zero deps) for flag/positional parsing in the CLI engine

## Conventions

- Optimistic programming: no `?.` on required deps, `getEntityOrThrow()`, throw with context
- Use enum members (`BuildingType.WoodcutterHut`), never numeric literals
- Not a feature module — lives in `src/game/cli/` as a utility layer (L6, same as debug bridge)
- Max 140 chars line length, max cyclomatic complexity 15
- All mutations through `game.execute()` — CLI never mutates state directly
- `Readonly<T>` from queries to prevent mutation

## Architecture

### Data Flow

```
LLM Agent (Node.js)           Vite Dev Server              Browser (Game)
       │                            │                            │
       │── ws connect ──────────────│                            │
       │   (commander)              │                            │
       │                            │──── ws connect ────────────│
       │                            │     (executor)             │
       │                            │                            │
       │── "b WoodcutterHut 50 60" ─│── relay to executor ──────│
       │                            │                            │── cli.run("b ...")
       │                            │                            │── game.execute(cmd)
       │                            │←── "ok" ───────────────────│
       │←── "ok" ───────────────────│                            │
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | CLI engine | Parse input, dispatch to handlers, format output | — | `cli.ts` |
| 2 | Action commands | Build, recruit, move, garrison, production, storage | 1 | `commands/actions.ts` |
| 3 | Query commands | List entities, inventory, map state, economy stats | 1 | `commands/queries.ts` |
| 4 | Enum resolver | Case-insensitive name→enum mapping for BuildingType, UnitType, EMaterialType | — | `enum-resolver.ts` |
| 5 | Output formatter | Compact columnar text rendering for entity lists, inventories | — | `formatter.ts` |
| 6 | Vite WS plugin | Vite `configureServer` plugin — WS upgrade handler at `/__cli__`, relays between commander/executor | — | `vite-plugins/cli-ws-plugin.ts` |
| 7 | Browser WS client | Connects to `/__cli__` as executor, wires incoming commands to `cli.run()` | 1 | `src/game/cli/ws-client.ts` |
| 8 | Node.js client | Thin WS client for external consumers (LLM agent, scripts) | — | `src/game/cli/node-client.ts` |
| 9 | Bridge wiring | createCli factory, expose on debug bridge, integration test | 1,7 | `index.ts`, test file |

## Shared Contracts

```typescript
// ─── src/game/cli/types.ts ────────────────────────────────────

import type { ParsedArgs } from 'minimist';
import type { GameCore } from '@/game/game-core';

/** Result of a CLI command execution. */
export interface CliResult {
    /** true if the command succeeded */
    ok: boolean;
    /** Human/LLM-readable output text */
    output: string;
}

/** A registered CLI command handler. */
export interface CliCommand {
    /** Primary name (short alias like "b", "mv", "ls") */
    name: string;
    /** Longer aliases (e.g., "build", "move", "list") */
    aliases: string[];
    /** One-line usage string for help */
    usage: string;
    /** Brief description */
    desc: string;
    /** Execute the command. Args are minimist-parsed (_.positional, flags as properties). */
    execute(args: ParsedArgs, ctx: CliContext): CliResult;
}

/** Context passed to every command handler. */
export interface CliContext {
    game: GameCore;
    /** The player index used for commands (defaults to game.currentPlayer, override with --p) */
    player: number;
    /** Resolve a building name to BuildingType (case-insensitive, throws on unknown) */
    resolveBuilding(name: string): number;
    /** Resolve a unit name to UnitType (case-insensitive, throws on unknown) */
    resolveUnit(name: string): number;
    /** Resolve a material name to EMaterialType (case-insensitive, throws on unknown) */
    resolveMaterial(name: string): number;
    /** Format a compact output table */
    fmt: OutputFormatter;
}

/** Compact text table builder. */
export interface OutputFormatter {
    /** Format rows as aligned columns. Headers are optional. */
    table(rows: string[][], headers?: string[]): string;
    /** Format a key-value summary (one per line). */
    kv(entries: [string, string | number][]): string;
}

// ─── WebSocket protocol ───────────────────────────────────────

/** Message from commander (external) → Vite server → executor (browser). */
export interface WsCommandMessage {
    id: number;        // Request ID for correlating responses
    cmd: string;       // The CLI command string (e.g., "b WoodcutterHut 50 60")
}

/** Message from executor (browser) → Vite server → commander (external). */
export interface WsResultMessage {
    id: number;        // Matches the request ID
    ok: boolean;
    output: string;
}

/** Registration message from browser to identify as the game executor. */
export interface WsRegisterMessage {
    type: 'register';
    role: 'executor';
}
```

```typescript
// ─── src/game/cli/node-client.ts ──────────────────────────────

/** Thin Node.js client for sending CLI commands to the running game. */
export interface GameCliClient {
    /** Send a command and wait for the result. */
    run(command: string): Promise<CliResult>;
    /** Close the WebSocket connection. */
    close(): void;
    /** Whether the game executor is connected. */
    readonly connected: boolean;
}

/** Connect to the game's CLI WebSocket. */
export function connectGameCli(url?: string): Promise<GameCliClient>;
// Default url: 'ws://localhost:5173/__cli__'
```

## Command Reference

### Action Commands

| Command | Alias | Syntax | Maps to |
|---------|-------|--------|---------|
| `b` | `build` | `b <Type> <x> <y> [--done] [--p N]` | `place_building` (--done sets completed) |
| `r` | `recruit` | `r <UnitType> [count=1] [--p N]` | `recruit_specialist` |
| `mv` | `move` | `mv <entityId> <x> <y>` | `move_unit` |
| `rm` | `remove` | `rm <entityId>` | `remove_entity` |
| `gar` | `garrison` | `gar <buildingId> <unitId1> [unitId2...]` | `garrison_units` |
| `ugar` | `ungarrison` | `ugar <buildingId> <unitId>` | `ungarrison_unit` |
| `prod` | `production` | `prod <buildingId> <mode>` | `set_production_mode` |
| `recipe` | — | `recipe <buildingId> <idx> <weight>` | `set_recipe_proportion` |
| `sf` | `storfilter` | `sf <buildingId> <material> <import\|export\|null>` | `set_storage_filter` |
| `spawn` | — | `spawn <UnitType> <x> <y> [--p N]` | `spawn_unit` (debug) |
| `pile` | — | `pile <material> <amount> <x> <y>` | `place_pile` (debug) |
| `sel` | `select` | `sel <entityId>` | `select` |

### Query Commands

| Command | Alias | Syntax | Returns |
|---------|-------|--------|---------|
| `ls` | `list` | `ls [buildings\|units\|military] [--p N]` | Entity table (id, type, pos, status) |
| `inv` | `inventory` | `inv <buildingId>` | Building inventory (inputs/outputs with amounts) |
| `e` | `entity` | `e <entityId>` | Single entity details |
| `econ` | `economy` | `econ [--p N]` | Economy summary (building counts, material totals) |
| `map` | — | `map <x> <y> [radius=5]` | Tile grid showing terrain + entities in area |
| `tick` | — | `tick` | Current tick number |
| `help` | `h` | `help [command]` | Command list or specific command usage |
| `find` | — | `find <BuildingType\|UnitType> [--p N]` | Find entities of a given type, return id+pos |

## Subsystem Details

### 1. CLI Engine
**Files**: `src/game/cli/cli.ts`
**Key decisions**:
- `run(input: string): CliResult` — single entry point
- Uses `minimist` to parse args: splits input on whitespace, passes to `minimist(tokens.slice(1))`. Extracts `--p` (number, player override), `--done` (boolean flag), positional args from `_`.
- Command lookup is a `Map<string, CliCommand>` populated at construction — both `name` and `aliases` are registered as keys
- Unknown command → `{ ok: false, output: "unknown command 'foo'. try 'help'" }`
- Handler errors are caught and returned as `{ ok: false, output: error.message }`

### 2. Action Commands
**Files**: `src/game/cli/commands/actions.ts`
**Key decisions**:
- Each function returns a `CliCommand` object (factory pattern, takes no deps — deps come via `CliContext`)
- `b` command: requires type, x, y. Sets `completed: true` when `--done` flag present. Sets `spawnWorker: true` always (mirrors normal gameplay).
- `r` command: count defaults to 1. Uses current camera position as nearX/nearY (or 0,0 if headless). Race from `gameState.playerRaces`.
- `mv` command: just wraps `move_unit`. No formation — single unit movement.
- All action commands return `"ok"` on success or the error from `CommandResult.error`

### 3. Query Commands
**Files**: `src/game/cli/commands/queries.ts`
**Key decisions**:
- `ls buildings` — iterates `entityIndex.ofTypeAndPlayer(EntityType.Building, player)`, shows: `id type x,y status`
  - Status = construction phase or "ready"
- `ls units` — same for units, shows: `id type x,y carrying`
- `ls military` — filters units to `isUnitTypeMilitary()`
- `inv <id>` — shows input/output slots as `material: current/max (reserved)`, compact one-liner per slot
- `econ` — aggregated: building counts by type, total material counts across all storage areas
  - Material counts: iterate all buildings with inventories, sum up per-material
- `map` — renders a simple text grid showing terrain type codes and entity markers within a radius
  - Terrain codes: `.`=grass, `^`=mountain, `~`=water, `T`=tree, `B`=building, `U`=unit, `P`=pile
  - Compact enough for LLM context (10x10 default radius = ~20 lines)
- `find` — searches by subType, returns compact `id x,y` list

### 4. Enum Resolver
**Files**: `src/game/cli/enum-resolver.ts`
**Key decisions**:
- At module load, builds `Map<lowercase_name, enum_value>` for each enum (BuildingType, UnitType, EMaterialType)
- Also accepts raw numeric strings: `"3"` → `BuildingType.Sawmill`
- Throws with "unknown building type 'foo'. valid: WoodcutterHut, StorageArea, ..." (lists all valid names)

### 5. Output Formatter
**Files**: `src/game/cli/formatter.ts`
**Key decisions**:
- `table()` — pads columns to max width, separates with `  ` (2 spaces). No box-drawing chars (wastes tokens).
- `kv()` — `key: value` lines, right-aligns keys
- Numbers are never padded with zeros
- Entity types shown as enum name strings, not numbers

### 6. Vite WS Plugin
**Files**: `vite-plugins/cli-ws-plugin.ts`
**Key decisions**:
- Uses Vite's `configureServer` hook to intercept HTTP upgrade requests at path `/__cli__`
- Uses the `ws` package (already a Vite transitive dep) for WebSocket handling
- Tracks two client roles: one **executor** (the browser game) and N **commanders** (LLM agents)
- When a commander sends a `WsCommandMessage`, relay it to the executor. When the executor responds with `WsResultMessage`, relay it back to the commander that sent the matching `id`.
- If no executor is connected, commands return `{ ok: false, output: "game not connected" }`
- Commands are serialized — only one in-flight command per commander at a time (simple, avoids race conditions)
- Heartbeat ping/pong every 30s to detect stale connections

### 7. Browser WS Client
**Files**: `src/game/cli/ws-client.ts`
**Key decisions**:
- `connectCliWs(cli: GameCli): void` — called from `Game` constructor after CLI is created
- Connects to `ws://${location.host}/__cli__` with auto-reconnect (1s backoff, max 5 retries)
- On connect, sends `{ type: 'register', role: 'executor' }`
- On incoming `WsCommandMessage`, calls `cli.run(msg.cmd)` and sends back `WsResultMessage`
- Only activates in dev mode (`import.meta.env.DEV`) — no WS in production builds

### 8. Node.js Client
**Files**: `src/game/cli/node-client.ts`
**Key decisions**:
- Uses the `ws` npm package (same as Vite plugin)
- `connectGameCli(url?)` returns a `Promise<GameCliClient>` that resolves when WS is open
- `run(command)` returns `Promise<CliResult>` — assigns an incrementing `id`, sends `WsCommandMessage`, waits for matching `WsResultMessage`
- Timeout per command: 5s (game commands are instant, so any timeout means something is wrong)
- This file is importable from Node.js scripts, test harnesses, and MCP tools

### 9. Bridge Wiring
**Files**: `src/game/cli/index.ts`
**Key decisions**:
- Exports `createCli(game: GameCore): GameCli` factory
- `GameCli` wraps the CLI engine and exposes `run(input): CliResult` and `runText(input): string` (returns just `output`)
- Wired in `Game` constructor: `bridge.cli = createCli(this)` + `connectCliWs(bridge.cli)`
- Also exports the `GameCli` class for direct use in tests (headless, no WS needed)

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/cli/types.ts` | — | Shared types (CliResult, CliCommand, CliContext, WS protocol messages) |
| `src/game/cli/cli.ts` | 1 | CLI engine — parse, dispatch, format |
| `src/game/cli/commands/actions.ts` | 2 | Action command definitions |
| `src/game/cli/commands/queries.ts` | 3 | Query command definitions |
| `src/game/cli/enum-resolver.ts` | 4 | Case-insensitive enum resolution |
| `src/game/cli/formatter.ts` | 5 | Compact text output formatting |
| `vite-plugins/cli-ws-plugin.ts` | 6 | Vite plugin — WS relay server at `/__cli__` |
| `src/game/cli/ws-client.ts` | 7 | Browser-side WS executor client |
| `src/game/cli/node-client.ts` | 8 | Node.js WS commander client |
| `src/game/cli/index.ts` | 9 | Public barrel, createCli factory |
| `tests/unit/cli/game-cli.spec.ts` | 9 | Integration test — CLI engine (headless, no WS) |

### Modified Files
| File | Change |
|------|--------|
| `src/game/debug/debug-bridge.ts` | Add `cli?: GameCli` to `SettlersBridge` interface |
| `src/game/game.ts` | Wire `createCli(this)` + `connectCliWs()` after game init |
| `vite.config.ts` | Add `cliWsPlugin()` to plugins array |
| `package.json` | Add `minimist`, `@types/minimist` as deps |

## Verification
1. **Build + query roundtrip**: `run("b WoodcutterHut 50 60 --done")` → `"ok"`, then `run("ls buildings")` shows the building at 50,60
2. **Enum resolution**: `run("b woodcutterhut 50 60")` works (case-insensitive), `run("b FakeBuilding 50 60")` returns error listing valid types
3. **Compact inventory**: `run("inv 42")` returns a compact table with material names, amounts, and max capacity — fits in ~5 lines for a typical building
4. **Economy overview**: `run("econ")` returns building counts and material totals in under 20 lines for a mid-game state
5. **Help self-documentation**: `run("help")` lists all commands with syntax; `run("help b")` shows detailed usage for build command
6. **WS end-to-end**: Start dev server, open game in browser, run `connectGameCli()` from Node.js, send `"ls buildings"` — get back building list from the live game
7. **No executor**: Connect Node.js client before browser opens game — `run()` returns `"game not connected"` error
