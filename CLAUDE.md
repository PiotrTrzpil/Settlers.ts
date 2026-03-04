# Settlers.ts

A Settlers 4 (Siedler 4) browser-based remake using TypeScript, Vue 3, and WebGL.

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
pnpm test:unit        # Run Vitest unit tests
pnpm test:watch       # Vitest in watch mode
npx playwright test   # Run Playwright e2e tests (uses dev server locally)
pnpm format           # Prettier formatting
```

### Test environment variables

```sh
DUMP_TIMELINE=1 pnpm test:unit      # Dump timeline diagnostics for every test
VERBOSE_MOVEMENT=1 pnpm test:unit   # Include detailed pathfinding/movement events in timeline
```

## Key patterns

- **Debug bridge**: Game exposes `window.__settlers_debug__` for e2e tests and the debug panel
- **Test map**: `?testMap=true` query param loads a synthetic map (no game assets needed)
- **Feature modules**: Follow patterns in `docs/architecture/feature-modules.md`
- **Architecture rules**: Read `docs/design-rules.md` for invariants and naming conventions

## Exploration
**ALWAYS prefer cclsp mcp over manual grep for these operations:**

| Find usages | `find_references` |
| Go to definition | `find_definition` |

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

- **Validate after your changes**: Run `pnpm lint` (NOT `pnpm build`) after changes — lint runs both type-check and ESLint. `pnpm build` only type-checks and misses ESLint errors.

- **NEVER run `pnpm lint` more than once per validation cycle.** Capture output to a file and grep/read from it: `pnpm lint 2>&1 | tee /tmp/lint.txt`. Do NOT re-run lint just to narrow output — read the file instead.

- **NEVER run tests more than once per validation cycle.** Capture output to a file and grep/read from it: `pnpm test:unit 2>&1 | tee /tmp/test.txt`. Do NOT re-run tests just to see different output — read the file instead.


## Notes

NEVER GIT STASH.

- **Line length**: max 140 chars (TS), 150 chars (Vue). URLs, strings, and template literals are exempt.
- **Complexity**: max cyclomatic complexity 15 per function. Extract helpers to stay under the limit.
- **Formatting**: Prettier (`.prettierrc`). Runs automatically via lint-staged on commit.
- Playwright `outputDir` writes to `tests/e2e/.results/` (gitignored).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are committed.

## Coding guidelines

**CRITICAL — Read `docs/optimistic.md`** before writing any code. Optimistic programming rules are mandatory and violations are treated as bugs.

**Read `docs/coding-style.md`** for TypeScript patterns (error handling, async/await).

Key project-specific rules:
- Use `getEntityOrThrow(id, 'context')` instead of `getEntity(id)!`
- See `docs/design-rules.md` for architecture patterns


## Pre-Commit Review Checklist

**Check ALL modified code for these patterns before committing (see `docs/coding-style.md` for examples):**

- No optional chaining on required deps — use `!.` not `?.` on injected dependencies
- Use `getEntityOrThrow(id, 'context')` not `getEntity(id)!`
- No silent fallbacks (`?? 0`, `|| 0`) when value must exist — use `!`
- No defensive guards (`if (x)`) when value is guaranteed — trust the contract
- Throw with context instead of returning null/undefined silently
- Defensive code OK for: nullable-by-design, API boundaries, cleanup/destroy, external input



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

## E2E testing

**Read `docs/testing/guide.md` before writing or updating tests.**

- Always lint first before running tests.
- **Never use `--reporter=line`** — it suppresses stdout. Use `--reporter=list` instead.


NEVER GIT STASH.