# Settlers.ts

A Settlers 4 (Siedler 4) browser-based remake using TypeScript, Vue 3, and WebGL.

## Stack

- **Framework**: Vue 3 (Composition API) + Vue Router
- **Build**: Vite 7, TypeScript ~5.9
- **Rendering**: WebGL2 with GLSL shaders (via `vite-plugin-glsl`)
- **Testing**: Vitest (unit), Playwright (e2e)
- **Package manager**: pnpm

## Project layout

- `src/game/` — Core engine: commands, systems, renderer, input, economy, ai
- `src/resources/` — Binary file readers (GFX, LIB, MAP formats)
- `src/components/`, `src/views/` — Vue UI
- `tests/unit/`, `tests/e2e/` — Vitest + Playwright

## Commands

```sh
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Type-check + production build
pnpm test:unit        # Run Vitest unit tests
pnpm test:watch       # Vitest in watch mode
npx playwright test   # Run Playwright e2e tests (builds + preview first)
pnpm lint             # ESLint (src/**/*.ts,*.vue)
```

## Key patterns

- **Path alias**: `@/` maps to `src/` (configured in vite.config.ts + tsconfig.json)
- **Debug bridge**: Game exposes `window.__settlers_debug__` for e2e tests and the debug panel
- **Page object**: E2e tests use `GamePage` (tests/e2e/game-page.ts) for navigation, waiting, and assertions
- **Test map**: `?testMap=true` query param loads a synthetic map (no game assets needed)
- **GLSL imports**: Shader files use `import x from './shaders/file.glsl'` via vite-plugin-glsl
- **Type declarations**: Ambient types live in `src/types/` (env.d.ts, glsl.d.ts, shims-vue.d.ts)
- **Feature modules**: New features should follow the patterns in `docs/feature-module-architecture.md` (registration, events, minimal public API)
- **Architecture rules**: Read `docs/SYSTEM_DESIGN_RULES.md` for all architectural invariants, naming conventions, and code organization rules

## Game assets

The app needs original Settlers 4 files for full functionality. See `docs/game-files-setup.md`.
Test maps and procedural textures work without game files.

## Notes

- **Linting**: ESLint 9 flat config (`eslint.config.mjs`) with `typescript-eslint` v8, `eslint-plugin-vue` v10, and `eslint-plugin-import-x`.
- Playwright `outputDir` writes to `tests/e2e/.results/` (gitignored).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are committed.

## Coding guidelines

- **Error messages must include context**: When throwing errors, include all relevant identifiers (entity ID, type name, state) so the root cause can be traced. Never throw generic errors like "not found" — always include what was being looked up and what was available.
- **Report errors eagerly**: Fail fast at the source of the problem, not downstream. If a function receives invalid input, throw immediately with context rather than returning null and failing later.
- **No silent fallbacks for bugs**: Don't add fallbacks that hide programming errors. If code requests an animation sequence that doesn't exist, that's a bug to fix, not a case to handle gracefully.
- **Optimistic programming**: This is CRITICAL. Don't check if something exists when it must exist at that point in the code. If a manager requires an entity provider to be set before use, assume it's set and use `this.provider!` — don't add defensive `if (!this.provider) return;` checks that hide initialization bugs. Trust the contract, crash loudly if violated.
  - **NEVER** use `?.` on required dependencies (`this.eventBus?.emit` → `this.eventBus!.emit`)
  - **NEVER** declare required deps as `| undefined` (`private foo: Bar | undefined` → `private foo!: Bar`)
  - **NEVER** add silent fallbacks (`map.get(x) ?? 0` when x must exist → `map.get(x)!`)
  - **NEVER** guard with `if (x)` when x must exist by contract (OK for genuinely optional values)
  - **NEVER** make config fields optional (`eventBus?: EventBus`) when they're always provided
  - **NEVER** use wrong filters that require defensive checks downstream (filter precisely, then assert)

## Pre-Commit Review Checklist

**VERY IMPORTANT: Check ALL modified code for these patterns before committing:**

### 1. Optional Chaining on Required Dependencies (MUST FIX)

```typescript
// ❌ BAD - hides initialization bugs
this.eventBus?.emit(...)
this.manager?.doThing()
private foo: Bar | undefined

// ✅ GOOD - crashes loudly if not initialized
this.eventBus!.emit(...)
this.manager!.doThing()
private foo!: Bar
```

### 2. Entity Lookups - Use getEntityOrThrow (MUST FIX)

```typescript
// ❌ BAD - no context when it crashes
const entity = this.gameState.getEntity(id)!

// ❌ WORSE - silently returns wrong value
const player = this.gameState.getEntity(id)?.player ?? 0

// ✅ GOOD - crashes with helpful context
const entity = this.gameState.getEntityOrThrow(id, 'source building')
```

### 3. Silent Fallbacks That Hide Bugs (MUST FIX)

```typescript
// ❌ BAD - silently returns wrong value if bug exists
const x = map.get(id) ?? 0
slot?.amount || 0

// ✅ GOOD - crashes if value doesn't exist when it should
const x = map.get(id)!
slot!.amount
```

### 4. Defensive Checks When Value Must Exist (MUST FIX)

```typescript
// ❌ BAD - silently skips code that should run
if (this.manager) { this.manager.doThing() }
if (!entity) return;
handler && handler.onWork()

// ✅ GOOD - trust the contract, crash if violated
this.manager!.doThing()
entity!  // let it crash if bug
handler!.onWork()
```

### 5. Missing Error Context / Silent Failures (MUST FIX)

```typescript
// ❌ BAD - hides the root cause
if (!x) return null;
console.warn('failed')
return undefined

// ✅ GOOD - crash with full context for debugging
throw new Error(`Entity ${id} not found. Available: ${[...map.keys()]}`)
throw new Error(`Cannot process ${type}: ${JSON.stringify(state)}`)
```

### When Defensive Code IS Appropriate

- **Nullable by design**: `placementPreview?: ...`, optional callbacks
- **API boundaries**: `getEntity(id)` returning undefined for queries
- **Cleanup/destroy**: Resources may not be initialized
- **External input**: User data, file parsing, network responses

## Claude Code workflow

- **Always use async/await**: Prefer `async/await` over `.then()` chains for cleaner, more readable code
- **Validate every change**: Run targeted unit test after each edit, full suite before commit
- **Cross-module changes need e2e**: If touching multiple modules, run `pnpm build && npx playwright test`
- **Use LSP MCP** (if available): Always prefer over grep/edit for code exploration and refactoring
  - `find_references` — find all usages of a symbol
  - `find_definition` — jump to where something is defined
  - `rename_symbol` — rename across codebase (scope-aware, updates imports)
  - `get_diagnostics` — check for type errors
- **MCP screenshots**: Save to `.playwright-mcp/` folder (gitignored)
- **Hex coordinates**: Odd/even Y rows differ — test both
- **WebGL**: Unit tests (jsdom) have no WebGL — use e2e for rendering

## E2E testing

**Read `docs/testing-best-practices.md` before writing or updating tests.**

- Always rebuild first: `pnpm build && npx playwright test`
- Use `GamePage` helpers and shared fixture (`import { test, expect } from './fixtures'`)
- Never use `waitForTimeout()` — use `waitForFrames()`, `waitForReady()`, etc.
- **Run full e2e suite in background** to avoid blocking and recover from stuck tests:
  ```sh
  npx playwright test --reporter=line 2>&1 | tee /tmp/e2e.log &
  # Then poll output every 1-2 seconds:
  while ! grep -q "passed\|failed" /tmp/e2e.log 2>/dev/null; do sleep 1; tail -5 /tmp/e2e.log 2>/dev/null; done
  ```
