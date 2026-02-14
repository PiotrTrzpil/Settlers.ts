# Coding Guidelines

TypeScript and Vue patterns for this project.

## TypeScript

### Error Handling

**Never swallow exceptions.** Every layer has a strategy:

| Layer | Strategy |
|-------|----------|
| Data sources / enrichers | Log warning, return partial result |
| Storage / persistence | Log error, re-raise |
| API / HTTP handlers | Return appropriate HTTP status |

**Error messages must include context.** Include all relevant identifiers (entity ID, type name, state) so root cause can be traced. Never throw generic "not found" — always say what was being looked up and what was available.

```typescript
// BAD
throw new Error('not found');
if (!x) return null;

// GOOD
throw new Error(`Entity ${id} not found in ${systemName}. Available: ${[...map.keys()]}`);
throw new Error(`Cannot process ${type}: ${JSON.stringify(state)}`);
```

**Report errors eagerly** — fail fast at the source, not downstream. If a function receives invalid input, throw immediately with context rather than returning null and failing later.

### Optimistic Programming

Assume required dependencies exist. Don't defensively code around impossibilities. Trust contracts — crash loudly if violated.

```typescript
// BAD — hides initialization bugs
this.eventBus?.emit(...)
this.manager && this.manager.doThing()
private foo: Bar | undefined
const x = map.get(id) ?? 0

// GOOD — crashes with useful stack trace
this.eventBus!.emit(...)
this.manager!.doThing()
private foo!: Bar
const x = map.get(id)!  // or getEntityOrThrow(id, 'context')
```

**NEVER:**
- Use `?.` on required dependencies
- Declare required deps as `| undefined`
- Use `??` as silent fallback for things that must exist
- Guard with `if (x)` when x must exist by contract
- Make config fields optional when they're always provided

**Defensive code IS appropriate for:**
- Nullable-by-design fields (optional callbacks, preview state)
- API boundaries (queries that genuinely may return nothing)
- Cleanup/destroy paths (resources may not be initialized)
- External input (user data, file parsing, network responses)

### Coding Style

- **Prefer async/await** over `.then()` chains
- **Path alias**: `@/` → `src/`
- **Lint**: Run `pnpm lint:fix` after changes. Fix errors, consider warnings.
- **Format**: Run `pnpm format` to apply Prettier formatting.

---

## Vue

### Components

- Composition API (`<script setup lang="ts">`)
- Feature modules follow registration pattern (see `docs/architecture/feature-modules.md`)
- Minimal public API per module — communicate through events

### Testing

- Vitest for unit tests, Playwright for e2e
- Always rebuild before e2e: `pnpm build && npx playwright test`
- Use page objects (`GamePage`) for e2e navigation and assertions
- Never use `waitForTimeout()` — use semantic waiters (`waitForFrames()`, `waitForReady()`)

---

## Libraries Reference

| Purpose | Library |
|---------|---------|
| UI framework | Vue 3 (Composition API) |
| Rendering | WebGL2 + GLSL shaders |
| Audio | Howler |
| State management | Vue reactivity |
| Schema validation | Zod |
| Testing | Vitest (unit), Playwright (e2e) |
| Linting | ESLint 9, typescript-eslint, Prettier |
