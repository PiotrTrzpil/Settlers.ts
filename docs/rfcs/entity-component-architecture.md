# RFC: Entity-Owned State

## Status
**Implemented** (2026-02-11)

All phases completed:
- Phase 1: Entity interface expanded with `tree?`, `production?`, `construction?`, `carrier?` fields
- Phase 2: All four systems migrated (TreeSystem, ProductionSystem, BuildingStateManager, CarrierManager)
- Phase 3: Persistence verified working (entities serialize with state)
- Phase 4: Cleanup complete (defensive checks removed, tests updated)

## Problem Statement

### Problem 1: State is Hard to Find

When debugging or understanding an entity's behavior, state is scattered across multiple systems:

```typescript
// To understand what a carrier is doing, you need to check:
const entity = gameState.getEntity(carrierId);           // Position, type
const carrierState = carrierManager.getCarrier(carrierId); // Job, status, fatigue
const movement = gameState.movement.get(carrierId);       // Path, progress
const animation = animationService.get(carrierId);        // Current frame
const taskRuntime = settlerTaskSystem.getRuntime(carrierId); // Task state
```

This makes debugging difficult and the mental model complex. There's no single place to look to understand "what is this entity doing?"

### Problem 2: Save/Load is Complex

Persisting game state requires serializing each system's internal maps separately:

```typescript
function createSnapshot(): GameSnapshot {
    return {
        entities: gameState.entities,
        // Must remember to include each system's state:
        productionStates: productionSystem.getStates(),
        carrierStates: carrierManager.getAllCarriers(),
        treeStates: treeSystem.getStates(),
        buildingStates: buildingSystem.getStates(),
        // Easy to forget one, breaking save/load
    };
}
```

Adding a new system means updating serialization code in multiple places. Forgetting to serialize a system's state causes silent data loss on save/load.

### Problem 3: No Canonical Source of Truth

When multiple systems need to know about an entity's state, there's no clear answer to "who owns this data?" This leads to:
- Duplicated state across systems
- Inconsistent updates
- Unclear responsibility

## Proposed Solution: Entity-Owned State

Move all per-entity state onto the Entity as optional fields:

```typescript
interface Entity {
    // === Identity (always present) ===
    id: number;
    type: EntityType;
    subType: number;
    x: number;
    y: number;
    player: number;

    // === State (optional, system-specific) ===
    carrier?: CarrierState;
    production?: ProductionState;
    tree?: TreeState;
    construction?: ConstructionState;
    // Add new state types here
}
```

This follows the existing pattern - Entity already has optional fields like `carriedMaterial?`, `variation?`, and `selectable?`.

### What About Movement?

Unit movement is handled differently - via `MovementController` instances managed by `MovementSystem`. This is intentional:

- Movement has complex behavior (path following, interpolation, collision handling)
- It needs methods, not just data (`startPath()`, `executeMove()`, etc.)
- The controller pattern encapsulates this behavior cleanly

Movement state is accessed via `gameState.movement.getController(entityId)`, not `entity.movement`. This is fine because:
- Movement is universal to all units (not optional like carrier jobs)
- The controller pattern works well for this use case
- Serialization can handle controllers separately

The RFC focuses on **data state** that benefits from being on the entity. Behavioral controllers remain separate.

### Benefits

#### 1. Single Source of Truth

Everything about an entity is in one place:

```typescript
// Before: hunt through multiple systems
const entity = gameState.getEntity(id);
const carrier = carrierManager.get(id);
const movement = movementController.get(id);
console.log({ entity, carrier, movement });

// After: everything is right there
const entity = gameState.getEntity(id);
console.log(entity);  // Shows all state
```

#### 2. Simple Save/Load

Serialization becomes trivial:

```typescript
function createSnapshot(): GameSnapshot {
    return {
        entities: gameState.entities.map(serializeEntity),
        // That's it. All state is on the entities.
    };
}

function restoreFromSnapshot(snapshot: GameSnapshot): void {
    for (const entityData of snapshot.entities) {
        gameState.addEntity(deserializeEntity(entityData));
    }
    // Done. No system-specific restoration needed.
}
```

#### 3. Clear Mental Model

The mental model becomes: **"An entity IS its state."**

- Want to know if a building produces goods? Check `entity.production`
- Want to know what a carrier is doing? Check `entity.carrier`
- Want to add new behavior? Add a new optional field to Entity

#### 4. Simple Access

No helpers needed - just use optional chaining:

```typescript
// Check if carrier has a job
if (entity.carrier?.job) {
    console.log(entity.carrier.status);
}

// Initialize state if missing
if (!entity.production) {
    entity.production = { progress: 0, pendingRequests: new Set() };
}
entity.production.progress += dt;
```

#### 5. Type-Safe and Discoverable

TypeScript autocomplete shows all possible state:

```typescript
entity.  // IDE shows: id, type, x, y, carrier, production, tree, construction, ...
```

No need to know which system owns which state.

### Relationship to Existing Design Rules

This RFC updates **Rule 5.1** ("Feature Modules Own Their State") in `SYSTEM_DESIGN_RULES.md`:

| State Type | Location | Example |
|------------|----------|---------|
| **Per-entity state** | `entity.X` | `carrier`, `production`, `tree` |
| **Global state** | Feature module | Spatial indices, caches, configuration |
| **Cross-entity state** | Feature module | Delivery queues, pathfinding cache |

**Guideline:** If state is tied to one entity's lifecycle, it lives on the entity. If it spans entities or is global, the feature module owns it.

### How Systems Change

**Before:**
```typescript
class ProductionSystem {
    private productionStates: Map<number, ProductionState> = new Map();

    tick(dt: number): void {
        for (const entity of this.gameState.entities) {
            if (!this.isProductionBuilding(entity)) continue;

            let state = this.productionStates.get(entity.id);
            if (!state) {
                state = { progress: 0, pendingRequests: new Set() };
                this.productionStates.set(entity.id, state);
            }
            this.updateProduction(entity, state, dt);
        }
    }
}
```

**After:**
```typescript
class ProductionSystem {
    tick(dt: number): void {
        for (const entity of this.gameState.entities) {
            if (!this.isProductionBuilding(entity)) continue;

            if (!entity.production) {
                entity.production = { progress: 0, pendingRequests: new Set() };
            }
            this.updateProduction(entity, entity.production, dt);
        }
    }
}
```

Systems become simpler: they operate directly on entity state, no parallel maps.

### Serialization

State with `Set` or `Map` fields needs conversion for JSON:

```typescript
function serializeEntity(entity: Entity): SerializedEntity {
    const serialized: SerializedEntity = {
        id: entity.id,
        type: entity.type,
        subType: entity.subType,
        x: entity.x,
        y: entity.y,
        player: entity.player,
    };

    if (entity.production) {
        serialized.production = {
            progress: entity.production.progress,
            pendingRequests: [...entity.production.pendingRequests]  // Set -> Array
        };
    }

    if (entity.carrier) {
        serialized.carrier = entity.carrier;  // Plain object, no conversion needed
    }

    // ... other state
    return serialized;
}

function deserializeEntity(data: SerializedEntity): Entity {
    const entity: Entity = {
        id: data.id,
        type: data.type,
        subType: data.subType,
        x: data.x,
        y: data.y,
        player: data.player,
    };

    if (data.production) {
        entity.production = {
            progress: data.production.progress,
            pendingRequests: new Set(data.production.pendingRequests)  // Array -> Set
        };
    }

    if (data.carrier) {
        entity.carrier = data.carrier;
    }

    // ... other state
    return entity;
}
```

### Migration Path

#### Phase 1: Expand Entity Interface (non-breaking)

Add optional state fields to Entity. Existing systems continue unchanged.

```typescript
// entity.ts
export interface Entity {
    // Existing fields...
    id: number;
    type: EntityType;
    subType: number;
    x: number;
    y: number;
    player: number;
    selectable?: boolean;
    variation?: number;
    carriedMaterial?: EMaterialType;

    // New state fields (initially unused)
    carrier?: CarrierState;
    production?: ProductionState;
    tree?: TreeState;
    construction?: ConstructionState;
}
```

#### Phase 2: Migrate Systems (incremental)

Migrate one system at a time, ordered by simplicity:

| System | State Field | Complexity |
|--------|-------------|------------|
| TreeSystem | `tree` | Low |
| ProductionSystem | `production` | Low |
| BuildingStateManager | `construction` | Medium |
| CarrierManager | `carrier` | High |

For each system:
1. Replace `this.states.get(entity.id)` with `entity.stateName`
2. Replace `this.states.set(entity.id, state)` with `entity.stateName = state`
3. Remove the internal `Map<number, State>`
4. Run tests

#### Phase 3: Simplify Persistence

1. Update `createSnapshot()` to serialize entities directly
2. Update `restoreFromSnapshot()` to deserialize entities directly
3. Remove system-specific serialization code
4. Add snapshot version for backwards compatibility

#### Phase 4: Cleanup

1. Remove `onEntityRemoved()` from TickSystem interface (no longer needed)
2. Update `SYSTEM_DESIGN_RULES.md` with new guidance
3. Delete unused state maps from systems

### What Stays in Systems

Not everything moves to Entity. Keep in systems:

| State | Why |
|-------|-----|
| `MovementController` | Has behavior (methods), not just data |
| `tileOccupancy` | Spatial index across all entities |
| `deliveryQueue` | Cross-entity coordination |
| Pathfinding cache | Performance optimization, not per-entity |
| Configuration | Global settings |

**Guidelines:**
- **Data state** (plain objects) → on the entity
- **Behavioral state** (classes with methods) → controller pattern in systems
- **Cross-entity state** (indices, queues) → in systems
- **Global state** (config, caches) → in systems

### Example: Full Entity After Migration

```typescript
const carrier = gameState.getEntity(carrierId);
console.log(carrier);
// {
//   id: 42,
//   type: EntityType.Unit,
//   subType: UnitType.Carrier,
//   x: 100,
//   y: 50,
//   player: 1,
//   carriedMaterial: EMaterialType.LOG,
//   carrier: {
//     status: CarrierStatus.Delivering,
//     job: { from: 10, to: 20, material: EMaterialType.LOG },
//     fatigue: 30
//   }
// }

// Movement is separate (via controller pattern):
const movement = gameState.movement.getController(carrierId);
// movement.state: 'moving'
// movement.path: [{x: 101, y: 50}, {x: 102, y: 51}]
// movement.progress: 0.5
```

The carrier's job/status state is on the entity. Movement is via controller (has behavior, not just data).

### State Type Definitions

Each state type is defined alongside its system, then imported into Entity:

```typescript
// features/carriers/types.ts
export interface CarrierState {
    status: CarrierStatus;
    job?: CarrierJob;
    fatigue: number;
}

// systems/production-system.ts
export interface ProductionState {
    progress: number;
    pendingRequests: Set<EMaterialType>;
}

// features/building-construction/types.ts
export interface ConstructionState {
    stage: ConstructionStage;
    progress: number;
    materialsDelivered: Map<EMaterialType, number>;
}

// entity.ts
import type { CarrierState } from '@/game/features/carriers/types';
import type { ProductionState } from '@/game/systems/production-system';
import type { ConstructionState } from '@/game/features/building-construction';

export interface Entity {
    // ...
    carrier?: CarrierState;
    production?: ProductionState;
    construction?: ConstructionState;
}
```

This keeps type definitions close to their systems while centralizing the Entity interface.

## Decision

Proceed with phased migration. Phase 1 is non-breaking and can be done immediately.

## Summary

| Before | After |
|--------|-------|
| Data state scattered across systems | Data state on entity |
| `carrierManager.get(id)` | `entity.carrier` |
| Complex save/load | Serialize entities |
| "Which system has this state?" | `entity.stateName` |
| Hard to debug | `console.log(entity)` |

**Note:** Behavioral state (like `MovementController`) stays in systems - this RFC covers data state only.
