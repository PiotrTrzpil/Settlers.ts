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

## Codebase Memory (MCP) — Project-Specific Notes

IMPORTS edges have `via_barrel` property (true when import goes through a barrel/index file).

See global CLAUDE.md for full tool reference and mandatory triggers.



## Editing code

NEVER GIT STASH.

**ALWAYS prefer cclsp mcp over manual edit for these operations:**

| Operation | Tool |
|-----------|------|
| Move/Rename file | `move_file` |
| Rename symbol | `rename_symbol_strict` |


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

## CRITICAL — Size Limits (MANDATORY)

**Violations are treated as bugs. Plan BEFORE writing — never write a huge file then rewrite it.**

ESLint enforces these hard limits (skip blank lines & comments):
- **Function length**: max **250 lines** (TS), off in Vue — but aim for **≤80 lines**. Extract helpers early.
- **File length**: max **600 lines** (TS), **1000** (Vue), **800** (tests) — but aim for **≤400 lines**.
- **Complexity**: max **15** cyclomatic complexity per function.

**When creating a new file:** outline the structure first (functions, responsibilities, rough line counts). If the outline exceeds limits, split into multiple files BEFORE writing any code. Do NOT write a huge file and refactor after.

**When editing an existing file that's near/over the limit:** do NOT shave off small bits (removing comments, inlining trivial helpers) to squeeze under the limit. Instead, extract a coherent chunk — a logical group of related functions or a self-contained responsibility — into its own module.

## CRITICAL — Fix Root Causes, Not Symptoms (MANDATORY)

**Always fix the underlying bug. Never add workarounds, safety nets, or "just in case" cleanup handlers.**

If system A has a bug that causes incorrect state, fix system A. Do NOT add a handler in system B that papers over A's broken logic. Workarounds:
- Hide the real bug, making it harder to find later
- Add complexity that nobody understands after the original bug is forgotten
- Create coupling between systems that should be independent

When you see two options — a clean fix at the root cause vs. a workaround downstream — **always choose the root cause fix without asking**. This is not a judgment call. Workarounds are bugs.

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

CRITICAL: If the user mentioned to 'fix all' (tests, list issues, etc), then that ALWAYS means fix ALL, COMPLETELY. All warnings, all errors (unless the conversation context suggests otherwise). Not caring if they are pre-existing or new, or yours or not. Just fix all.

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

More testing rules (integration tests, TDD, timeline DB, e2e) are in `.claude/rules/testing.md` — loaded automatically when working with test files.


NEVER GIT STASH.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Settlers.ts** (49474 symbols, 108714 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/Settlers.ts/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Settlers.ts/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Settlers.ts/clusters` | All functional areas |
| `gitnexus://repo/Settlers.ts/processes` | All execution flows |
| `gitnexus://repo/Settlers.ts/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
