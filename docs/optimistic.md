# Optimistic Programming

**Assume required dependencies exist. Don't defensively code around impossibilities. Trust contracts — crash loudly if violated.**

Defensive code that silently swallows contract violations turns bugs into mysteries. A crash with a good stack trace is far better than silent wrong behaviour.

---

## The Core Rule

If something *must* exist by construction, treat it as if it *does* exist. Never add `?.`, `?? fallback`, or `if (!x) return` to paper over a guarantee.

```typescript
// BAD — hides initialization bugs, produces silent wrong results
this.eventBus?.emit(...)
this.manager && this.manager.doThing()
private foo: Bar | undefined
const x = map.get(id) ?? 0

// GOOD — crashes immediately with a useful stack trace
this.eventBus!.emit(...)
this.manager!.doThing()
private foo!: Bar
const x = map.get(id)!
```

---

## Types Must Reflect What Is Required

**A field is optional only when its absence carries domain meaning — "there is no X" must be a real, observable state of the system.**

This applies everywhere: class fields, interface properties, function parameters, return types, job data, component state.

Every optional field forces `?.` or null-checks at every callsite for the lifetime of the codebase. If a field is always set before use, it is not optional — it just looks optional because the type is wrong.

```typescript
// BAD — optional only because initialization was awkward
class SettlerTaskSystem {
  private registry?: BuildingRegistry;   // always set in init()
  private eventBus?: EventBus;           // always injected via constructor
}

// GOOD
class SettlerTaskSystem {
  private registry!: BuildingRegistry;  // definite assignment — init() is the contract
  private eventBus: EventBus;           // required in constructor
}
```

```typescript
// BAD — job data fields optional "just in case"
interface CarrierDropoffJob {
  sourceBuildingId?: EntityId;
  targetBuildingId?: EntityId;
}

// GOOD — required, because the job cannot exist without them
interface CarrierDropoffJob {
  sourceBuildingId: EntityId;
  targetBuildingId: EntityId;
}
```

Config interfaces follow the same rule: required deps must be required in the type.

```typescript
// BAD — optional fields force defensive ?. throughout all callsites
interface SystemConfig {
  eventBus?: EventBus;
  gameState?: GameState;
}

// GOOD
interface SystemConfig {
  eventBus: EventBus;
  gameState: GameState;
}
```

### When optional IS correct

A field is legitimately optional when its absence is a meaningful domain state:

- `hoveredEntityId: EntityId | null` — nothing is hovered right now
- `onComplete?: () => void` — caller may choose not to react
- `currentJob: SettlerJob | null` — settler is idle (no job)
- `sprite: Sprite | null` — not loaded in testMap mode (absence is intentional)

Even then, treat it as a design prompt: **can the type be split** so the absent case is a separate state rather than an optional field? A settler with no job and a settler with a job are often better modelled as two distinct states than one type with an optional field.

---

## Lookup Decisions — Who Owns the Invariant?

The single question that determines the right pattern:

> **Did your system store this ID, or did it arrive from outside?**

| Origin of ID / key | Correct pattern |
|--------------------|-----------------|
| You stored it (job data, internal map, component ref) | Throwing lookup — crash if absent |
| Arrived from outside (user input, external query, event) | Nullable lookup + explicit check |

### Entity lookups

```typescript
// BAD — bare ! gives no context; as-cast silently bypasses null
const entity = ctx.state.getEntity(id)!;
const entity = ctx.state.getEntity(id) as Entity;

// GOOD — you stored job.data.sourceBuildingId, so it must exist
const entity = ctx.state.getEntityOrThrow(id, 'source building in carrier dropoff');

// OK — ID came from user input; may genuinely be absent
const entity = ctx.state.getEntity(id);
if (!entity) return commandFailed(`Entity ${id} not found`);
```

### Map lookups

```typescript
// BAD — you put this key in the map yourself
const state = this.states.get(entityId) ?? defaultState;

// GOOD
const state = this.states.get(entityId);
if (!state) throw new Error(`No state for entity ${entityId} in ${this.constructor.name}`);

// OK — map is an index over external data; absence is valid
const config = BUILDING_CONFIGS.get(buildingType);
if (!config) return null;
```

### Game data / registries

```typescript
// BAD — game data is guaranteed loaded before game logic runs
const info = getBuildingInfo(race, type);
if (!info) return;

// GOOD — getBuildingInfo throws; call it and trust it
const info = getBuildingInfo(race, type);

// OK — sprite registry is nullable-by-design (not loaded in testMap mode)
const sprite = this.spriteRegistry?.getBuilding(type, race) ?? null;
```

### The corrected form of `if (!x)` is a throw, not a return

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

---

## Always Add Context When Throwing

**Every throw must include enough information to trace the root cause without a debugger.** A contextless `throw new Error('not found')` is nearly useless in a large codebase. Include what was being looked up, where, and what the surrounding state was.

```typescript
// BAD — no way to know what failed, where, or why
throw new Error('not found');
throw new Error('invalid state');

// GOOD — tells you what, where, and what was available
throw new Error(`Entity ${id} not found in ${this.constructor.name}`);
throw new Error(`No state for entity ${entityId} in SettlerTaskSystem. Known: ${[...this.states.keys()]}`);
throw new Error(`Cannot process ${type}: expected status 'idle', got '${state.status}' (entity ${id})`);
```

Apply this everywhere: map lookups, entity lookups, precondition checks, impossible branches.

---

## What Is Forbidden

- `?.` on required dependencies
- Optional (`?`) or `| undefined` fields that are always set before use
- `??` or `||` as a silent fallback for things that must exist
- `if (x)` guard when `x` is guaranteed by contract
- `as SomeType` to paper over a missing null check
- Bare `!` on entity/map lookups — use `getEntityOrThrow` for context

### Unavoidable violations must be commented

If a violation truly cannot be avoided (e.g. a framework lifecycle forces a field to be set after construction, or a third-party API returns a union you cannot narrow), **leave a comment explaining why** the defensive pattern is necessary and what invariant you're relying on.

```typescript
// framework requires field to be set in onMounted(), not constructor — safe after mount
private renderer?: Renderer;

// Vue reactivity system may call this watcher before the component is fully initialised
const value = this.store?.someValue ?? defaultValue; // safe: default is semantically correct here
```

A comment transforms an unexplained pattern into an intentional, documented exception. Uncommented violations look like mistakes — because they usually are.

---

## Where Defensive Code and Nullable Fields ARE Appropriate

- **Nullable-by-design fields** — nothing hovered/selected, settler is idle, feature not loaded in testMap
- **Optional callbacks** — caller may choose not to handle an event
- **API / query boundaries** — lookups that may legitimately return nothing
- **Cleanup / destroy paths** — resources may not have been initialized if setup failed
- **External input** — user data, file parsing, network responses
- **Renderer / frame-loop paths** — entities can be removed between ticks; ID lookup may return nothing
- **Event handlers receiving entity IDs** — event was emitted before removal; handler may run after

---

## Project-Specific Helpers

| Situation | Use |
|-----------|-----|
| Entity lookup you stored the ID for | `ctx.state.getEntityOrThrow(id, 'description')` |
| Entity lookup from outside / uncertain | `ctx.state.getEntity(id)` then explicit check |
| Internal map lookup | `if (!v) throw new Error(...)` with class name |
| Required dep in class | `private foo!: Bar` (definite assignment assertion) |

---

## Related Docs

- `docs/coding-style.md` — async/await, formatting, general TypeScript style
- `docs/design-rules.md` — Rule 10 (error handling in tick systems and commands)
