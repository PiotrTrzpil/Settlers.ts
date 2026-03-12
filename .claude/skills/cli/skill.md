---
name: cli
description: Run CLI commands against the live game for controlling gameplay, inspecting state, and investigating bugs.
argument-hint: <command or goal, e.g. "show economy", "map around castle", "find all swordsmen">
---

You have access to the game CLI via `pnpm cli "<command>"`. The CLI connects to the running dev server over WebSocket.

Full docs: `docs/CLI.md` (commands, JS eval scope, map rendering), `docs/TIMELINE.md` (event recording, SQL queries), and `docs/MECHANICS.md` (game mechanics — how territory, economy, production, workers, and military work).

- Tries `ws://localhost:5173/__cli__` then `ws://localhost:5174/__cli__`
- Large outputs (>4KB) are saved to `/tmp/cli-result.json` — read that file to see the result

```sh
pnpm cli "<command>"          # single command
pnpm cli                      # interactive REPL
```

## User Request

$ARGUMENTS

## Quick Reference

### Queries
`ls [buildings|units|military]`, `find <Type>`, `e <id>`, `inv <buildingId>`, `econ [--p N]`, `map <x> <y> [sm|md|lg|xl]`, `tick`, `log [--tail]`, `js <expr>`, `help`

### Economy & Logistics
`carriers [--p N]`, `reqs [--p N]`, `piles [--kind free|output|input|storage|construction]`, `workers [--state idle|working|interrupted]`, `jobs [--p N]`, `diag [--p N]`

### Actions
`b <Type> <x> <y> [--done]`, `r <UnitType> [count]`, `mv <id> <x> <y>`, `rm <id>`, `spawn <UnitType> <x> <y>`, `pile <material> <amount> <x> <y>`, `sel <id>`, `gar/ugar`, `prod <id> <mode>`, `recipe <id> <idx> <weight>`, `sf <id> <material> <import|export|null>`, `player [N|reset]`

### Flags
`--p N` (player), `--n N` (row limit), `--done` (skip construction), `--tail` (recent logs), `--level warn|error`, `--kind` (pile type filter), `--state` (worker state filter)

### Map symbols
`~` water, `,` beach, `.` grass, `B` building, `G` guard tower, `c` carrier, `w` worker, `!` melee, `>` ranged, `T` tree, `$` resource, `P` pile, `+` other unit

### Type names (case-insensitive)
Buildings: `Sawmill`, `WoodcutterHut`, `StorageArea`, `GuardTowerSmall`, `ForesterHut`
Units: `Carrier`, `Swordsman`, `Bowman`, `Builder`, `Woodcutter`, `Miner`
Materials: `LOG`, `BOARD`, `STONE`, `IRONBAR`, `GRAIN`

## JS Eval — API Cheat Sheet

**CRITICAL: Do NOT guess the game API.** Methods like `.summary()`, `.getIdleUnits()`, `.stallDetector` do NOT exist. You MUST discover the API before calling it.

**Discover the API before calling it.** Two approaches:

1. **Codebase Memory MCP (preferred)** — use `search_graph` or `search_code` to find actual method names and signatures before writing `js` expressions:
   ```
   search_graph(name_pattern='.*SettlerTask.*', label='Class')
   search_code(query='getIdleUnits')
   get_code_snippet(file='src/game/features/settler-tasks/settler-task-system.ts', symbol='SettlerTaskSystem')
   ```

2. **Runtime introspection** — discover at runtime via the CLI:
   ```sh
   pnpm cli "js Object.keys(tasks)"                              # list properties
   pnpm cli "js Object.getOwnPropertyNames(Object.getPrototypeOf(tasks))"  # list methods
   pnpm cli "js typeof tasks.someMethod"                          # check if method exists
   ```

**Shell escaping**: Avoid `!` in shell strings (zsh mangles it). Use double-quoted commands: `pnpm cli "js ..."`. For complex expressions, prefer the built-in commands (`ls`, `find`, `e`, `inv`) over `js`.

### Entity access
```js
// Entities are accessed via state.entityIndex, NOT game.units/game.buildings
state.getEntity(4807)                                          // single entity by ID
state.entityIndex.ofTypeAndPlayer(1, 0)                        // EntityType.Unit=1, player 0
// Entity properties: .id, .type, .subType, .x, .y, .player, .carrying, .hidden
```

### Common js queries
```sh
pnpm cli "js state.getEntity(4807)"                            # inspect one entity
pnpm cli "js terrain.getHeightAt(100, 100)"                    # terrain query
pnpm cli "js tasks"                                            # settler task system
pnpm cli "js logistics"                                        # logistics dispatcher
pnpm cli "js inventory.getInventory(buildingId)"               # building inventory
pnpm cli "js construction.getSite(buildingId)"                 # construction progress
```

### Scope variables
`game` `state` `services` `terrain` `movement` `inventory` `construction` `tasks` `combat` `garrison` `territory` `recruit` `logistics` `requests` `carriers` `storage`

Run `pnpm cli "js"` (no expression) to list all available scope variables.

## Investigation Patterns

### Bug investigation workflow
1. `tick` — check game is running
2. `log --tail --n 100` — errors/warnings
3. `econ` — economy overview with diagnostics
4. `ls units` / `ls buildings` — entity overview
5. `find <Type>` — locate specific entities
6. `e <id>` — inspect suspect entity
7. `inv <buildingId>` — check inventory
8. `map <x> <y> lg` — visualize the area
9. `diag` — economy bottleneck detection
10. `carriers` / `reqs` / `workers` / `jobs` — logistics deep-dive
11. `js <expr>` — deep inspection


## Live Timeline Recording

**Timeline events are recorded automatically** whenever the dev server runs (`pnpm dev`). No extra setup needed. DBs are saved to `data/.timeline/`.

```sh
pnpm timeline:live                                          # list live sessions
pnpm timeline:live -- --sql "SELECT category, COUNT(*) AS n FROM timeline GROUP BY category ORDER BY n DESC"
pnpm timeline -- --db data/.timeline/<file>.db --entity 42  # query specific DB
pnpm timeline:record                                        # connects to ws://localhost:5173
CLI_URL=ws://localhost:5174/__cli__ pnpm timeline:record     # custom port
```


### Timeline
Events are auto-recorded to `data/.timeline/` during dev. Query with:
```sh
pnpm timeline:live                                    # list sessions
pnpm timeline:live -- --entity 42                     # entity history
pnpm timeline:live -- --cat logistics                 # by category
pnpm timeline:live -- --sql "SELECT ..."              # raw SQL
```
See `docs/TIMELINE.md` for schema, SQL examples, and test timeline usage.
