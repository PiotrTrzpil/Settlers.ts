---
name: new-game-feature
description: Build a new game feature for Settlers.ts following feature-module architecture, design rules, and project conventions. Plans architecture, self-reviews, implements with verification.
argument-hint: [feature description]
---

You are building a new game feature for Settlers.ts. Do NOT start coding immediately.

ultrathink

**IMPORTANT: Do NOT use plan mode.**
Also, you may be working concurrently with other workers or the user. Do not stash anything, do not revert anything.

## Feature Request

$ARGUMENTS

## Phase 1: Understand What Exists

Before designing anything:

1. Read the project docs that govern feature design:
   - `docs/design-rules.md` — layer architecture, feature vs system rules, Manager/System split, event bus rules, naming conventions
   - `docs/architecture/feature-modules.md` — feature module structure, registration pattern, migration checklist
   - `docs/coding-style.md` — error handling, optimistic programming, TypeScript patterns

2. Study existing features to match their patterns:
   - `src/game/features/` — look at 2-3 existing features (trees is simple, carriers/logistics are complex)
   - `src/game/features/feature.ts` — `FeatureDefinition`, `FeatureContext`, `FeatureInstance` interfaces
   - `src/game/features/feature-registry.ts` — how features are loaded and wired
   - `src/game/event-bus.ts` — `GameEvents` interface for available events

3. Map what already exists that this feature will interact with:
   - Use `find_references` and `find_definition` (cclsp MCP) to trace dependencies
   - Check `src/game/game.ts` for how features are registered
   - Check `src/game/game-loop.ts` for tick system registration

## Phase 2: Decide Feature vs System

Consult `docs/design-rules.md` Rule 2.0:

| Location | When to use |
|----------|-------------|
| `features/` | Multiple files, Manager + System split, events, cross-cutting integrations |
| `systems/` | Single file, simple state, no events needed, focused behavior |

Choose based on actual complexity, not anticipated complexity. Start as a system if unsure — promotion to a feature is easy.

## Phase 3: Design

Write a concrete plan covering:

- **Where it fits in the layer architecture** (Rule 1.1 — imports flow downward only)
- **Directory structure** following the project conventions:
  ```
  src/game/features/<name>/
    ├── index.ts              # Public API only
    ├── <name>-system.ts      # TickSystem if per-frame updates needed
    ├── <name>-manager.ts     # State container if state management needed
    ├── types.ts              # Feature-specific types
    └── internal/             # Private implementation
  ```
- **Public API** — what goes in `index.ts` (keep it minimal)
- **FeatureDefinition** — id, dependencies, what it creates (following `tree-feature.ts` pattern)
- **Events** — new events to add to `GameEvents` (Rule 3.2: `"<domain>:<past-tense-verb>"`)
- **State ownership** — who owns what (Rule 5.1: features own their state, not GameState)
- **Integration points** — what existing code needs modification
- **File list** — every file created/modified with one-line description

For every design decision, explain *why*. Present tradeoffs when multiple approaches exist.

**Present the plan to the user. Iterate until approved.**

## Phase 4: Self-Review

Before implementing, review your own plan against the project rules:

- [ ] Layer direction correct? No upward imports? (Rule 1.1)
- [ ] Single entry point via `index.ts`? (Rule 2.1)
- [ ] No imports from `internal/` by external code? (Rule 2.2)
- [ ] Registration over import? (Rule 2.3)
- [ ] Events follow `"<domain>:<past-tense-verb>"` naming? (Rule 3.2)
- [ ] Event payloads include sufficient context? (Rule 3.3)
- [ ] Manager/System split correct? (Rule 4.1)
- [ ] Config object for 3+ constructor deps? (Rule 4.4)
- [ ] Feature owns its state, not GameState? (Rule 5.1)
- [ ] Named constants, no magic numbers? (Rule 7.4)
- [ ] Naming matches Settlers 4 XML conventions? (Rule 12.1)
- [ ] TickSystems catch errors, don't crash game loop? (Rule 10.1)
- [ ] Is there a simpler way? Am I over-engineering? (Rule 9)

Fix issues found. If the plan changed significantly, re-present to user.

## Phase 5: Implement

Build in dependency order: types → state/manager → system → feature definition → registration → tests.

**At each step:**
- Implement one logical piece
- Run `get_diagnostics` (cclsp MCP) on changed files after each change
- If something breaks, stop and fix before proceeding

**Code quality rules:**
- Match existing patterns exactly (read similar features first)
- Use `getEntityOrThrow(id, 'context')` not `getEntity(id)!`
- Use `!.` on required deps, not `?.` (optimistic programming — see `docs/coding-style.md`)
- No silent fallbacks (`?? 0`, `|| 0`) when value must exist
- Game balance values as named constants
- Use `EventSubscriptionManager` for event cleanup (see `tree-feature.ts`)
- Use `satisfies` on exports: `exports: { ... } satisfies MyFeatureExports`

**Use cclsp MCP tools:**
- `rename_symbol` for renames
- `find_references` before modifying shared code
- `get_diagnostics` after every significant change

## Phase 6: Test

Write tests following `docs/testing/guide.md`:

**Decide test tier:**
- Pure logic/state → Unit test (Tier 3, strongly preferred)
- Multi-tick behavior → Unit test with tick simulation, or E2E `gs` fixture (Tier 2)
- Visual/UI → E2E `gp` fixture (Tier 1)

**Unit tests:**
- Use helpers from `tests/unit/helpers/test-game.ts` and `test-map.ts`
- Use enums (`EntityType`, `BuildingType`, `UnitType`, `EMaterialType`), never magic numbers
- Test through public APIs and commands, not internal state

**E2E tests (if needed):**
- Import from `./fixtures` (shared test map) or `./matchers` (own page management)
- Use `GamePage` helpers — don't duplicate what exists
- Use custom matchers (`toHaveUnitCount`, `toHaveEntity`, etc.) — they auto-poll
- Never use `waitForTimeout()` — use `waitForFrames()`, `waitForUnitCount()`, etc.
- Tag appropriately: `@smoke`, `@slow`, `@requires-assets`

## Phase 7: Verify

1. `pnpm test:unit` — all unit tests pass
2. `pnpm lint` — type-check + ESLint pass
3. run e2e test: via /e2e skill
4. Run the pre-commit checklist from CLAUDE.md against all modified code

## Phase 8: Document (minimal)

Update `CLAUDE.md` ONLY if the feature introduces non-obvious gotchas. Do NOT document:
- That the feature exists
- How components work
- Standard patterns you followed

## Output

When complete, give the user:
- Summary of what was built and key design decisions
- Files created/modified
- How to test it
- Any known limitations or follow-up work
