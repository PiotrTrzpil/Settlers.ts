# Persistence Gaps — Implementation Design Doc

## Overview

Add persistence (save/restore) support to 8 game systems that currently lose state on save/load. Each system must implement the `Persistable<S>` interface and register with `PersistenceRegistry` in `game-services.ts`.

## Project Conventions

- **Read existing code** before editing any file.
- Follow the `Persistable<S>` pattern from `src/game/persistence/types.ts`.
- Use `TreeSystem` and `StoneSystem` as canonical reference implementations.
- Serialized types go in `src/game/game-state-persistence.ts` (add to `GameStateSnapshot`).
- Registration goes in `game-services.ts` around line 220.
- Increment `SNAPSHOT_VERSION` (currently 10 → 11) — done ONCE, not per system.
- **Optimistic code**: trust contracts, fail loudly. See `docs/optimistic.md`.
- Use `!` instead of `?.` on required deps. Use `getEntityOrThrow` not `getEntity()!`.
- Map serialization: convert `Map<K, V>` to `Array<{key, value}>` for JSON safety.
- Do NOT refactor unrelated code, run tests, or commit.
- Do NOT add comments, docstrings, or type annotations beyond what's needed.

## Shared Contracts

All serialized types are added to `src/game/game-state-persistence.ts` and referenced in `GameStateSnapshot`.

## Subsystem Details

### Subsystem 1 — CropSystem Persistence

**File:** `src/game/features/crops/crop-system.ts`

**Pattern:** Nearly identical to TreeSystem. CropSystem already extends `GrowableSystem` and has `restoreCropState()` and `getAllCropStates()`.

**Task:**
1. Make `CropSystem` implement `Persistable<SerializedCrop[]>`
2. Add `readonly persistKey = 'crops' as const`
3. Add `serialize()` — iterate `getAllCropStates()`, return array of `{ entityId, stage, cropType, progress, decayTimer, currentOffset }`
4. Add `deserialize(data)` — iterate and call `restoreCropState()`
5. Add `SerializedCrop` interface to `game-state-persistence.ts`
6. Add `crops?: SerializedCrop[]` to `GameStateSnapshot`
7. Register in `game-services.ts`: `this.persistenceRegistry.register(this.cropSystem)`
8. Add import of `Persistable` and `SerializedCrop`

**Serialized shape:**
```ts
interface SerializedCrop {
    entityId: number;
    stage: CropStage;
    cropType: number; // MapObjectType enum value
    progress: number;
    decayTimer: number;
    currentOffset: number;
}
```

### Subsystem 2 — StorageFilterManager Persistence

**File:** `src/game/features/inventory/storage-filter-manager.ts`

**Task:**
1. Make `StorageFilterManager` implement `Persistable<SerializedStorageFilter[]>`
2. Add `readonly persistKey = 'storageFilters' as const`
3. `serialize()` — convert `Map<number, Set<EMaterialType>>` to array of `{ buildingId, materials: number[] }`
4. `deserialize(data)` — rebuild the map
5. Add `SerializedStorageFilter` to `game-state-persistence.ts`
6. Add `storageFilters?: SerializedStorageFilter[]` to `GameStateSnapshot`
7. Register in `game-services.ts`: `this.persistenceRegistry.register(this.storageFilterManager)`

**Serialized shape:**
```ts
interface SerializedStorageFilter {
    buildingId: number;
    materials: number[]; // EMaterialType values
}
```

### Subsystem 3 — ProductionControlManager Persistence

**File:** `src/game/features/production-control/production-control-manager.ts`

**Task:**
1. Make `ProductionControlManager` implement `Persistable<SerializedProductionControl[]>`
2. Add `readonly persistKey = 'productionControl' as const`
3. `serialize()` — iterate `this.states`, serialize each `ProductionState` (convert Maps to arrays)
4. `deserialize(data)` — rebuild states, overwriting any fresh state from `initBuilding()`
5. Add `SerializedProductionControl` to `game-state-persistence.ts`
6. Add `productionControl?: SerializedProductionControl[]` to `GameStateSnapshot`
7. Register in `game-services.ts`: `this.persistenceRegistry.register(this.productionControlManager)`

**Serialized shape:**
```ts
interface SerializedProductionControl {
    buildingId: number;
    mode: string; // ProductionMode enum string value
    recipeCount: number;
    roundRobinIndex: number;
    proportions: Array<{ index: number; weight: number }>;
    queue: number[];
    productionCounts: Array<{ index: number; count: number }>;
}
```

### Subsystem 4 — ResidenceSpawnerSystem Persistence

**File:** `src/game/features/building-construction/residence-spawner.ts`

**Task:**
1. Make `ResidenceSpawnerSystem` implement `Persistable<SerializedPendingSpawn[]>`
2. Add `readonly persistKey = 'residenceSpawns' as const`
3. `serialize()` — map `this.pending` array to serialized form
4. `deserialize(data)` — rebuild `this.pending` array. Need to look up `BuildingSpawnConfig` — store it in PendingSpawn or reconstruct from building type.

**Important nuance:** `PendingSpawn` contains a `config: BuildingSpawnConfig` which includes `unitType`, `count`, `spawnInterval`. These must be serialized. The `config` is passed at registration time from the building-construction system.

**Serialized shape:**
```ts
interface SerializedPendingSpawn {
    buildingEntityId: number;
    remaining: number;
    timer: number;
    unitType: number;
    count: number;
    spawnInterval: number;
}
```

5. Add to `GameStateSnapshot`
6. Register in `game-services.ts`

### Subsystem 5 — ResourceSignSystem Persistence

**File:** `src/game/features/ore-veins/resource-sign-system.ts`

**Task:**
1. Make `ResourceSignSystem` implement `Persistable<SerializedResourceSign>`
2. Add `readonly persistKey = 'resourceSigns' as const`
3. `serialize()` — serialize the `signs` map and `elapsed` timer
4. `deserialize(data)` — rebuild the map and set elapsed

**Serialized shape:**
```ts
interface SerializedResourceSign {
    elapsed: number;
    signs: Array<{ entityId: number; x: number; y: number; expiresAt: number }>;
}
```

5. Add to `GameStateSnapshot`
6. Register in `game-services.ts`

### Subsystem 6 — CombatSystem Persistence

**File:** `src/game/features/combat/combat-system.ts`

**Task:**
1. Make `CombatSystem` implement `Persistable<SerializedCombatUnit[]>`
2. Add `readonly persistKey = 'combat' as const`
3. `serialize()` — iterate `this.states`, serialize health and status fields. Skip runtime-transient fields (targetId, attackTimer, pursuitTimers) — combat will re-acquire targets on next scan.
4. `deserialize(data)` — overwrite fresh states created by `register()` with saved health values

**Serialized shape:**
```ts
interface SerializedCombatUnit {
    entityId: number;
    health: number;
    maxHealth: number;
}
```

5. Add to `GameStateSnapshot`
6. Register in `game-services.ts`

### Subsystem 7 — BarracksTrainingManager Persistence

**File:** `src/game/features/barracks/barracks-training-manager.ts`

**Task:**
1. Make `BarracksTrainingManager` implement `Persistable<SerializedBarracksTraining>`
2. Add `readonly persistKey = 'barracksTraining' as const`
3. `serialize()` — serialize `barracksRaces` map and `activeTrainings` map
4. `deserialize(data)` — rebuild both maps. Active trainings reference carrier entity IDs that should already exist after entity restore. The recipe can be serialized as its inputs + unitType + level.

**Serialized shape:**
```ts
interface SerializedBarracksTraining {
    races: Array<{ buildingId: number; race: number }>;
    activeTrainings: Array<{
        buildingId: number;
        carrierId: number;
        recipe: { inputs: Array<{ material: number; count: number }>; unitType: number; level: number };
    }>;
}
```

5. Add to `GameStateSnapshot`
6. Register in `game-services.ts` with `after: ['productionControl']` since barracks calls `pcm.initBuilding()`

### Subsystem 8 — AutoRecruitSystem Persistence (Tier 2)

**File:** `src/game/features/auto-recruit/auto-recruit-system.ts`

**Task:**
1. Make `AutoRecruitSystem` implement `Persistable<SerializedAutoRecruit>`
2. Add `readonly persistKey = 'autoRecruit' as const`
3. `serialize()` — serialize `playerStates` (pending recruitments map per player) and `accumulatedTime`
4. `deserialize(data)` — rebuild player states. The carrier/entity references must still exist.

**Serialized shape:**
```ts
interface SerializedAutoRecruit {
    accumulatedTime: number;
    playerStates: Array<{
        player: number;
        pendingDiggers: number;
        pendingBuilders: number;
        recruitments: Array<{
            carrierId: number;
            targetUnitType: number;
            toolMaterial: number;
            pileEntityId: number;
            siteId: number;
        }>;
    }>;
}
```

5. Add to `GameStateSnapshot`
6. Register in `game-services.ts`

## Integration

### game-state-persistence.ts changes:
- Add all 8 `Serialized*` interfaces
- Add 8 optional fields to `GameStateSnapshot`
- Add imports for `CropStage`
- Bump `SNAPSHOT_VERSION` from 10 to 11

### game-services.ts changes:
- Add 8 `persistenceRegistry.register()` calls after existing ones (around line 220)
- Import types are NOT needed here since persistence is internal to each class

## Dependency order for registration:
```
this.persistenceRegistry.register(this.cropSystem);                    // no deps
this.persistenceRegistry.register(this.storageFilterManager);          // no deps
this.persistenceRegistry.register(this.combatSystem);                  // no deps
this.persistenceRegistry.register(this.signSystem);                    // no deps
this.persistenceRegistry.register(this.residenceSpawner);              // no deps
this.persistenceRegistry.register(this.productionControlManager);      // no deps
this.persistenceRegistry.register(this.barracksTrainingManager, ['productionControl']); // after PCM
this.persistenceRegistry.register(this.autoRecruitSystem);             // no deps (self-heals)
```

Note: AutoRecruitSystem is NOT exposed on GameServices yet. The agent handling it will need to check how it's accessed and add the export if needed.
