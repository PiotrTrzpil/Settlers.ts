# Tower Garrison — Design

## Overview

Military buildings (GuardTowerSmall, GuardTowerBig, Castle) can be garrisoned by Swordsmen and Bowmen. When a tower is completely empty, the nearest idle Swordsman (or Bowman if no Swordsman is available) auto-walks to occupy it. Players can also manually send selected soldiers to a tower. Garrisoned units disappear from the world at the door, become unselectable, and ignore all other commands. The building selection panel shows garrison status and lets the player eject units — except the last remaining soldier.

## Summary for Review

- **Interpretation**: Towers have typed slot capacity (swordsman slots + bowman slots). Only `Swordsman` (L1/L2/L3) and `Bowman` (L1/L2/L3) are valid garrison unit types — no other unit types participate in garrison. Auto-garrison fires only when a tower is completely empty (0 garrisoned, 0 en-route), and sends exactly one soldier (nearest Swordsman preferred, Bowman fallback). Manual garrison fills remaining slots up to capacity. The last soldier in a tower — of any type — cannot be ejected.

- **Assumptions**:
  - Any Swordsman level (1/2/3) fills a swordsman slot. Any Bowman level (1/2/3) fills a bowman slot.
  - Auto-garrison sends exactly 1 unit and stops. It will not auto-fill remaining slots after the first.
  - When the garrison command is issued, units are immediately reserved via `UnitReservationRegistry` before they start walking. This prevents player move commands from interrupting them — the same mechanism used by barracks training.
  - En-route state IS persisted. After a save/load, the manager knows which units are walking to which tower and re-reserves them in `deserialize()`. The arrival detector continues normally.
  - A unit en-route to garrison will not react to other move/work commands (blocked by `UnitReservationRegistry` check in the move handlers).
  - Garrisoned units do not participate in combat (future feature).
  - When a garrisoned or en-route unit is killed/removed externally, the garrison state and reservation clean up silently.

- **Architecture**: Self-contained `tower-garrison` feature module. `TowerGarrisonManager` owns all garrison + en-route state and persists both. It uses the shared `UnitReservationRegistry` (from `ctx.unitReservation`) to lock units during transit. `AutoGarrisonSystem` scans every 30 ticks for completely-empty towers and sends 1 soldier. Arrival is detected via `unit:movementStopped` subscription. Commands validate capacity and role fit. Selection panel gets a garrison section via a Vue composable.

- **Contracts & boundaries**: All state lives in `TowerGarrisonManager`. Commands are the only mutation path. `UnitReservationRegistry.reserve/release` is called on en-route transitions; `entity.hidden` is set true on `finalizeGarrison`, cleared on eject.

- **Scope**: Includes garrison/ungarrison, auto-garrison (one unit, empty-tower trigger), UI panel. Does not include combat bonuses, morale, or siege interactions.

## Project Conventions (extracted)

### Code Style
- Feature modules in `src/game/features/<name>/` with `index.ts`, `types.ts`, `*-manager.ts`, `*-system.ts`, `internal/`.
- Domain logic stays in the feature; nothing garrison-specific in `GameState`.
- Config object pattern for 3+ constructor params: `interface TowerGarrisonManagerConfig extends CoreDeps { ... }`.
- Deterministic map iteration: `sortedEntries(map)` from `@/utilities/collections`.
- Events: `domain:past-tense-verb`, fire-and-forget, immutable payloads.

### Error Handling
- Stored IDs: `getEntityOrThrow(id, 'TowerGarrisonManager')`. Event-received IDs: nullable lookup (entity may have been removed between event and handler).
- TickSystems wrap per-entity updates in try/catch; never throw from `tick()`.
- Commands return `boolean` (false = rejected, not an error).

### Type Philosophy
- Required fields required. No defensive optionals on guaranteed state.
- `!` assertion only for values guaranteed by feature lifecycle (e.g., `initTower` called before any query).

### Representative Pattern

```typescript
// From barracks-training-manager.ts — the model to follow
export interface TowerGarrisonManagerConfig extends CoreDeps {
    settlerTaskSystem: SettlerTaskSystem;
    unitReservation: UnitReservationRegistry; // from ctx.unitReservation — shared kernel service
}

export class TowerGarrisonManager implements Persistable<SerializedTowerGarrison> {
    readonly persistKey = 'towerGarrison' as const;
    private readonly garrisons = new Map<number, BuildingGarrisonState>();
    private readonly enRoute = new Map<number, number>(); // unitId → towerId

    constructor(config: TowerGarrisonManagerConfig) { ... }

    initTower(buildingId: number, buildingType: BuildingType): void { ... }
    removeTower(buildingId: number): void { ... }
    getGarrison(buildingId: number): Readonly<BuildingGarrisonState> { ... }
    isEnRoute(unitId: number): boolean { ... }
    getTowerIdForEnRouteUnit(unitId: number): number | undefined { ... }
    canFitUnit(buildingId: number, unitType: UnitType): boolean { ... }
    needsAutoGarrison(buildingId: number): boolean { ... }
    markEnRoute(unitId: number, towerId: number): void { ... }
    cancelEnRoute(unitId: number): void { ... }
    finalizeGarrison(unitId: number, towerId: number): void { ... }
    ejectUnit(unitId: number, towerId: number): void { ... }
    onEntityRemoved(entityId: number): void { ... }

    serialize(): SerializedTowerGarrison { ... }
    deserialize(data: SerializedTowerGarrison): void { ... }
}
```

## Architecture

### Data Flow

```
Player selects soldiers → clicks tower building
  → GarrisonUnitsCommand
    → filter to fitting units by role + slot availability
    → unitReservation.reserve(unitId) + markEnRoute() per accepted unit
    → settlerTaskSystem.assignMoveTask() per unit
      → unit:movementStopped (unit near door)
        → finalizeGarrison → unitReservation still held, entity.hidden=true

Auto tick (every 30 ticks):
  AutoGarrisonSystem.tick()
    → for each tower where needsAutoGarrison() == true
    → find nearest idle Swordsman (prefer) or Bowman (fallback) from same player
    →   (idle = not reserved in UnitReservationRegistry)
    → execute garrison_units command with that single unit

UI panel click (ungarrison):
  → UngarrisonUnitCommand
    → reject if total garrisoned == 1 (last soldier)
    → ejectUnit → unitReservation.release(), entity.hidden=false, position = door tile
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Garrison Capacity | Slot config per building type, role classification | — | `internal/garrison-capacity.ts` |
| 2 | Garrison State Manager | All garrison + en-route state, persistence | 1 | `tower-garrison-manager.ts` |
| 3 | Garrison Commands | Command handlers for garrison/ungarrison | 2 | `internal/garrison-commands.ts` |
| 4 | Auto-Garrison System | Scan empty towers every 30 ticks, send 1 soldier | 2 | `tower-garrison-auto-system.ts` |
| 5 | Arrival Detector | unit:movementStopped → finalize garrison | 2 | `internal/arrival-detector.ts` |
| 6 | Garrison Feature | Wires subsystems, registers events/commands/persistence | 2–5 | `tower-garrison-feature.ts` |
| 7 | Selection Panel UI | Garrison section in building selection panel | 2 (via composable) | `src/components/selection-panel.vue`, `src/composables/use-garrison.ts` |

## Shared Contracts (as code)

```typescript
// === types.ts ===

/** Which slot role a unit fills. Only Swordsman and Bowman unit types are valid. */
export type GarrisonRole = 'swordsman' | 'bowman';

export interface GarrisonSlotSet {
    max: number;
    unitIds: number[]; // ordered by garrison time (earliest first)
}

export interface BuildingGarrisonState {
    buildingId: number;
    swordsmanSlots: GarrisonSlotSet;
    bowmanSlots: GarrisonSlotSet;
}

export interface SerializedTowerGarrison {
    garrisons: Array<{
        buildingId: number;
        swordsmanUnitIds: number[];
        bowmanUnitIds: number[];
    }>;
    /** Persisted so arrival detection resumes correctly after load. */
    enRoute: Array<{ unitId: number; towerId: number }>;
}
```

```typescript
// === internal/garrison-capacity.ts ===

export interface GarrisonCapacity {
    swordsmanSlots: number;
    bowmanSlots: number;
}

// Slot constants:
// BuildingType.GuardTowerSmall → { swordsmanSlots: 1, bowmanSlots: 2 }
// BuildingType.GuardTowerBig   → { swordsmanSlots: 3, bowmanSlots: 3 }
// BuildingType.Castle          → { swordsmanSlots: 5, bowmanSlots: 5 }

/** Returns undefined for non-garrison buildings. */
export function getGarrisonCapacity(buildingType: BuildingType): GarrisonCapacity | undefined;

/**
 * Maps a UnitType to its garrison role.
 * Only Swordsman (L1/L2/L3) → 'swordsman' and Bowman (L1/L2/L3) → 'bowman' are valid.
 * All other unit types return undefined (cannot garrison).
 *
 * Implemented as an explicit lookup — no dynamic inference from isUnitTypeMilitary().
 */
export function getGarrisonRole(unitType: UnitType): GarrisonRole | undefined;

const GARRISON_ROLE_MAP: ReadonlyMap<UnitType, GarrisonRole> = new Map([
    [UnitType.Swordsman,  'swordsman'],
    [UnitType.Swordsman2, 'swordsman'],
    [UnitType.Swordsman3, 'swordsman'],
    [UnitType.Bowman,     'bowman'],
    [UnitType.Bowman2,    'bowman'],
    [UnitType.Bowman3,    'bowman'],
]);
```

```typescript
// === command-types.ts additions ===

export interface GarrisonUnitsCommand {
    type: 'garrison_units';
    buildingId: number;
    /** Unit IDs to attempt to garrison. Handler filters to those that fit. */
    unitIds: number[];
}

export interface UngarrisonUnitCommand {
    type: 'ungarrison_unit';
    buildingId: number;
    unitId: number;
}
```

```typescript
// === event-bus.ts additions (GameEvents) ===

'garrison:unitEntered': { buildingId: number; unitId: number };
'garrison:unitExited':  { buildingId: number; unitId: number };
```

```typescript
// === src/composables/use-garrison.ts ===

export interface GarrisonInfo {
    /** All currently garrisoned units (both roles combined, swordsmen listed first). */
    garrisonedUnits: Array<{ unitId: number; unitType: UnitType; level: number }>;
    swordsmanSlots: { max: number; filled: number };
    bowmanSlots:    { max: number; filled: number };
    /**
     * False when this unit is the last soldier in the building (total garrisoned == 1).
     * The last soldier cannot be removed regardless of type.
     */
    canEject: (unitId: number) => boolean;
}

export function useGarrison(buildingId: ComputedRef<number | null>): ComputedRef<GarrisonInfo | null>;
```

## Subsystem Details

### Subsystem 1: Garrison Capacity (`internal/garrison-capacity.ts`)

**Files**: `src/game/features/tower-garrison/internal/garrison-capacity.ts`

**Owns**: static capacity config, explicit role classification for 6 unit types.

**Behavior**:
- `getGarrisonCapacity(buildingType)`: returns `GarrisonCapacity | undefined`. Only GuardTowerSmall, GuardTowerBig, Castle return a value; all others return `undefined`.
- `getGarrisonRole(unitType)`: explicit lookup in `GARRISON_ROLE_MAP`. Returns `undefined` for any unit not in the map. No dynamic inference — the map is the complete spec.

---

### Subsystem 2: Garrison State Manager (`tower-garrison-manager.ts`)

**Files**: `src/game/features/tower-garrison/tower-garrison-manager.ts`

**Owns**: all runtime garrison state, en-route tracking, persistence for both.

**Key decisions**:
- `garrisons: Map<buildingId, BuildingGarrisonState>` — per-tower garrison state.
- `enRoute: Map<unitId, towerId>` — units currently walking to a tower.
- Both maps are persisted. On deserialization, `markEnRoute()` is NOT called (movement is already in-flight from the saved unit state); instead `deserialize()` restores the map AND calls `unitReservation.reserve()` for each en-route unit so the move-command guard still holds after load.
- Unit "selectability" is NOT managed by direct `entity.selectable` mutation. The shared `UnitReservationRegistry` (same system used by barracks training) is the single source of truth for "this unit cannot be player-moved".

**Behavior**:
- `initTower(buildingId, buildingType)`: gets capacity, creates `BuildingGarrisonState` with empty slot sets. Throws if `getGarrisonCapacity()` returns undefined.
- `removeTower(buildingId)`: ejects all garrisoned units (hidden=false, position=door, `unitReservation.release()`), cancels all en-route units for this tower (`unitReservation.release()` for each), deletes garrison entry. No-op if this building ID is not a garrison building.
- `needsAutoGarrison(buildingId)`: returns `true` iff `totalGarrisoned == 0 AND totalEnRoute == 0` for this building. Total garrisoned = swordsmanSlots.unitIds.length + bowmanSlots.unitIds.length. Total en-route = count of enRoute entries whose value equals this buildingId.
- `canFitUnit(buildingId, unitType)`: returns `true` iff `getGarrisonRole(unitType)` is defined AND the matching slot set has `unitIds.length < max`.
- `markEnRoute(unitId, towerId)`: adds to `enRoute` map, calls `unitReservation.reserve(unitId)`.
- `cancelEnRoute(unitId)`: removes from `enRoute`, calls `unitReservation.release(unitId)`.
- `finalizeGarrison(unitId, towerId)`: removes from `enRoute` (reservation stays — unit is now garrisoned and still must not be moved), adds unitId to the correct slot set (determined by `getGarrisonRole(entity.subType as UnitType)`), sets `entity.hidden = true`. Emits `garrison:unitEntered`.
- `ejectUnit(unitId, towerId)`: removes from slot set, calls `unitReservation.release(unitId)`, sets `entity.hidden = false`, sets entity position to tower door tile. Emits `garrison:unitExited`.
- `onEntityRemoved(entityId)`: if entityId is in `enRoute`, call `unitReservation.release(entityId)` and remove from map (entity is gone, no eject path). If entityId is in any garrison slot set, call `unitReservation.release(entityId)` and remove from slot set silently.
- Serialization: `sortedEntries(garrisons)` for determinism.
- Deserialization: restore both `garrisons` and `enRoute` maps, then call `unitReservation.reserve()` for every restored en-route unit ID.

---

### Subsystem 3: Garrison Commands (`internal/garrison-commands.ts`)

**Files**: `src/game/features/tower-garrison/internal/garrison-commands.ts`

**Owns**: command handler functions for `garrison_units` and `ungarrison_unit`.

**Behavior — `garrison_units`**:
1. Look up building entity (nullable — user input). Return false if not found or `getGarrisonCapacity(buildingType)` is undefined.
2. Filter `unitIds`: keep only units where entity exists, `getGarrisonRole(unitType)` is defined, and `manager.canFitUnit(buildingId, unitType)` is true. Skip units already en-route to this same tower (idempotent).
3. Further trim: greedily allocate to fill available slots by role (swordsman slots first, then bowman slots) — stop when a role's slots are full.
4. If no units pass: return false.
5. For each accepted unit: `manager.markEnRoute(unitId, buildingId)`, then `settlerTaskSystem.assignMoveTask(unitId, doorX, doorY)`.
6. Return true.

**Behavior — `ungarrison_unit`**:
1. Look up building entity (nullable). Return false if not found.
2. Look up garrison; return false if `unitId` is not in either slot set.
3. Compute `totalGarrisoned = swordsmanSlots.unitIds.length + bowmanSlots.unitIds.length`. Return false if `totalGarrisoned == 1` (last soldier — cannot eject regardless of type).
4. Call `manager.ejectUnit(unitId, buildingId)`. Return true.

**Guard in existing movement handlers**: The `move_unit` and `move_selected_units` handlers check `unitReservation.isReserved(unitId)` and reject the command for any reserved unit. This is already implemented in `src/game/commands/handlers/unit-handlers.ts` and is the same check that protects barracks-training carriers. Garrison soldiers are reserved from the moment `markEnRoute()` is called until `ejectUnit()` or `onEntityRemoved()` releases them.

**Shared reservation system**: `UnitReservationRegistry` (at `src/game/systems/unit-reservation.ts`) is the single shared mechanism for "unit cannot be player-moved". Barracks training already uses it (reserves carrier on `tryStartTraining`, releases on `completeTraining`/carrier killed/barracks removed). Garrison uses the same `ctx.unitReservation` provided via `FeatureContext`. The `assignMoveTask()` call additionally sets `runtime.state = WORKING`, which prevents idle auto-work search — also consistent with barracks.

---

### Subsystem 4: Auto-Garrison System (`tower-garrison-auto-system.ts`)

**Files**: `src/game/features/tower-garrison/tower-garrison-auto-system.ts`

**Owns**: periodic scan to fill completely-empty towers with exactly one soldier.

**Key decisions**:
- Fires every 30 ticks.
- `needsAutoGarrison()` is the gate: only towers with 0 garrisoned AND 0 en-route are targeted. This guarantees at most one soldier is ever auto-assigned per tower at a time — the en-route count prevents double-dispatch.
- Prefers Swordsman over Bowman: tries to find an idle Swordsman (any level) first; only uses a Bowman if no Swordsman is available.
- "Idle" means: the unit is not reserved (`!unitReservation.isReserved(unitId)`). A reserved unit is either walking to a tower or already garrisoned — both states make it ineligible. In practice: filter all unit entities of the target player with `getGarrisonRole(subType) !== undefined` and `!unitReservation.isReserved(id)`.
- Distance metric: Chebyshev distance from unit position to tower door position.

**Behavior**:
- `tick(dt)`: accumulates tick count, fires scan at multiples of 30.
- Scan loop (sorted by building entity ID for determinism):
  1. For each garrison building where `manager.needsAutoGarrison(buildingId) == true`:
  2. Collect candidate units: all unit entities belonging to the same player where `getGarrisonRole(subType) !== undefined` and `!unitReservation.isReserved(id)`.
  3. Among candidates, try Swordsman-role first, then Bowman-role. Within each role, pick the one with minimum Chebyshev distance to the tower door.
  4. If a candidate is found: execute `garrison_units` command with `{ buildingId, unitIds: [candidateId] }`.
  5. The command calls `markEnRoute` immediately, so the next iteration of the loop will see `needsAutoGarrison() == false` for this tower — preventing double-assignment within the same scan.

---

### Subsystem 5: Arrival Detector (`internal/arrival-detector.ts`)

**Files**: `src/game/features/tower-garrison/internal/arrival-detector.ts`

**Owns**: translating `unit:movementStopped` into a garrison finalization.

**Key decisions**:
- Proximity threshold: unit position within 1 tile (Chebyshev) of the tower door tile.
- If unit stopped but is not within threshold (edge case: pathfinding stopped early), leave it in en-route. The auto-garrison system will re-issue movement on its next scan for auto-assigned units; manually assigned units are already walking and will retry automatically via the movement system.

**Behavior**:
- `onMovementStopped(entityId)`: look up `manager.getTowerIdForEnRouteUnit(entityId)` (returns `undefined` if not en-route — common case, return early). If found: get tower entity and door position. Check Chebyshev distance from unit position to door. If within threshold: `manager.finalizeGarrison(entityId, towerId)`. Otherwise: no-op.

---

### Subsystem 6: Tower Garrison Feature (`tower-garrison-feature.ts`)

**Files**: `src/game/features/tower-garrison/tower-garrison-feature.ts`, `index.ts`

**Owns**: feature wiring only — creates subsystems, wires events, exposes exports.

**Behavior**:
```typescript
export const TowerGarrisonFeature: FeatureDefinition = {
    id: 'tower-garrison',
    dependencies: ['settler-tasks', 'movement'],
    create(ctx): FeatureInstance {
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const manager = new TowerGarrisonManager({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            settlerTaskSystem,
            unitReservation: ctx.unitReservation,
        });
        const autoSystem = new AutoGarrisonSystem({
            manager,
            unitReservation: ctx.unitReservation,
            executeCommand: ctx.executeCommand,
            gameState: ctx.gameState,
        });
        const arrivalDetector = new ArrivalDetector(manager, ctx.gameState);

        ctx.on('building:completed', ({ entityId, buildingType }) => {
            if (getGarrisonCapacity(buildingType)) manager.initTower(entityId, buildingType);
        });
        ctx.on('building:removed', ({ entityId }) => {
            manager.removeTower(entityId); // no-op for non-garrison buildings
        });
        ctx.on('unit:movementStopped', ({ entityId }) => {
            arrivalDetector.onMovementStopped(entityId);
        });
        ctx.cleanupRegistry.onEntityRemoved(entityId => manager.onEntityRemoved(entityId));

        return {
            systems: [autoSystem],
            exports: { garrisonManager: manager },
            persistence: [manager],
            commands: {
                garrison_units:   (cmd) => executeGarrisonUnitsCommand(cmd, manager, settlerTaskSystem, ctx.gameState),
                ungarrison_unit:  (cmd) => executeUngarrisonUnitCommand(cmd, manager, ctx.gameState),
            },
        };
    },
};
```

---

### Subsystem 7: Selection Panel UI (`selection-panel.vue`, `use-garrison.ts`)

**Files**: `src/components/selection-panel.vue`, `src/composables/use-garrison.ts`

**Owns**: garrison display and eject interaction.

**Behavior — `use-garrison.ts`**:
- Returns `null` if selected building has no garrison capacity.
- `garrisonedUnits` lists swordsmen first (slot order), then bowmen. Each entry includes `{ unitId, unitType, level }` read from entity.
- `canEject(unitId)`: returns `false` if `swordsmanSlots.unitIds.length + bowmanSlots.unitIds.length == 1`. Returns `true` otherwise.

**Behavior — `selection-panel.vue`**:
- Render a "Garrison" section when `garrison.value !== null`.
- Two rows: swordsman slots (row 1), bowman slots (row 2). Swordsman row shown first — visual emphasis that swordsman is the primary defender.
- Each slot renders either: a unit icon (clickable) or an empty-slot placeholder.
- Unit icon shows type sprite and level badge.
- Click calls `game.execute({ type: 'ungarrison_unit', buildingId, unitId })`. Disabled with visual greying when `!canEject(unitId)`.
- En-route units (walking to tower) are NOT shown in the garrison section — they're not garrisoned yet.

## API Contracts

### Commands
| Command | Request | Returns | Description |
|---------|---------|---------|-------------|
| `garrison_units` | `{ buildingId, unitIds }` | `boolean` | Send units to garrison. False if none fit available slots. |
| `ungarrison_unit` | `{ buildingId, unitId }` | `boolean` | Eject unit. False if last unit or not garrisoned. |

### Events
| Event | Payload | Description |
|-------|---------|-------------|
| `garrison:unitEntered` | `{ buildingId, unitId }` | Unit hidden into garrison. |
| `garrison:unitExited` | `{ buildingId, unitId }` | Unit ejected, visible at door. |

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/tower-garrison/index.ts` | 6 | Public API barrel |
| `src/game/features/tower-garrison/types.ts` | 2 | GarrisonRole, BuildingGarrisonState, SerializedTowerGarrison |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | 2 | State container + Persistable |
| `src/game/features/tower-garrison/tower-garrison-auto-system.ts` | 4 | Empty-tower scan tick system |
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | 6 | FeatureDefinition wiring |
| `src/game/features/tower-garrison/internal/garrison-capacity.ts` | 1 | Slot config + explicit role map |
| `src/game/features/tower-garrison/internal/garrison-commands.ts` | 3 | garrison_units / ungarrison_unit handlers |
| `src/game/features/tower-garrison/internal/arrival-detector.ts` | 5 | movementStopped → finalizeGarrison |
| `src/composables/use-garrison.ts` | 7 | Vue composable for UI |

### Modified Files
| File | Change |
|------|--------|
| `src/game/commands/command-types.ts` | Add `GarrisonUnitsCommand`, `UngarrisonUnitCommand`, extend `Command` union |
| `src/game/event-bus.ts` | Add `garrison:unitEntered`, `garrison:unitExited` to `GameEvents` |
| `src/game/game-services.ts` | Register `TowerGarrisonFeature`; `unitReservation` is already exposed here |
| `src/game/commands/handlers/unit-handlers.ts` | Already guards via `unitReservation.isReserved()` — no changes needed for garrison |
| `src/components/selection-panel.vue` | Add garrison section for garrison buildings |
| `src/game/game-state-persistence.ts` | Add `SerializedTowerGarrison` to persistence shape |

## Verification

- Build a GuardTowerSmall with idle Swordsmen and Bowmen nearby → within 30 ticks, 1 soldier (preferring Swordsman) walks to it and disappears at the door. Tower shows 1 garrisoned unit. No second auto-dispatch happens.
- Select 5 soldiers (mix of Swordsman + Bowman), click GuardTowerBig → correct number walk (up to slot capacity per role), disappear, slots fill.
- Select tower → garrison section shows filled slots (swordsman row first) and empty placeholders. Slot count label matches.
- Clicking a filled slot when 2+ total garrisoned → unit reappears at door, slot empties.
- Clicking a filled slot when exactly 1 garrisoned → button is greyed/disabled, nothing happens.
- En-route units are not shown in the garrison panel (they haven't arrived yet).
- En-route garrison units cannot be move-commanded (`move_unit` returns false — blocked by `UnitReservationRegistry`).
- Remove a garrison building → all garrisoned and en-route units are released from reservation and reappear at the door tile.
- Kill a garrisoned unit externally → reservation released, garrison slot clears; if tower becomes empty, auto-garrison sends another.
- Save + reload → garrisoned units remain hidden; en-route units are re-reserved from `deserialize()` and continue walking to the tower normally.
