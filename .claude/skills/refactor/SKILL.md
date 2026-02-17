---
name: refactor
description: Refactor a feature or part of the codebase
argument-hint: <description>
---

You are doing a refactoring, balancing understanding with speed of execution.

ultrathink

**IMPORTANT: Do NOT use plan mode.**
Also, you may be working concurrently with other workers or the user. Do not stash anything, do not revert anything.

## Refactoring Task

$ARGUMENTS

## Process

### 1. Understand the Scope

- Read the code being refactored. Understand the current structure before changing anything.
- Use `find_references` and `find_definition` (cclsp MCP) to map the dependency graph — who calls this, what it depends on, what depends on it.
- Identify the public API boundary: what do external consumers actually use?
- Check for tests that cover the code being refactored. Read them to understand expected behavior.

### 2. Identify the Target Architecture

Consult `docs/design-rules.md` and `docs/architecture/feature-modules.md` for project conventions:

- **Features vs Systems**: Complex multi-file domains → `features/`. Simple focused behavior → `systems/`.
- **Layer direction**: Imports flow downward only (Layer 0 Pure Data → Layer 6 Glue).
- **Single entry point**: All external imports via `index.ts`. Internal details in `internal/`.
- **Registration over import**: Features register with core systems, not the other way around.
- **Manager/System split**: Managers own state (no tick). Systems tick behavior (query Manager).
- **Config objects**: 3+ constructor dependencies → single `*Config` interface.

### 3. Execute the Refactoring

**Always prefer cclsp MCP tools over manual grep/edit:**
- `rename_symbol` — rename across codebase (scope-aware, updates imports)
- `find_references` — find all usages before moving/changing code
- `find_definition` — navigate to definitions
- `get_diagnostics` — check for type errors after changes

**Move in small, validated steps:**

1. Make one structural change (move a file, extract a function, rename a symbol)
2. Run `get_diagnostics` on affected files to verify no type errors
3. Fix any broken imports or references
4. Repeat

**Common refactoring patterns:**

- **Extract feature module**: Create `features/<name>/`, move files, create `index.ts` with minimal public API, update all imports to use the barrel
- **Extract system**: Pull tick logic into a `*System` class implementing `TickSystem`, register via `gameLoop.registerSystem()`
- **Split Manager/System**: Separate state ownership (Manager) from per-frame behavior (System)
- **Replace direct calls with events**: Add event to `GameEvents` interface, emit from commands, subscribe from feature's `registerEvents()`
- **Collapse unnecessary abstraction**: Inline single-use helpers, remove premature indirection

### 4. Validate

- Run `get_diagnostics` on all modified files
- Run targeted unit tests: `pnpm vitest run <relevant-test-file>`
- If touching multiple modules: `pnpm lint`
- Verify no imports from `internal/` by external code
- Check the pre-commit review checklist (CLAUDE.md): no optional chaining on required deps, use `getEntityOrThrow`, no silent fallbacks

### 5. Sweep for Consistency

After the main refactoring:
- Search for any remaining references to the old structure (stale imports, old paths)
- Check that new code follows naming conventions (Rule 12 in design-rules.md)
- Verify event naming uses `"<domain>:<past-tense-verb>"` format if events were added

## Rules

- **Don't over-engineer**: Only refactor what was asked. Don't speculatively "improve" adjacent code.
- **Delete, don't deprecate**: Remove old code outright. Git has history.
- **No backwards-compat shims**: Don't re-export from old paths or add `// removed` comments.
- Don't do any backward compatibility at all.
- **Preserve behavior**: Refactoring changes structure, not behavior. If tests existed before, they must still pass after.
- **Run diagnostics often**: After every file move or rename, check for type errors before proceeding.
