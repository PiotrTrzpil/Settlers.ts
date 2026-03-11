# Settlers.ts

A Settlers 4 (Siedler 4) browser-based remake using TypeScript, Vue 3, and WebGL.

Read `docs/MECHANICS.md` for a full overview of how the game works — territory, economy, production chains, workers, logistics, military, and game flow.

## Project layout

- `src/game/` — Core engine: commands, systems, renderer, input, economy, ai
  - `features/` — Feature modules (building-construction, placement, material-requests)
  - `systems/` — ECS-style systems (movement, pathfinding, map-objects)
  - `terrain/` — Terrain queries and landscape data
  - `buildings/`, `animation/`, `audio/` — Domain subsystems
- `src/resources/` — Binary file readers (GFX, LIB, MAP formats)
- `src/components/`, `src/views/` — Vue UI
- `tests/unit/`, `tests/e2e/` — Vitest + Playwright
- `docs/` — Architecture, design rules, coding style, testing guide

## Commands

```sh
pnpm dev              # Start Vite dev server (port 5173)
pnpm lint             # Type-check (vue-tsc) + ESLint in parallel
pnpm build            # Fast bundle (no fengari/Lua)
pnpm build:full       # Full bundle (with fengari/Lua scripting)
pnpm test:unit                                   # Run all Vitest unit tests
pnpm test:unit tests/unit/path/to/file.spec.ts   # Run a single test file (deps may also run)
pnpm test:watch       # Vitest in watch mode
npx playwright test   # Run Playwright e2e tests (uses dev server locally)
pnpm format           # Prettier formatting
pnpm timeline:record  # Record live game timeline to SQLite (connect to running dev server)
pnpm timeline:live    # Query live timeline DBs (shorthand for --dir live)
```

## Key patterns

- **Debug bridge**: Game exposes `window.__settlers_debug__` for e2e tests and the debug panel
- **Test map**: `?testMap=true` query param loads a synthetic map (no game assets needed)
- **Feature modules**: Follow patterns in `docs/architecture/feature-modules.md`
- **Architecture rules**: Read `docs/design-rules.md` for invariants and naming conventions

## Codebase Memory (MCP)

This project is indexed by `codebase-memory-mcp`. Use it for structural queries instead of grep when possible.

**Orientation:**
- `get_architecture(aspects=['hotspots','boundaries','clusters'])` for dependency analysis
- `manage_adr(mode='get')` before refactors/new features to check alignment

**Prefer `search_graph` over `query_graph`** — it handles degree filtering, dead code detection, and regex name matching without Cypher syntax issues:
- Dead code: `search_graph(label='Function', relationship='CALLS', direction='inbound', max_degree=0, exclude_entry_points=true)`
- High fan-out: `search_graph(label='Function', relationship='CALLS', direction='outbound', min_degree=15, sort_by='degree')`
- Find by name: `search_graph(name_pattern='.*Handler.*', label='Function')`

**Use `query_graph` for relationship patterns** (who calls whom, edge properties, paths):
- `MATCH (a)-[:CALLS]->(b) WHERE a.name = 'foo' RETURN b.name LIMIT 20`
- `MATCH (m:Method) WHERE m.end_line - m.start_line > 80 RETURN m.name, m.file LIMIT 20`
- `MATCH (f:Function) WHERE f.name IN ['main', 'init', 'setup'] RETURN f.name LIMIT 20`
- Supports: arithmetic (`a - b > N`), `IN [...]`, `ENDS WITH`, `NOT`, nested `AND`/`OR`, property-to-property comparisons
- IMPORTS edges have `via_barrel` property (true when import goes through a barrel/index file)
- 200-row cap; no `WITH`, `COLLECT`, `OPTIONAL MATCH`

**Other tools:**
- `trace_call_path` — call chains from/to a function (use `search_graph` first to find exact name)
- `search_code` — text search (like grep, not semantic), good for string literals and patterns not in the graph
- `detect_changes` — map git diff to affected symbols + blast radius
- After major changes: auto-sync keeps graph fresh; force with `index_repository` if needed



## Editing code

NEVER GIT STASH.

**ALWAYS prefer cclsp mcp over manual edit for these operations:**

| Operation | Tool |
|-----------|------|
| Move/Rename file | `move_file` |
| Rename symbol | `rename_symbol` |


If you are doing some editing patterns that are similar in many files:
- changing parameter passing repetitively 
- changing imports
- removing the same thing in many files.

ALWAYS prefer mass approaches, e.g. `sd` and others. (but carefully, first think deeper if your pattern to find will not miss some similar cases (maybe do some fuzzy search first), and do a dry run of replace somehow first or a limited run before running on all needed files.)




## Notes

NEVER GIT STASH.

- **Line length**: max 140 chars (TS), 150 chars (Vue). URLs, strings, and template literals are exempt.
- **Complexity**: max cyclomatic complexity 15 per function. Extract helpers to stay under the limit.
- **Formatting**: Prettier (`.prettierrc`). Runs automatically via lint-staged on commit.
- Playwright `outputDir` writes to `tests/e2e/.results/` (gitignored).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are committed.

## CRITICAL — Size Limits (MANDATORY)

**Violations are treated as bugs. Plan BEFORE writing — never write a huge file then rewrite it.**

ESLint enforces these hard limits (skip blank lines & comments):
- **Function length**: max **250 lines** (TS), off in Vue — but aim for **≤80 lines**. Extract helpers early.
- **File length**: max **600 lines** (TS), **1000** (Vue), **800** (tests) — but aim for **≤400 lines**.
- **Complexity**: max **15** cyclomatic complexity per function.

**When creating a new file:** outline the structure first (functions, responsibilities, rough line counts). If the outline exceeds limits, split into multiple files BEFORE writing any code. Do NOT write a huge file and refactor after.

**When editing an existing file that's near/over the limit:** do NOT shave off small bits (removing comments, inlining trivial helpers) to squeeze under the limit. Instead, extract a coherent chunk — a logical group of related functions or a self-contained responsibility — into its own module.

## CRITICAL — Optimistic Programming (MANDATORY)

**This is the #1 coding rule in this project. Violations are treated as bugs.**

Read `docs/optimistic.md` for full details. Read `docs/coding-style.md` for TypeScript patterns.

**Core principle: Trust contracts. No fallbacks. No defensive code. Fail loudly.**

- **NO optional chaining (`?.`) on required dependencies** — use `!.` or direct access
- **NO silent fallbacks** (`?? 0`, `|| 0`, `?? []`) when value must exist — use `!` or throw
- **NO defensive guards** (`if (x)`) when value is guaranteed — trust the contract
- **NO fallback code paths** — if a dependency is required, assert it exists, don't provide alternatives
- Use `getEntityOrThrow(id, 'context')` instead of `getEntity(id)!`
- Throw with context instead of returning null/undefined silently
- Defensive code is ONLY OK for: nullable-by-design, API boundaries, cleanup/destroy, external input
- See `docs/design-rules.md` for architecture patterns

## Pre-Commit Review Checklist

**Check ALL modified code for the optimistic programming rules above (see `docs/coding-style.md` for examples).** Every item in the list above is a checklist item.



## Validation — MANDATORY RULES

**ALWAYS use `pnpm lint` (NOT `pnpm build`) to validate changes.** `pnpm build` only type-checks; it misses all ESLint errors.

**NEVER run `pnpm lint` more than once per validation cycle.** Capture output to a file and grep from it:
```sh
pnpm lint 2>&1 | tee /tmp/lint.txt   # run ONCE
grep "error" /tmp/lint.txt            # then filter from the file
```
Re-running lint to narrow output is forbidden. Read `/tmp/lint.txt` instead.

**NEVER run tests more than once per validation cycle.** Capture output to a file and read/grep from it:
```sh
pnpm test:unit 2>&1 | tee /tmp/test.txt   # run ONCE
grep "FAIL\|error" /tmp/test.txt           # then filter from the file
```
Re-running tests just to see different output is forbidden. Read `/tmp/test.txt` instead.

If some tests fail, ALWAYS RUN JUST ONE FAILING TEST to investigate, then after fixing it, run another failing tests. only run all if you have fixed the failing test.

## Testing Approach — MANDATORY

### 1. Prefer Integration Tests

**Always write integration tests over unit tests.** Integration tests exercise real game systems together (construction, logistics, movement, combat) and catch bugs that unit tests miss. Place them in `tests/unit/integration/`. Only write isolated unit tests when testing pure logic with no system dependencies.

### 2. TDD for Bug Fixes

**Always use TDD when fixing bugs.** Before writing any fix:
1. Write a failing test that reproduces the bug
2. Confirm the test fails for the right reason
3. Implement the fix
4. Confirm the test passes

Never fix a bug without a reproducing test first. The test is proof the bug existed and proof it's fixed.

### 3. Use Timeline DB to Investigate

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

Use `--sql` for custom queries when the built-in filters aren't enough. The DB schema has `timeline`, `test_runs`, and `console_log` tables.

### 4. Live Timeline Recording

**Timeline events are recorded automatically** whenever the dev server runs (`pnpm dev`). No extra setup needed. DBs are saved to `data/.timeline/`.

```sh
# Query live recordings (while dev server is running or after)
pnpm timeline:live                                          # list live sessions
pnpm timeline:live -- --sql "SELECT category, COUNT(*) AS n FROM timeline GROUP BY category ORDER BY n DESC"
pnpm timeline -- --db data/.timeline/<file>.db --entity 42  # query specific DB

# Standalone receiver (for remote servers or custom setups)
pnpm timeline:record                                        # connects to ws://localhost:5173
CLI_URL=ws://localhost:5174/__cli__ pnpm timeline:record     # custom port
```

## E2E testing

**Read `docs/testing/guide.md` before writing or updating tests.**

- Always lint first before running tests.
- **Never use `--reporter=line`** — it suppresses stdout. Use `--reporter=list` instead.


NEVER GIT STASH.