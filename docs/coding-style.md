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
- Use `||` as a silent fallback (same problem as `??`)
- Use `as` casting to paper over a missing null check

**The corrected form of `if (!x)` is a throw, not a return:**

```typescript
// BAD — silently hides the contract violation
if (!this.manager) return;
this.manager.doThing();

// GOOD — crashes with useful context
if (!this.manager) throw new Error(`manager not initialized in ${this.constructor.name}`);
this.manager.doThing();

// ALSO GOOD — when the contract is already guaranteed by construction
this.manager!.doThing();
```

**Throwing lookups vs nullable lookups — the general rule:**

The key question is: *who owns the invariant that the thing exists?*

- **You stored the ID / key** → you own the invariant → use a throwing lookup
- **The ID came from outside, or the existence is genuinely uncertain** → use a nullable lookup with an explicit null check

This applies to every kind of lookup, not just entities:

```typescript
// ── Entities ──────────────────────────────────────────────────────────────

// BAD — bare ! gives no context; as-cast silently bypasses null
const entity = ctx.state.getEntity(id)!;
const entity = ctx.state.getEntity(id) as Entity;

// GOOD — you stored job.data.sourceBuildingId, so it must exist
const entity = ctx.state.getEntityOrThrow(id, 'source building in carrier dropoff');

// OK — ID came from user input or an external query; may genuinely be absent
const entity = ctx.state.getEntity(id);
if (!entity) return commandFailed(`Entity ${id} not found`);

// ── Map lookups ────────────────────────────────────────────────────────────

// BAD — you put this key in the map yourself
const state = this.states.get(entityId) ?? defaultState;

// GOOD
const state = this.states.get(entityId);
if (!state) throw new Error(`No state for entity ${entityId} in ${this.constructor.name}`);

// OK — map is an index over external data; absence is valid
const config = BUILDING_CONFIGS.get(buildingType);
if (!config) return null;

// ── Game data / registries ────────────────────────────────────────────────

// BAD — game data is guaranteed loaded by the time game logic runs
const info = getBuildingInfo(race, type);
if (!info) return;

// GOOD — getBuildingInfo throws; call it and trust it
const info = getBuildingInfo(race, type);  // throws if not loaded or unknown type

// OK — sprite registry is nullable-by-design (not loaded in testMap mode)
const sprite = this.spriteRegistry?.getBuilding(type, race) ?? null;
```

The pattern scales: if your system put the ID there, crash on miss. If the ID arrived from elsewhere, check and handle.

**Required config fields must be required in the type:**

```typescript
// BAD — optional fields force defensive ?. throughout all callsites
interface SystemConfig {
  eventBus?: EventBus;
  gameState?: GameState;
}

// GOOD — required deps are required in the type
interface SystemConfig {
  eventBus: EventBus;
  gameState: GameState;
}
```

**Defensive code IS appropriate for:**
- Nullable-by-design fields (optional callbacks, preview state)
- API boundaries (queries that genuinely may return nothing)
- Cleanup/destroy paths (resources may not be initialized)
- External input (user data, file parsing, network responses)
- Renderer/frame-loop paths — entities can be removed between ticks, so looking up an entity by ID in rendering code may legitimately return nothing
- Event handlers receiving entity IDs — the event was emitted before removal, the handler may arrive after

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
- Always lint before e2e: `pnpm lint && npx playwright test`
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
