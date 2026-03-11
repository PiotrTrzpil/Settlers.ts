# Game CLI

A WebSocket-based command interface for controlling and inspecting a running game instance.

## Usage

```sh
pnpm cli "<command>"          # single command, returns result and exits
pnpm cli                      # interactive REPL (type "exit" to quit)
```

Connects to `ws://localhost:5173/__cli__`, falls back to `:5174`. Override with `CLI_URL`:

```sh
CLI_URL=ws://localhost:5174/__cli__ pnpm cli "tick"
```

Large outputs (>4KB) are saved to `/tmp/cli-result.json`.

## Commands

### Queries

| Command | Usage | Description |
|---------|-------|-------------|
| `ls` | `ls [buildings\|units\|military] [--p N] [--n N]` | List entities. Default: buildings. `--n` limits rows (default 30) |
| `find` | `find <BuildingType\|UnitType> [--p N] [--n N]` | Find all entities of a type |
| `e` | `e <entityId>` | Entity details: type, pos, player, carrying, status |
| `inv` | `inv <buildingId>` | Building inventory: input/output slots, amounts, reservations |
| `econ` | `econ [--p N]` | Economy overview: building counts + material totals |
| `map` | `map <x> <y> [size] [--layer ...]` | Text map around a point |
| `tick` | `tick` | Current tick and running/paused status |
| `log` | `log [--n N] [--tail] [--level warn\|error]` | Console logs. Default: new since last drain. `--tail`: recent |
| `js` | `js <expression>` | Eval JS with game scope |
| `help` | `help [command]` | List commands or show usage |

### Actions

| Command | Usage | Description |
|---------|-------|-------------|
| `b` | `b <Type> <x> <y> [--done] [--p N]` | Place building. `--done` skips construction |
| `r` | `r <UnitType> [count] [--p N]` | Recruit specialist units |
| `mv` | `mv <entityId> <x> <y>` | Move unit to position |
| `rm` | `rm <entityId>` | Remove entity |
| `spawn` | `spawn <UnitType> <x> <y> [--p N]` | Spawn unit (debug) |
| `pile` | `pile <material> <amount> <x> <y>` | Place material pile (debug) |
| `sel` | `sel <entityId>` | Select entity (highlights in browser) |
| `gar` | `gar <buildingId> <unitId1> [...]` | Garrison units |
| `ugar` | `ugar <buildingId> <unitId>` | Remove unit from garrison |
| `prod` | `prod <buildingId> <mode>` | Production mode: `even\|proportional\|manual` |
| `recipe` | `recipe <buildingId> <idx> <weight>` | Set recipe proportion weight |
| `sf` | `sf <buildingId> <material> <import\|export\|null>` | Storage area filter |

### Economy & Logistics

| Command | Usage | Description |
|---------|-------|-------------|
| `carriers` | `carriers [--p N] [--n N]` | Carrier status: idle/busy, carrying, assigned job, destination |
| `reqs` | `reqs [--p N] [--n N]` | Pending and in-progress material requests with diagnostics |
| `piles` | `piles [--p N] [--n N] [--kind free\|output\|input\|storage\|construction]` | Material piles on the ground, with totals |
| `workers` | `workers [--p N] [--n N] [--state idle\|working\|interrupted]` | Worker status: state, assigned building, job |
| `jobs` | `jobs [--p N] [--n N]` | Active transport jobs (carrier → material → destination) |
| `diag` | `diag [--p N]` | Economy diagnostics: detect bottlenecks |
| `player` | `player [N\|reset]` | Show/set sticky player override for all subsequent commands |

### Common flags

- `--p N` — player number (default: 0)
- `--n N` — row limit (default: 30)
- `--kind` — pile type filter (free, output, input, storage, construction)
- `--state` — worker state filter (idle, working, interrupted)

## Map Rendering

```sh
pnpm cli "map 281 133 lg --layer terrain,buildings,units"
```

**Size presets**: `sm` (default), `md`, `lg`, `xl`, or a numeric radius.

**Layers** (comma-separated): `terrain`, `buildings`, `units`, `objects`, `piles`. Default: all.

**Symbols**:
```
~ water   , beach   . grass   ^ rock   B building   G guard tower
c carrier   w worker   ! melee   > ranged   + other unit
T tree   $ resource   P pile
```

## JS Eval

The `js` command evaluates expressions with these scope variables:

| Variable | System |
|----------|--------|
| `game` | Game instance |
| `state` | GameState (entities, map) |
| `services` | All game services |
| `terrain` | Terrain queries |
| `movement` | Movement system |
| `inventory` | Inventory manager |
| `construction` | Construction site manager |
| `tasks` | Settler task system |
| `combat` | Combat system |
| `garrison` | Garrison manager |
| `territory` | Territory manager |
| `recruit` | Recruit system |
| `logistics` | Logistics dispatcher |
| `requests` | Request manager |
| `carriers` | Carrier registry |
| `storage` | Storage filter manager |

```sh
pnpm cli "js state.getEntity(4807)"
pnpm cli "js terrain.getHeightAt(100, 100)"
pnpm cli "js state.entityIndex.ofTypeAndPlayer(1, 0).length"
pnpm cli "js logistics"
```

Run with no expression to see available scope: `pnpm cli "js"`.

## Type Names

Commands accept enum names (case-insensitive). Examples:

- **Buildings**: `Sawmill`, `WoodcutterHut`, `StorageArea`, `GuardTowerSmall`, `ForesterHut`, `GrainFarm`, `ResidenceSmall`
- **Units**: `Carrier`, `Swordsman`, `Bowman`, `Builder`, `Woodcutter`, `Miner`
- **Materials**: `LOG`, `BOARD`, `STONE`, `IRONBAR`, `GRAIN`

See `CLAUDE.md` for full naming conventions.

## Timeline Access

Console logs from the running game are available via `log`. For full event timeline recording and SQL queries, see [TIMELINE.md](TIMELINE.md).

## Architecture

```
pnpm cli ──WebSocket──► Vite plugin relay (/__cli__) ──► Browser executor
                              │
                              └── also handles timeline streaming
```

**Source files**:

| File | Role |
|------|------|
| `scripts/cli.ts` | Node.js CLI entry point |
| `src/game/cli/cli.ts` | Command router |
| `src/game/cli/commands/queries.ts` | Read-only commands |
| `src/game/cli/commands/actions.ts` | Mutation commands |
| `src/game/cli/commands/economy.ts` | Economy & logistics commands |
| `src/game/cli/map-renderer.ts` | Text map rendering |
| `src/game/cli/map-symbols.ts` | Map symbol/layer/viewport config |
| `src/game/cli/enum-resolver.ts` | Fuzzy enum name matching |
| `src/game/cli/formatter.ts` | Table/KV output formatting |
| `src/game/cli/node-client.ts` | Node.js WebSocket client |
| `src/game/cli/ws-client.ts` | Browser-side WS handler |
| `vite-plugins/cli-ws-plugin.ts` | Vite WS relay plugin |
