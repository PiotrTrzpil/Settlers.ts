# Barracks Soldier Training — Design

## Overview

Each non-DarkTribe race has a Barracks building that converts incoming weapons and gold into soldiers. Barracks receives materials (swords, bows, gold bars, armor, race-specific specialist weapons) via normal carrier delivery. When all inputs for a training recipe are present, the barracks consumes them and recruits the nearest idle carrier — that carrier physically walks to the barracks, enters, trains for a duration, and emerges as a soldier. Recipe selection reuses the existing `ProductionControlManager` (even/proportional/manual modes), which is refactored from `EMaterialType`-keyed to recipe-index-keyed so it works for both material-producing buildings and unit-producing barracks.

## Architecture

### Subsystem Diagram

```
[Carrier Delivery] → [Building Inventory (input slots)]
                              ↓
                    [BarracksTrainingManager]
                        ↓            ↓
         [ProductionControlManager]  [TrainingRecipe configs]
           (recipe-index-based)
                        ↓
                 [Recruit Carrier]
                        ↓
          settlerTaskSystem.assignJob()
                        ↓
              ┌─── Choreography Job ───┐
              │ GO_TO_TARGET (barracks) │
              │ WAIT_VIRTUAL (training) │
              │ CHANGE_TYPE_AT_BARRACKS │
              └────────────────────────┘
                        ↓
        carrier removed, soldier spawns at door
```

Data flow:
1. Carriers deliver weapons/gold/armor to barracks input slots (existing logistics)
2. BarracksTrainingManager ticks each barracks, asks ProductionControlManager for next recipe index
3. If inputs are satisfied → consume inputs, find nearest idle carrier
4. Build a training choreography job (GO_TO_TARGET → WAIT_VIRTUAL → CHANGE_TYPE_AT_BARRACKS)
5. Assign job to carrier via `settlerTaskSystem.assignJob(carrierId, trainingJob)`
6. Carrier executes choreography: walks to barracks, enters (hidden), waits for training duration
7. CHANGE_TYPE_AT_BARRACKS executor: removes carrier entity, spawns soldier at barracks door

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|----------------|-------|
| 1 | ProductionControlManager Refactor | Change keying from `EMaterialType` to recipe index so the manager is reusable for any multi-recipe system | `production-control-manager.ts`, `production-control/types.ts`, `production-control/index.ts` |
| 2 | PCM Callers Update | Update all existing callers of PCM to use recipe-index API | `work-handlers.ts`, `command-types.ts`, `command.ts`, `useProductionControl.ts` |
| 3 | Training Recipe Data & Inventory Config | TrainingRecipe type, per-race recipe configs, barracks input slot expansion | `barracks/types.ts`, `barracks/training-recipes.ts`, `inventory-configs.ts` |
| 4 | Barracks Training Manager | Core training loop: recipe check, input consumption, carrier recruitment, choreography job building | `barracks/barracks-training-manager.ts`, `barracks/index.ts` |
| 5 | CHANGE_TYPE_AT_BARRACKS Executor | Implement the choreography executor stub: remove carrier, spawn soldier, clean up state | `control-executors.ts` |
| 6 | Integration & Wiring | Wire manager into game lifecycle, update spawn-on-complete and production entries | `game-services.ts`, `game.ts`, `spawn-units.ts`, `building-production.ts` |
| 7 | Tests | Verify PCM refactor, recipe configs, training lifecycle, choreography execution | `barracks-training.spec.ts`, `production-system.spec.ts` updates |

## Data Models

### ProductionState (refactored)

Changes from `EMaterialType`-keyed to recipe-index-keyed. The manager no longer knows about recipes, materials, or building types — it just selects indices.

| Field | Type | Before → After | Description |
|-------|------|----------------|-------------|
| mode | `ProductionMode` | unchanged | `'even' \| 'proportional' \| 'manual'` |
| proportions | `Map<number, number>` | was `Map<EMaterialType, number>` | Recipe index → weight (0–10) |
| queue | `number[]` | was `EMaterialType[]` | Recipe indices for manual mode |
| roundRobinIndex | `number` | unchanged | Cursor for even mode |
| productionCounts | `Map<number, number>` | was `Map<EMaterialType, number>` | Recipe index → times produced |

### TrainingRecipe

Barracks-specific recipe that outputs a unit type instead of a material. Uses explicit `{ material, count }` pairs because higher-level soldiers need multiple gold bars.

| Field | Type | Description |
|-------|------|-------------|
| inputs | `{ material: EMaterialType; count: number }[]` | Materials consumed per training cycle |
| unitType | `UnitType` | Soldier type produced (base type, e.g. `Swordsman` not `Swordsman2`) |
| level | `number` | Soldier level (1, 2, or 3) |

Example recipes (all races):
```
Swordsman L1:  [SWORD ×1]
Swordsman L2:  [SWORD ×1, GOLDBAR ×1]
Swordsman L3:  [SWORD ×1, GOLDBAR ×2]
Bowman L1:     [BOW ×1]
Bowman L2:     [BOW ×1, GOLDBAR ×1]
Bowman L3:     [BOW ×1, GOLDBAR ×2]
SquadLeader:   [SWORD ×1, ARMOR ×1]
```

Race-specific specialist recipes (L1/L2/L3 pattern mirrors swordsman):
```
Roman     Medic:                [SWORD ×1]      / +GOLDBAR / +GOLDBAR×2
Viking    AxeWarrior:           [BATTLEAXE ×1]  / +GOLDBAR / +GOLDBAR×2
Mayan     BlowgunWarrior:       [BLOWGUN ×1]    / +GOLDBAR / +GOLDBAR×2
Trojan    BackpackCatapultist:  [CATAPULT ×1]   / +GOLDBAR / +GOLDBAR×2
```

### TrainingRecipeSet

Per-race recipe collection for the barracks. Analogous to `RecipeSet` but for unit training.

| Field | Type | Description |
|-------|------|-------------|
| recipes | `TrainingRecipe[]` | All training recipes available to this race's barracks |

### BarracksTrainingState

Runtime state for an active training session at a barracks. The carrier's movement and training phases are handled by the choreography system — the manager just tracks the association.

| Field | Type | Description |
|-------|------|-------------|
| recipe | `TrainingRecipe` | The recipe being trained |
| carrierId | `number` | Entity ID of the recruited carrier (executing the training choreography) |

The choreography nodes handle all phasing:
1. **GO_TO_TARGET** — carrier walks to barracks door (visible)
2. **WAIT_VIRTUAL** — training duration, carrier hidden inside barracks (potential training animation trigger on the building)
3. **CHANGE_TYPE_AT_BARRACKS** — executor reads recipe from BarracksTrainingManager, removes carrier, spawns soldier

The manager doesn't track progress or phase — the choreography system owns that state via `ChoreoJobState.progress` and `nodeIndex`.

## Internal APIs

### ProductionControlManager (refactored)

The manager becomes a generic "which recipe index should I pick next?" engine. It no longer imports `Recipe`, `RecipeSet`, `getRecipeSet`, or `BuildingType`.

```typescript
class ProductionControlManager {
    // Lifecycle — takes recipe count, not BuildingType
    initBuilding(buildingId: number, recipeCount: number): void
    removeBuilding(buildingId: number): void

    // Core selection — returns recipe index (0..recipeCount-1), not a Recipe object
    getNextRecipeIndex(buildingId: number): number | null

    // Player controls — keyed by recipe index, not EMaterialType
    setMode(buildingId: number, mode: ProductionMode): void
    setProportion(buildingId: number, recipeIndex: number, weight: number): void
    addToQueue(buildingId: number, recipeIndex: number): void
    removeFromQueue(buildingId: number, recipeIndex: number): void

    // Queries
    getProductionState(buildingId: number): Readonly<ProductionState> | undefined
}
```

Key change: `getNextRecipe(buildingId, buildingType) → Recipe | null` becomes `getNextRecipeIndex(buildingId) → number | null`. The caller maps the index to a concrete recipe from their own recipe set.

### BarracksTrainingManager

```typescript
class BarracksTrainingManager {
    // Lifecycle
    initBarracks(buildingId: number, race: Race): void
    removeBarracks(buildingId: number): void

    // Tick (called from game loop)
    tick(dt: number): void

    // Queries
    getTrainingState(buildingId: number): BarracksTrainingState | undefined
    getRecipes(buildingId: number): readonly TrainingRecipe[]
    isTraining(buildingId: number): boolean
}
```

Player controls (mode, proportions, queue) go through `ProductionControlManager` directly — the barracks building is registered there like any multi-recipe building. The UI uses the same commands (`set_production_mode`, `set_recipe_proportion`, etc.).

### Training recipe lookup

```typescript
// Get all training recipes available for a race
function getTrainingRecipes(race: Race): TrainingRecipeSet

// Get the specialist unit type for a race (undefined for DarkTribe)
function getSpecialistUnitType(race: Race): UnitType | undefined

// Get the specialist weapon material for a race (undefined for DarkTribe)
function getSpecialistWeapon(race: Race): EMaterialType | undefined
```

### Carrier recruitment

```typescript
// Find the nearest idle carrier belonging to a player.
// Returns the entity ID, or null if none available.
// Does NOT remove the carrier — it will walk to the barracks
// and be consumed by CHANGE_TYPE_AT_BARRACKS at the end.
function findIdleCarrier(
    carrierManager: CarrierManager,
    gameState: GameState,
    player: number,
    nearX: number,
    nearY: number
): number | null

// Build a training choreography job for a recruited carrier.
// Returns a ChoreoJobState ready for settlerTaskSystem.assignJob().
function buildTrainingJob(
    barracksId: number,
    barracksX: number,
    barracksY: number,
    trainingDurationFrames: number
): ChoreoJobState
```

## Error Handling & Boundaries

| Layer | On error... | Behavior |
|-------|------------|----------|
| Recipe lookup | Race has no recipes (DarkTribe) | `getTrainingRecipes()` returns empty set. `initBarracks()` skips DarkTribe. |
| Input check | Inventory doesn't have enough materials | Training doesn't start. Manager re-checks next tick. |
| Carrier recruitment | No idle carrier available | Inputs are **not** consumed. Training is deferred — manager retries next tick. Materials stay in inventory until a carrier becomes available. |
| Carrier dies en route | Carrier entity removed during GO_TO_TARGET | Choreography interrupts. Manager detects orphaned training state (carrier entity gone) on next tick, clears state. Materials already consumed — lost (matches S4 behavior where interrupted training loses materials). |
| Soldier spawning | No valid tile near barracks door | Use spiral search (existing pattern from `spawn-units.ts`). If all tiles blocked within radius 4, log warning and spawn at barracks position as fallback. |
| Building destroyed mid-training | Building removed while training active | `removeBarracks()` cleans up state. Carrier's choreography is interrupted by the settler task system (building gone → job fails). Materials already consumed. |
| PCM refactor | Existing callers pass wrong types | Compile-time — all callers updated in subsystem 2. |

## Subsystem Details

### Subsystem 1: ProductionControlManager Refactor

**Files**: `src/game/features/production-control/production-control-manager.ts`, `src/game/features/production-control/types.ts`, `src/game/features/production-control/index.ts`

**Owns**: Generic recipe-index-based selection engine.

**Key decisions**:

- **Recipe index keying** — All internal maps change from `Map<EMaterialType, number>` to `Map<number, number>` where the key is the recipe's position (0-based index) within its recipe set. The manager doesn't know what the indices represent.
- **No Recipe/BuildingType imports** — The manager becomes a pure selection strategy engine. `initBuilding(buildingId, recipeCount)` takes a count, not a type. `getNextRecipeIndex(buildingId)` returns an index, not a Recipe. The caller resolves the index to a concrete recipe.
- **Removed `getRecipes()`** — The manager no longer returns recipes. It only knows about indices. Callers query their own recipe set.

**Behavior changes**:

`initBuilding(buildingId, recipeCount)`:
```
for i in 0..recipeCount-1:
    proportions.set(i, 1)
    productionCounts.set(i, 0)
```

`getNextRecipeIndex(buildingId)`:
- Returns `number | null` (index, or null for manual-mode-empty-queue / unregistered building)
- Even mode: `recipes[roundRobinIndex % recipeCount]` → return `roundRobinIndex`, advance cursor
- Proportional mode: find index with largest deficit → return it
- Manual mode: pop first index from queue, or null

`setProportion(buildingId, recipeIndex, weight)`:
- Same clamping logic (0–10), just keyed by `recipeIndex: number` instead of `output: EMaterialType`

`addToQueue(buildingId, recipeIndex)` / `removeFromQueue(buildingId, recipeIndex)`:
- Same push/pop logic, just with `number` instead of `EMaterialType`

### Subsystem 2: PCM Callers Update

**Files**: `src/game/features/settler-tasks/work-handlers.ts`, `src/game/commands/command-types.ts`, `src/game/commands/command.ts`, `src/composables/useProductionControl.ts`

**Owns**: Updating all existing callers to the new recipe-index API.

**Depends on**: Subsystem 1 (new PCM API).

**Changes per file**:

**`work-handlers.ts`** — `createWorkplaceHandler()`:
```typescript
// Before:
const recipe = pcm.getNextRecipe(targetId, building.subType as BuildingType);
if (recipe) {
    activeRecipes.set(targetId, recipe);
    inventoryManager.consumeProductionInputs(targetId, recipe);
}

// After:
const recipeSet = getRecipeSet(building.subType as BuildingType);
const index = pcm.getNextRecipeIndex(targetId);
if (recipeSet && index !== null) {
    const recipe = recipeSet.recipes[index]!;
    activeRecipes.set(targetId, recipe);
    inventoryManager.consumeProductionInputs(targetId, recipe);
}
```

Similarly for `canStoreAnyOutput()`:
```typescript
// Before:
const recipes = pcm!.getRecipes(targetId, building.subType as BuildingType);

// After:
const recipes = getRecipeSet(building.subType as BuildingType)?.recipes ?? [];
```

`initBuilding` call site (in game-services or wherever buildings are registered):
```typescript
// Before:
pcm.initBuilding(buildingId, BuildingType.ToolSmith);

// After:
const recipeSet = getRecipeSet(buildingType);
if (recipeSet) pcm.initBuilding(buildingId, recipeSet.recipes.length);
```

**`command-types.ts`** — Change `output: EMaterialType` to `recipeIndex: number` in three command interfaces:
```typescript
interface SetRecipeProportionCommand {
    type: 'set_recipe_proportion';
    buildingId: number;
    recipeIndex: number;  // was: output: EMaterialType
    weight: number;
}

interface AddToProductionQueueCommand {
    type: 'add_to_production_queue';
    buildingId: number;
    recipeIndex: number;  // was: output: EMaterialType
}

interface RemoveFromProductionQueueCommand {
    type: 'remove_from_production_queue';
    buildingId: number;
    recipeIndex: number;  // was: output: EMaterialType
}
```

**`command.ts`** — Update the three command handlers to pass `cmd.recipeIndex` instead of `cmd.output`:
```typescript
// Before:
ctx.productionControlManager.setProportion(cmd.buildingId, cmd.output, cmd.weight);
// After:
ctx.productionControlManager.setProportion(cmd.buildingId, cmd.recipeIndex, cmd.weight);
```

**`useProductionControl.ts`** — The composable maps between recipe index and display info:
```typescript
// RecipeInfo gains an index field:
interface RecipeInfo {
    index: number;          // recipe index in the set
    output: EMaterialType;  // for display (material icon)
    outputName: string;
    weight: number;
}

// Building the recipe list:
const recipeSet = getRecipeSet(bt);
for (let i = 0; i < recipeSet.recipes.length; i++) {
    const r = recipeSet.recipes[i]!;
    recipes.push({
        index: i,
        output: r.output,
        outputName: EMaterialType[r.output],
        weight: prodState.proportions.get(i) ?? 1,  // was: .get(r.output)
    });
}

// Actions pass index:
function setProportion(recipeIndex: number, weight: number): void { ... }
function addToQueue(recipeIndex: number): void { ... }
function removeFromQueue(recipeIndex: number): void { ... }
```

### Subsystem 3: Training Recipe Data & Inventory Config

**Files**: `src/game/features/barracks/types.ts`, `src/game/features/barracks/training-recipes.ts`, `src/game/features/inventory/inventory-configs.ts`

**Owns**: Data model definitions, per-race recipe configurations, barracks input slot expansion.

**Key decisions**:

- **Explicit `{ material, count }` inputs** instead of `EMaterialType[]` with duplicates — `canStartTraining()` needs to check "has 2 GOLDBAR" for L3 units, which is cleaner with explicit counts than counting array duplicates.
- **Superset inventory config** — Barracks input slots include ALL possible weapon/material types across all races (SWORD, BOW, GOLDBAR, ARMOR, BATTLEAXE, BLOWGUN, CATAPULT). Unused slots for a given race remain empty; the logistics system only delivers materials that are produced. This avoids race-parameterized inventory configs.
- **Input slot capacity**: `4` per material (reduced, like MULTI_RECIPE_OUTPUT_CAPACITY). Barracks consumes materials quickly and doesn't need large buffers.

**Behavior**:

`training-recipes.ts` exports:
- `COMMON_TRAINING_RECIPES`: Swordsman L1–L3, Bowman L1–L3, SquadLeader (shared by all races)
- `SPECIALIST_TRAINING_RECIPES`: `Map<Race, TrainingRecipe[]>` for race-specific specialist L1–L3
- `getTrainingRecipes(race)`: Returns combined common + specialist recipes for a race
- `getTrainingRecipeSet(race)`: Returns `TrainingRecipeSet` (the full set)

`types.ts` exports:
- `TrainingRecipe`, `TrainingRecipeSet`, `BarracksTrainingState` interfaces

`inventory-configs.ts` change — replace the current barracks entry with:
```typescript
[BuildingType.Barrack, {
    inputSlots: [
        { materialType: EMaterialType.SWORD, maxCapacity: 4 },
        { materialType: EMaterialType.BOW, maxCapacity: 4 },
        { materialType: EMaterialType.GOLDBAR, maxCapacity: 4 },
        { materialType: EMaterialType.ARMOR, maxCapacity: 4 },
        { materialType: EMaterialType.BATTLEAXE, maxCapacity: 4 },
        { materialType: EMaterialType.BLOWGUN, maxCapacity: 4 },
        { materialType: EMaterialType.CATAPULT, maxCapacity: 4 },
    ],
    outputSlots: [],
}],
```

### Subsystem 4: Barracks Training Manager

**Files**: `src/game/features/barracks/barracks-training-manager.ts`, `src/game/features/barracks/index.ts`

**Owns**: Training lifecycle, carrier recruitment, choreography job building, training state tracking.

**Depends on**: Subsystem 1 (PCM), Subsystem 3 (recipe types/configs), `BuildingInventoryManager`, `CarrierManager`, `SettlerTaskSystem`, `GameState`.

**Key decisions**:

- **Uses ProductionControlManager** for recipe selection — barracks registers with PCM using `initBuilding(barracksId, recipeCount)`. When ticking, calls `pcm.getNextRecipeIndex(barracksId)` to get the recipe index, then looks up the concrete `TrainingRecipe` from the race-specific recipe set.
- **Choreography-based training** — the manager doesn't track training progress or phases. It builds a choreography job (GO_TO_TARGET → WAIT_VIRTUAL → CHANGE_TYPE_AT_BARRACKS) and assigns it to the carrier via `settlerTaskSystem.assignJob()`. The choreography system handles movement, timing, and the executor handles conversion.
- **Training duration**: Fixed at ~3 seconds (configurable constant `TRAINING_DURATION_FRAMES`). Encoded as the `duration` field on the WAIT_VIRTUAL choreography node.
- **Tick-driven, not event-driven**: Manager checks all barracks each tick rather than reacting to `inventory:changed` events.
- **One training at a time per barracks**: The next recipe is selected only after the current carrier has been converted (state cleared by the CHANGE_TYPE_AT_BARRACKS executor).

**Behavior**:

```
Per barracks, each tick:
1. If activeTraining exists:
   a. Check if carrier entity still exists (may have been killed en route)
   b. If carrier gone: clear activeTraining (materials lost), emit event
   c. Otherwise: do nothing — choreography system handles progression
2. If no activeTraining:
   a. Call pcm.getNextRecipeIndex(barracksId) to get selected recipe index
   b. If null (manual mode empty queue or not registered): skip
   c. Look up TrainingRecipe from race-specific recipe set at that index
   d. Check inventory has all inputs: for each {material, count} in recipe.inputs,
      verify getInputAmount(buildingId, material) >= count
   e. Find idle carrier via findIdleCarrier(carrierManager, gameState, player, barracksX, barracksY)
   f. If inputs satisfied AND carrier available:
      - Consume inputs: for each {material, count}, withdrawInput(buildingId, material, count)
      - Build training choreography job via buildTrainingJob(barracksId, x, y, duration)
      - Assign job to carrier via settlerTaskSystem.assignJob(carrierId, trainingJob)
      - Set activeTraining = { recipe, carrierId }
      - Emit barracks:trainingStarted event
   g. If inputs not satisfied OR no carrier: skip (retry next tick)
```

`buildTrainingJob(barracksId, x, y, durationFrames)` creates a `ChoreoJobState` with three nodes:
1. **GO_TO_TARGET** — `{ task: GO_TO_TARGET, entity: '', duration: 0 }` — carrier walks to barracks. `targetId` set to barracks entity ID.
2. **WAIT_VIRTUAL** — `{ task: WAIT_VIRTUAL, duration: TRAINING_DURATION_FRAMES, trigger: 'BARRACKS_TRAINING' }` — carrier hidden inside barracks for training duration. The `trigger` field can drive a building overlay animation (smoke, sparks, etc.).
3. **CHANGE_TYPE_AT_BARRACKS** — `{ task: CHANGE_TYPE_AT_BARRACKS, entity: '', duration: 0 }` — executor reads recipe from BarracksTrainingManager and performs conversion.

The job is built programmatically (similar to `settlerTaskSystem.buildTransportJob()` for carrier transport), not loaded from jobInfo.xml.

**State lookup API for executor**:
```typescript
// Called by CHANGE_TYPE_AT_BARRACKS executor to get the recipe for this carrier.
getTrainingForCarrier(carrierId: number): { buildingId: number; recipe: TrainingRecipe } | undefined

// Called by CHANGE_TYPE_AT_BARRACKS executor after successful conversion.
completeTraining(buildingId: number): void
```

**Events emitted** (via EventBus):
- `barracks:trainingStarted` — `{ buildingId, recipe: TrainingRecipe, carrierId: number }`
- `barracks:trainingCompleted` — `{ buildingId, unitType: UnitType, level: number, soldierId: number }`
- `barracks:trainingInterrupted` — `{ buildingId, reason: 'carrier_killed' }`

### Subsystem 5: CHANGE_TYPE_AT_BARRACKS Executor

**Files**: `src/game/features/settler-tasks/internal/control-executors.ts`

**Owns**: The actual carrier → soldier conversion at the end of the training choreography.

**Depends on**: Subsystem 4 (BarracksTrainingManager for recipe lookup), `GameState`, `CarrierManager`.

**Key decisions**:

- **Replaces the existing stub** — the current `executeChangeTypeAtBarracks` logs a warning and returns DONE. The new implementation performs the actual conversion.
- **Remove + spawn (not mutate)** — rather than mutating the carrier entity's type in place (which would require updating many indices and caches), we remove the carrier and spawn a fresh soldier entity. This is the same pattern used by building spawn-on-complete.
- **Executor accesses BarracksTrainingManager via ChoreoContext** — the context is extended with an optional `barracksTrainingManager` field so the executor can look up the recipe.

**Behavior**:

```typescript
function executeChangeTypeAtBarracks(settler, job, node, dt, ctx): TaskResult {
    const training = ctx.barracksTrainingManager!.getTrainingForCarrier(settler.id);
    if (!training) {
        log.warn(`No training state for carrier ${settler.id}, skipping`);
        return TaskResult.DONE;
    }

    const { buildingId, recipe } = training;
    const barracks = ctx.gameState.getEntityOrThrow(buildingId, 'barracks');
    const unitType = getUnitTypeAtLevel(recipe.unitType, recipe.level);

    // Spawn soldier near barracks door
    const spawnPos = findSpawnPosition(barracks.x, barracks.y, ctx.gameState);
    ctx.gameState.addEntity({
        type: EntityType.Unit,
        subType: unitType,
        x: spawnPos.x,
        y: spawnPos.y,
        player: settler.player,
        race: settler.race,
        level: recipe.level,
    });

    // Remove the carrier (this entity). CarrierManager cleanup happens
    // via the entity:removed event listener.
    ctx.gameState.removeEntity(settler.id);

    // Notify manager to clear training state
    ctx.barracksTrainingManager!.completeTraining(buildingId);

    return TaskResult.DONE;
}
```

**ChoreoContext extension**:
```typescript
// Add to ChoreoContext (or its sub-interfaces):
barracksTrainingManager?: BarracksTrainingManager;
```

This is wired in `WorkerTaskExecutor` or `SettlerTaskSystem` where the ChoreoContext is constructed.

### Subsystem 6: Integration & Wiring

**Files**: `src/game/game-services.ts`, `src/game/game.ts`, `src/game/features/building-construction/spawn-units.ts`, `src/game/economy/building-production.ts`

**Owns**: Lifecycle wiring, construction spawn config update, production chain cleanup, ChoreoContext extension.

**Depends on**: Subsystem 3 (recipe types), Subsystem 4 (manager class), Subsystem 5 (executor).

**Changes**:

**`game-services.ts`**:
- Import `BarracksTrainingManager`
- Add `public readonly barracksTrainingManager: BarracksTrainingManager`
- Instantiate in constructor, passing `inventoryManager`, `carrierManager`, `gameState`, `productionControlManager`
- Subscribe to building lifecycle events:
  - On barracks construction complete: call `barracksTrainingManager.initBarracks(id, race)` which internally also calls `pcm.initBuilding(id, recipeCount)`
  - On barracks removed: call `barracksTrainingManager.removeBarracks(id)` which internally calls `pcm.removeBuilding(id)`
- Wire `barracksTrainingManager` into `ChoreoContext` so the CHANGE_TYPE_AT_BARRACKS executor can access it

**`game.ts`**:
- Register `barracksTrainingManager.tick(dt)` in the game tick loop, after carrier/logistics ticks

**`spawn-units.ts`**:
- Remove `[BuildingType.Barrack]: { unitType: UnitType.Swordsman, count: 3 }` from `BUILDING_SPAWN_ON_COMPLETE`. Soldiers come from training, not from construction completion.

**`building-production.ts`**:
- Remove `Barrack` from `BUILDING_PRODUCTIONS` entirely — the barracks is not a standard production building. Its inputs are managed by the training system.
- Keep barracks in `INVENTORY_CONFIGS` (subsystem 3 handles this) so `BuildingInventoryManager` still creates slots for it.
- Update `getBuildingTypesRequestingMaterial()` to also check barracks input slots so the logistics system delivers materials. Add a helper `getBarracksRequestedMaterials(): EMaterialType[]` that returns the superset of all barracks input materials, and include `BuildingType.Barrack` in results for matching materials.

### Subsystem 7: Tests

**Files**: `tests/unit/economy/barracks-training.spec.ts`, `tests/unit/economy/production-system.spec.ts` (updates)

**Covers**:

1. **PCM refactor tests** (update existing production-system.spec.ts):
   - `initBuilding(id, 6)` creates state with indices 0–5
   - Even mode: round-robins through indices 0, 1, 2, ..., 5, 0, ...
   - Proportional mode: `setProportion(id, 0, 3)` weights index 0 at 3x
   - Manual mode: `addToQueue(id, 2)` → `getNextRecipeIndex()` returns 2
   - Existing ToolSmith/WeaponSmith behavior unchanged (just keyed differently)

2. **Recipe config tests**:
   - `getTrainingRecipes(Race.Roman)` returns Swordsman L1–L3, Bowman L1–L3, SquadLeader, Medic L1–L3 = 10 recipes
   - `getTrainingRecipes(Race.Viking)` returns 7 common + 3 AxeWarrior = 10 recipes
   - `getTrainingRecipes(Race.Mayan)` returns 7 common + 3 BlowgunWarrior = 10 recipes
   - `getTrainingRecipes(Race.Trojan)` returns 7 common + 3 BackpackCatapultist = 10 recipes
   - `getTrainingRecipes(Race.DarkTribe)` returns empty set

3. **Training choreography lifecycle** (using TestGame helper):
   - Build barracks → deposit SWORD ×1 → tick → carrier recruited + assigned choreography job
   - Carrier walks to barracks → arrives → hidden during WAIT_VIRTUAL
   - CHANGE_TYPE_AT_BARRACKS executes → carrier removed, swordsman L1 spawned
   - Deposit SWORD + GOLDBAR → trains Swordsman L2
   - Deposit BOW → trains Bowman L1
   - Deposit SWORD + ARMOR → trains SquadLeader

4. **Carrier recruitment tests**:
   - Materials ready + idle carrier available → carrier recruited, job assigned
   - Materials ready + no idle carrier → training deferred, materials stay in inventory
   - Carrier killed en route → training state cleared, materials lost

5. **CHANGE_TYPE_AT_BARRACKS executor tests**:
   - Executor reads recipe from BarracksTrainingManager
   - Carrier entity removed, soldier entity spawned with correct type/level/race
   - CarrierManager cleanup fires via entity:removed event
   - BarracksTrainingManager.completeTraining() called

6. **Recipe selection integration**:
   - Even mode: barracks round-robins through training recipes
   - Proportional mode: respects weight settings
   - Manual mode: follows queue, idles when empty
   - PCM controls (setMode, setProportion, addToQueue) work for barracks buildings

7. **Edge cases**:
   - Building destroyed mid-training → state cleaned up (both training and PCM state)
   - Multiple barracks training simultaneously → independent state
   - Inventory updated between ticks → correctly reflects latest amounts

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/barracks/types.ts` | 3 | TrainingRecipe, TrainingRecipeSet, BarracksTrainingState |
| `src/game/features/barracks/training-recipes.ts` | 3 | Per-race recipe configs, getTrainingRecipes() |
| `src/game/features/barracks/barracks-training-manager.ts` | 4 | Core training manager class |
| `src/game/features/barracks/index.ts` | 4 | Barrel export |
| `tests/unit/economy/barracks-training.spec.ts` | 7 | Barracks training tests |

### Modified Files

| File | Subsystem | Change |
|------|-----------|--------|
| `src/game/features/production-control/types.ts` | 1 | `Map<EMaterialType, number>` → `Map<number, number>`, `EMaterialType[]` → `number[]` |
| `src/game/features/production-control/production-control-manager.ts` | 1 | `initBuilding(id, BuildingType)` → `initBuilding(id, recipeCount)`, `getNextRecipe()` → `getNextRecipeIndex()`, remove Recipe/BuildingType/getRecipeSet imports |
| `src/game/features/production-control/index.ts` | 1 | Update barrel export (remove `getRecipes` if exposed) |
| `src/game/features/settler-tasks/work-handlers.ts` | 2 | Update `createWorkplaceHandler` to call `getNextRecipeIndex()` + look up recipe from `getRecipeSet()` |
| `src/game/commands/command-types.ts` | 2 | `output: EMaterialType` → `recipeIndex: number` in 3 command interfaces |
| `src/game/commands/command.ts` | 2 | Update 3 command handlers: `cmd.output` → `cmd.recipeIndex` |
| `src/composables/useProductionControl.ts` | 2 | Map recipe indices to display info, update action dispatchers |
| `src/game/features/inventory/inventory-configs.ts` | 3 | Expand barracks input slots (SWORD, BOW, GOLDBAR, ARMOR, BATTLEAXE, BLOWGUN, CATAPULT) |
| `src/game/features/settler-tasks/internal/control-executors.ts` | 5 | Implement CHANGE_TYPE_AT_BARRACKS executor (replace stub) |
| `src/game/features/settler-tasks/choreo-types.ts` | 6 | Extend ChoreoContext with `barracksTrainingManager` |
| `src/game/economy/building-production.ts` | 6 | Remove Barrack from BUILDING_PRODUCTIONS, update getBuildingTypesRequestingMaterial |
| `src/game/features/building-construction/spawn-units.ts` | 6 | Remove Barrack from BUILDING_SPAWN_ON_COMPLETE |
| `src/game/game-services.ts` | 6 | Instantiate and wire BarracksTrainingManager, update PCM init call sites |
| `src/game/game.ts` | 6 | Register barracksTrainingManager.tick() in game loop |
| `tests/unit/economy/production-system.spec.ts` | 7 | Update existing PCM tests for recipe-index API |

## Open Questions

1. **Roman Medic weapon**: Roman Medic uses SWORD as training material (same material as Swordsman, but produces a different unit type). This means Roman barracks has two recipe categories consuming SWORD: Swordsman L1–L3 and Medic L1–L3. The recipe selection system distinguishes them by index.

answer : yes, that's right

2. **Training duration per level**: Should L3 soldiers take longer to train than L1? Current design uses a fixed duration (3s). S4 uses the same duration. If variable durations are desired, it's a trivial config change.

answer: yes

3. **Carrier recruitment source**: Design uses nearest idle carrier to the barracks for visual coherence. An alternative is to prefer carriers from the nearest tavern specifically. The nearest-carrier approach is simpler and more responsive.

answer: use nearest

4. **Training animation**: The WAIT_VIRTUAL node includes a `trigger` field (`'BARRACKS_TRAINING'`). If a building overlay animation exists for this trigger, it will play during training (e.g., smoke from chimney, sparks). If no animation exists, the barracks simply sits idle visually. The trigger system already handles missing triggers gracefully.

## Out of Scope

- **Dark Tribe military**: Dark Tribe has a completely different military system (temples, shamans, mana copters). Not covered here.
- **Barracks UI panel**: Vue component for controlling barracks recipe selection (mode, proportions, queue). The composable update (subsystem 2) enables this, but the actual panel component is a separate task.
- **Combat system**: Soldiers are spawned but combat/health is a separate feature.
- **Barracks building overlay animation**: The training trigger (`BARRACKS_TRAINING`) is fired but no animation asset is created. Adding visual feedback (smoke, sparks) during training is a separate art/renderer task.
