# Unconditional Programming

**Replace behavioral branching with structural dispatch. If a conditional selects between variants, encode the variation in data — not in control flow.**

Conditionals are not inherently bad. Guards, early returns, and domain predicates are fine. The problem is **branching on type or state to select behavior** — this scatters related logic across `if/else` and `switch` arms, and every new variant requires editing every branch site.

This doc complements `optimistic.md` (which eliminates *defensive* branches) by eliminating *behavioral* branches.

---

## The Core Question

When you write an `if` or `switch`, ask:

> **Am I selecting behavior based on a type, enum, or state?**

If yes, replace the conditional with a structural pattern. If no (e.g. a domain predicate like `if (fatigue > threshold)`), the conditional is fine.

---

## Pattern 1: Lookup Table (Data-Driven Dispatch)

**Replace:** `switch` or `if/else` that maps an enum to a value or config.

```typescript
// BAD — every new BuildingType requires a new case
function getProductionTime(type: BuildingType): number {
    switch (type) {
        case BuildingType.Sawmill: return 8;
        case BuildingType.Smelter: return 12;
        case BuildingType.Bakery: return 6;
        default: return 10;
    }
}

// GOOD — data-driven, exhaustive by type system
const PRODUCTION_TIMES: Record<BuildingType, number> = {
    [BuildingType.Sawmill]: 8,
    [BuildingType.Smelter]: 12,
    [BuildingType.Bakery]: 6,
    // ... TypeScript enforces completeness
};

function getProductionTime(type: BuildingType): number {
    return PRODUCTION_TIMES[type];
}
```

Use `Record<EnumType, T>` — TypeScript enforces that every variant is covered. No `default` branch needed, no runtime surprise when a new variant is added.

**Already used well in this codebase:**
- `RACE_TO_RACE_ID` and `BUILDING_TYPE_TO_XML_ID` in `game-data-access.ts`
- `BUILDING_PRODUCTIONS` and `BUILDING_RECIPE_SETS` in `building-production.ts`
- `BUILDING_SPAWN_ON_COMPLETE` in `spawn-units.ts`

---

## Pattern 2: Dispatch Table (Callback Map)

**Replace:** `switch` or `if/else` that selects a different *action* per variant.

```typescript
// BAD — behavior scattered across switch arms
function resolve(entity: Entity): SpriteResult {
    switch (entity.type) {
        case EntityType.Building:
            return resolveBuilding(entity);
        case EntityType.Unit:
            return resolveUnit(entity);
        case EntityType.MapObject:
            return resolveMapObject(entity);
    }
}

// GOOD — dispatch table, each handler is a named function
const RESOLVERS: Record<EntityType, (entity: Entity) => SpriteResult> = {
    [EntityType.Building]: resolveBuilding,
    [EntityType.Unit]: resolveUnit,
    [EntityType.MapObject]: resolveMapObject,
};

function resolve(entity: Entity): SpriteResult {
    return RESOLVERS[entity.type](entity);
}
```

The dispatch table separates *routing* from *behavior*. Adding a new entity type means adding one entry — no control flow to trace.

**Already used well in this codebase:**
- `resolveMap` in `entity-sprite-resolver.ts`
- `entityHandlers` / `positionHandlers` in `work-handler-registry.ts`

---

## Pattern 3: Handler Registry

**Replace:** a central `switch` that grows with every new feature.

```typescript
// BAD — orchestrator knows about every feature
function handleEvent(event: GameEvent): void {
    switch (event.type) {
        case 'building:placed': handleBuildingPlaced(event); break;
        case 'unit:spawned': handleUnitSpawned(event); break;
        // grows forever...
    }
}

// GOOD — features register themselves; orchestrator just dispatches
eventBus.on('building:placed', constructionSystem.handleBuildingPlaced);
eventBus.on('unit:spawned', unitSystem.handleUnitSpawned);
```

This is already a core pattern in this project (see design-rules.md Rule 2.3: Registration Over Import). The event bus *is* a handler registry — features subscribe, the bus dispatches. No central switch needed.

---

## Pattern 4: State Machine as Map

**Replace:** `switch` on a state enum inside a tick/update function.

```typescript
// BAD — tick method is a state router
tick(dt: number): void {
    switch (this.phase) {
        case Phase.Approaching:
            this.handleApproaching(dt);
            break;
        case Phase.Fighting:
            this.handleFighting(dt);
            break;
        case Phase.Capturing:
            this.handleCapturing(dt);
            break;
    }
}

// GOOD — phase handlers as a map
private readonly phaseHandlers: Record<Phase, (dt: number) => void> = {
    [Phase.Approaching]: dt => this.handleApproaching(dt),
    [Phase.Fighting]: dt => this.handleFighting(dt),
    [Phase.Capturing]: dt => this.handleCapturing(dt),
};

tick(dt: number): void {
    this.phaseHandlers[this.phase](dt);
}
```

The map version makes phases exhaustive (TypeScript catches missing handlers) and separates state routing from state logic.

---

## Pattern 5: Predicate Composition

**Replace:** long `if` chains that check multiple boolean conditions to classify something.

```typescript
// BAD — conditions repeated and interleaved with logic
if (unit.type === EntityType.Unit && isSwordsman(unit.subType) && !isInCombat(unit.id)) {
    doThing(unit);
}

// GOOD — named predicate, reusable, testable
const isAvailableMelee = (unit: Entity): boolean =>
    unit.type === EntityType.Unit &&
    isSwordsman(unit.subType as UnitType) &&
    !isInCombat(unit.id);

if (isAvailableMelee(unit)) {
    doThing(unit);
}
```

This doesn't eliminate the `if` — it eliminates *repeated* `if` chains. A named predicate is tested once and reused everywhere. The conditional at the callsite reads like prose.

---

## When Conditionals Are Fine

Not every `if` needs replacing. Keep conditionals when:

- **Domain logic** — `if (fatigue > MAX_FATIGUE)` is a meaningful game rule, not a type dispatch
- **Guard clauses** — early returns for preconditions (`if (!entity) throw ...`)
- **Binary toggles** — `if (isEnabled)` with genuinely two paths
- **Predicates** — `filter(x => x.active)` is a data query, not behavioral dispatch

The smell is: *does adding a new variant require editing this conditional?* If yes, restructure. If no, it's fine.

---

## Relationship to Other Docs

| Doc | Eliminates |
|-----|-----------|
| `optimistic.md` | Defensive branches (null guards on required deps, silent fallbacks) |
| **This doc** | Behavioral branches (type/state dispatch via if/switch) |
| `design-rules.md` | Structural coupling (features register, not imported by core) |

Together: trust contracts (optimistic), encode variation in data (unconditional), and decouple through registration (design rules).

---

## Related Reading

- Michael Feathers, *Unconditional Programming* (talk, 2014)
- Martin Fowler, *Replace Conditional with Polymorphism* (Refactoring, 1999)
- Sandi Metz, *Nothing is Something* (talk, 2015) — on replacing conditionals with objects
