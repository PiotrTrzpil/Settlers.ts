# Persistence Registry Design

Replaces the scattered N-way persistence code in `game-state-persistence.ts` with a registry-driven approach. Each manager declares how to serialize/deserialize itself; a central registry orchestrates snapshot creation and restoration in dependency order.

## Overview

**Current pain:** Adding persistent state to a new manager requires changes in 5+ places (snapshot interface, createSnapshot, restoreFromSnapshot, serialize helper, restore helper, version bump). Restore ordering is implicit and fragile.

**Goal:** One-place registration. Explicit ordering. Impossible to forget.

## Coding Conventions

- Read `docs/optimistic.md` — optimistic programming is mandatory
- Read `docs/design-rules.md` — architecture patterns
- Read `docs/coding-style.md` — TypeScript patterns
- Use `getEntityOrThrow(id, 'context')` not `getEntity(id)!`
- No optional chaining on required deps
- Max 140 chars per line (TS), 150 (Vue)
- Max cyclomatic complexity 15

## Shared Contracts (as code)

Write to: `src/game/persistence/types.ts`

```typescript
/**
 * Persistable — contract for managers that contribute to game snapshots.
 *
 * Managers implement this to participate in the persistence registry.
 * The registry calls serialize() during snapshot creation and
 * deserialize() during restoration, in topological order.
 */
export interface Persistable<S = unknown> {
    /** Unique key in the snapshot object. Must be stable across versions. */
    readonly persistKey: string;

    /**
     * Serialize all owned state into a JSON-safe value.
     * Called once per snapshot. Returns the full serialized state for this manager.
     */
    serialize(): S;

    /**
     * Restore state from a previously serialized value.
     * Called once during snapshot restoration.
     * May assume that dependencies (declared via `after`) are already restored.
     */
    deserialize(data: S): void;
}
```

Write to: `src/game/persistence/persistence-registry.ts`

```typescript
/**
 * PersistenceRegistry — collects Persistable managers and orchestrates
 * snapshot creation/restoration in dependency order.
 *
 * Registration declares ordering constraints via `after` keys.
 * The registry topologically sorts persistables so that dependencies
 * are serialized/deserialized first.
 */

import type { Persistable } from './types';

export interface PersistenceRegistration {
    persistable: Persistable;
    /** persistKeys that must be serialized/deserialized before this one */
    after: string[];
}

export class PersistenceRegistry {
    private readonly registrations: PersistenceRegistration[] = [];
    private sortedCache: PersistenceRegistration[] | null = null;

    register(persistable: Persistable, after: string[] = []): void {
        if (this.registrations.some(r => r.persistable.persistKey === persistable.persistKey)) {
            throw new Error(`PersistenceRegistry: duplicate key '${persistable.persistKey}'`);
        }
        this.registrations.push({ persistable, after });
        this.sortedCache = null; // invalidate
    }

    /** Create the feature-state portion of a snapshot. */
    serializeAll(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const { persistable } of this.sorted()) {
            result[persistable.persistKey] = persistable.serialize();
        }
        return result;
    }

    /** Restore feature state from a snapshot, in dependency order. */
    deserializeAll(snapshot: Record<string, unknown>): void {
        for (const { persistable } of this.sorted()) {
            const data = snapshot[persistable.persistKey];
            if (data !== undefined) {
                persistable.deserialize(data);
            }
        }
    }

    /** Get registrations in topological order (cached). */
    private sorted(): PersistenceRegistration[] {
        if (!this.sortedCache) {
            this.sortedCache = topologicalSort(this.registrations);
        }
        return this.sortedCache;
    }
}

function topologicalSort(registrations: PersistenceRegistration[]): PersistenceRegistration[] {
    const byKey = new Map(registrations.map(r => [r.persistable.persistKey, r]));
    const sorted: PersistenceRegistration[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(reg: PersistenceRegistration): void {
        const key = reg.persistable.persistKey;
        if (visited.has(key)) return;
        if (visiting.has(key)) throw new Error(`PersistenceRegistry: cycle involving '${key}'`);
        visiting.add(key);
        for (const dep of reg.after) {
            const depReg = byKey.get(dep);
            if (depReg) visit(depReg);
            // If dep not registered, it's external (entities, terrain) — skip
        }
        visiting.delete(key);
        visited.add(key);
        sorted.push(reg);
    }

    for (const reg of registrations) visit(reg);
    return sorted;
}
```

Write to: `src/game/persistence/index.ts`

```typescript
export type { Persistable } from './types';
export { PersistenceRegistry } from './persistence-registry';
```

## What Stays Outside the Registry

These are NOT entity-keyed feature state — they stay as manual code in `game-state-persistence.ts`:

1. **Entity serialization** — entities array with core fields (id, type, x, y, carrying, hidden, race)
2. **RNG seed and nextId** — global game state
3. **Terrain diffs** — terrain ground type/height arrays
4. **Entity restoration** (triggers entity:created events that auto-register fresh state)
5. **Service area restoration** — derived from entity state + construction site state, not independently serialized

## Subsystem Details

### Subsystem 1 — PersistenceRegistry and Persistable interface

**Files to create:**
- `src/game/persistence/types.ts`
- `src/game/persistence/persistence-registry.ts`
- `src/game/persistence/index.ts`

Implementation is in the Shared Contracts section above. Add unit tests:
- `tests/unit/persistence/persistence-registry.spec.ts` — test registration, topological sort, serialize/deserialize ordering, duplicate key rejection, cycle detection

### Subsystem 2 — Implement Persistable on managers (Group A: simple state)

These managers have straightforward serialize/restore:

**CarrierManager** (`src/game/features/carriers/carrier-manager.ts`):
- `persistKey: 'carriers'`
- `serialize()`: return `[...this.states.keys()].map(id => ({ entityId: id }))`
- `deserialize(data)`: call existing `restoreCarrier(entityId)` for each entry
- Serialized type: `SerializedCarrier[]` (just `{ entityId: number }`)

**WorkAreaStore** (`src/game/features/work-areas/work-area-store.ts`):
- `persistKey: 'workAreaOffsets'`
- `serialize()`: return existing `serializeInstanceOffsets()` result
- `deserialize(data)`: call existing `restoreInstanceOffsets(data)`
- Serialized type: `Array<{ entityId: number; dx: number; dy: number }>`

**TreeSystem** (`src/game/features/trees/tree-system.ts`):
- `persistKey: 'trees'`
- `serialize()`: map over `getAllTreeStates()` returning `SerializedTree[]`
- `deserialize(data)`: call `restoreTreeState(entityId, state)` for each
- Note: Tree state is restored DURING entity restoration in current code (overwrites fresh register() state). With the registry approach, tree state restore happens AFTER all entities are created, which is equivalent because `restoreTreeState` overwrites anyway.

**StoneSystem** (`src/game/features/stones/stone-system.ts`):
- `persistKey: 'stones'`
- `serialize()`: iterate `getAllStoneStates()` (or equivalent), return `SerializedStone[]`
- `deserialize(data)`: call `restoreStoneState(entityId, state)` for each
- Note: Same entity restoration timing change as trees — still correct because restoreStoneState overwrites.

**StackedPileManager** (`src/game/stacked-pile-manager.ts`):
- `persistKey: 'resourceQuantities'`
- `serialize()`: iterate `this.states`, return `Array<{ entityId: number; quantity: number }>`
- `deserialize(data)`: for each entry, find existing state and set quantity
- Note: Piles are created by entity:created events. Deserialize only updates quantities on existing piles.

For each manager:
- Add `implements Persistable<SerializedType>` to the class
- Import `Persistable` from `@/game/persistence`
- Implement the 3 members (persistKey, serialize, deserialize)
- The existing serialize/restore helper methods can be reused internally
- Do NOT remove the existing restore methods yet (they'll be removed in subsystem 5)

### Subsystem 3 — Implement Persistable on managers (Group B: complex state)

These have nuanced restore logic:

**ConstructionSiteManager** (`src/game/features/building-construction/construction-site-manager.ts`):
- `persistKey: 'constructionSites'`
- `serialize()`: return existing `serializeSites()` result
- `deserialize(data)`: call existing `restoreSite(site)` for each
- Serialized type: `SerializedConstructionSite[]`

**BuildingInventoryManager** (`src/game/features/inventory/building-inventory.ts`):
- `persistKey: 'buildingInventories'`
- `serialize()`: iterate `getAllInventories()`, serialize slots
- `deserialize(data)`: call `restoreInventory()` for each, **with reservations reset to 0**
- The reservation reset logic currently lives in `game-state-persistence.ts`. Move it INTO the deserialize method. This is the correct home because the invariant "reservations reset on restore" is owned by the inventory manager.
- `after: ['constructionSites']` — inventories need construction sites to exist first

**RequestManager** (`src/game/features/logistics/request-manager.ts`):
- `persistKey: 'requests'`
- `serialize()`: iterate `getAllRequests()`, return `SerializedRequest[]`
- `deserialize(data)`: call `restoreRequest()` for each, **with in-progress requests reset to pending**
- The status reset logic currently lives in `game-state-persistence.ts`. Move it INTO the deserialize method. Same reasoning as inventory reservations.
- `after: ['constructionSites']` — requests reference buildings that should be restored

For each manager:
- Add `implements Persistable<SerializedType>`
- Import `Persistable` from `@/game/persistence`
- Move any restore transformation logic (reservation resets, status resets) from game-state-persistence.ts into the deserialize method
- Do NOT remove the old code from game-state-persistence.ts yet (subsystem 5 does that)

### Subsystem 4 — Wire registry in GameServices

**File:** `src/game/game-services.ts`

Changes:
1. Create a `PersistenceRegistry` instance as a public readonly field
2. After all managers are created and features loaded, register each Persistable manager:

```typescript
// After all features loaded and managers wired:
this.persistenceRegistry = new PersistenceRegistry();
this.persistenceRegistry.register(this.constructionSiteManager);  // no deps
this.persistenceRegistry.register(this.carrierManager);           // no deps
this.persistenceRegistry.register(this.workAreaStore);            // no deps
this.persistenceRegistry.register(this.treeSystem);               // no deps
this.persistenceRegistry.register(this.stoneSystem);              // no deps
this.persistenceRegistry.register(this.gameState.piles);          // no deps (StackedPileManager)
this.persistenceRegistry.register(this.inventoryManager, ['constructionSites']);
this.persistenceRegistry.register(this.requestManager, ['constructionSites']);
```

Note: The `register` method takes `(persistable, after?)`. Pass the `after` array directly.

### Subsystem 5 — Refactor game-state-persistence.ts

**File:** `src/game/game-state-persistence.ts`

This is the integration subsystem. Changes:

1. **`createSnapshot()`**: Replace individual serialize calls with `game.services.persistenceRegistry.serializeAll()`. Spread the result into the snapshot object alongside the manual fields (entities, nextId, rngSeed, terrain).

```typescript
export function createSnapshot(game: Game): GameStateSnapshot {
    const gameState = game.state;
    const entities = gameState.entities.map(e => ({ ... })); // keep as-is

    return {
        version: SNAPSHOT_VERSION,
        timestamp: Date.now(),
        mapId: currentMapId,
        entities,
        nextId: gameState.nextId,
        rngSeed: gameState.rng.getState(),
        // Terrain (keep as-is)
        ...terrainSnapshot(game),
        // Feature state from registry
        ...game.services.persistenceRegistry.serializeAll(),
    };
}
```

2. **`restoreFromSnapshot()`**: Replace individual restore calls with `game.services.persistenceRegistry.deserializeAll(snapshot)`. Keep the manual steps:

```typescript
export function restoreFromSnapshot(game: Game, snapshot: GameStateSnapshot): void {
    // 1. Clear existing entities (keep as-is)
    // 2. Restore RNG and nextId (keep as-is)
    // 3. Restore entities (keep as-is — triggers entity:created)
    // 4. Restore terrain (keep as-is)
    // 5. Restore service areas (keep as-is — derived, not serialized)
    // 6. NEW: Restore all feature state via registry
    game.services.persistenceRegistry.deserializeAll(snapshot as Record<string, unknown>);

    console.log(`GameState: Restored ${snapshot.entities.length} entities from snapshot`);
}
```

3. **Delete** the individual serialize/restore helper functions that are now handled by the registry:
   - `serializeInventories()`, `serializeCarriers()`, `serializeTrees()`, `serializeStones()`, `serializeRequests()`
   - `restoreResourceQuantities()`, `restoreInventories()`, `restoreCarriers()`, `restoreConstructionSites()`, `restoreRequests()`
   - Keep: `restoreEntities()`, `restoreEntityProps()`, `restoreServiceAreas()`, `restoreTerrain()`, slot serialization types

4. **Remove** serialized type interfaces that moved to their owning modules:
   - Keep `GameStateSnapshot` but make the feature fields use `unknown` type (the registry handles typing):
   ```typescript
   // Feature state fields — typed by their owning Persistable managers
   [key: string]: unknown;  // index signature for registry-managed fields
   ```
   Actually, better: keep the named fields for backward compat but make them `unknown`:
   ```typescript
   constructionSites?: unknown;
   buildingInventories?: unknown;
   carriers?: unknown;
   trees?: unknown;
   stones?: unknown;
   requests?: unknown;
   resourceQuantities?: unknown;
   workAreaOffsets?: unknown;
   ```

5. **Bump `SNAPSHOT_VERSION`** to 11 since the serialization format changes slightly (reservation reset and status reset now happen inside deserialize, not outside).

Actually wait — the serialized FORMAT doesn't change. The same JSON is produced. Only the code organization changes. **Do NOT bump SNAPSHOT_VERSION** — existing saves remain compatible.

6. **Service area restoration timing**: Currently construction sites are restored BEFORE service areas. With the registry, construction sites are part of `deserializeAll()` which runs after entity restoration. Service area restoration (`restoreServiceAreas`) must run AFTER `deserializeAll()` since it checks `hasSite()`. Ensure the call order is:
   ```
   restoreEntities → restoreTerrain → deserializeAll (includes constructionSites) → restoreServiceAreas
   ```

## Ordering Summary

```
restoreFromSnapshot() execution order:
1. Clear existing entities
2. Restore RNG + nextId
3. restoreEntities() — entity:created events fire, fresh state auto-registered
4. restoreTerrain()
5. persistenceRegistry.deserializeAll() — topological order:
   a. constructionSites (no deps)
   b. carriers (no deps)
   c. trees (no deps)
   d. stones (no deps)
   e. resourceQuantities (no deps)
   f. workAreaOffsets (no deps)
   g. buildingInventories (after: constructionSites)
   h. requests (after: constructionSites)
6. restoreServiceAreas() — derived from entity + construction site state
```

## File Ownership per Subsystem

| Subsystem | Files |
|-----------|-------|
| 1 (Registry) | `src/game/persistence/types.ts`, `persistence-registry.ts`, `index.ts`, `tests/unit/persistence/persistence-registry.spec.ts` |
| 2 (Simple Persistables) | carrier-manager.ts, work-area-store.ts, tree-system.ts, stone-system.ts, stacked-pile-manager.ts |
| 3 (Complex Persistables) | construction-site-manager.ts, building-inventory.ts, request-manager.ts |
| 4 (Wiring) | game-services.ts |
| 5 (Refactor persistence) | game-state-persistence.ts |

## Notes

- Subsystems 1, 2, 3 can run in parallel (independent files)
- Subsystem 4 depends on 1 (needs PersistenceRegistry import)
- Subsystem 5 depends on 2, 3, 4 (needs all Persistable implementations + registry wired)
- Tree/stone restore timing changes from "during entity restoration" to "after all entities created" — this is safe because restoreTreeState/restoreStoneState overwrite the fresh state anyway
