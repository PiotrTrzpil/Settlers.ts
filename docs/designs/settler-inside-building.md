# Settler Inside Building — Design

## Overview

Unify all "settler is committed to a building" state into a single `SettlerBuildingLocationManager`. This covers two related states: **approaching** (settler is walking toward a building with intent to enter) and **inside** (settler is confirmed inside, hidden). Currently, tower garrison and worker-in-building manage both states independently with incompatible approaches. This refactor creates a single source of truth for which settlers are committed to buildings, how `entity.hidden` is set, how building-destroyed-mid-approach is handled, and how state is cleaned up and persisted.

**Scope boundary**: This covers settlers that will *enter* buildings (garrison, workers waiting in huts). It does NOT cover carriers or logistics tasks that approach buildings to deliver/pick up goods — those interactions are transient and do not result in entry or hiding.

---

## Current State

### What exists today

**Tower garrison** (`src/game/features/tower-garrison/`):
- `TowerGarrisonManager` tracks `garrisons: Map<buildingId, BuildingGarrisonState>` with role-based slots
- `enRoute: Map<unitId, towerId>` tracks units walking to the tower
- Uses `UnitReservationRegistry` to reserve units both en-route and while garrisoned
- Sets `unit.hidden = true` in `finalizeGarrison()` and `unit.hidden = false` in `ejectUnit()`
- On building removal: ejects all occupants (visible + placed at door), clears reservations
- Serializes slot arrays + enRoute map; re-derives `hidden` from slot membership on load

**Worker in building** (`src/game/features/settler-tasks/settler-task-system.ts`, `work-handlers.ts`):
- `buildingOccupants: Map<buildingId, number>` tracks occupancy count only
- Per-unit: `runtime.homeAssignment: { buildingId, hasVisited }` is the assignment
- Sets `settler.hidden = true` inside `returnHomeAndWait()` only when settler is idle/waiting
- Does NOT use `UnitReservationRegistry` (no reservation)
- On building removal: clears `homeAssignment`, interrupts job, cancels movement — but `entity.hidden` may remain stale if settler was waiting hidden at time of destruction
- Serializes `homeAssignment` + job state; `hidden` is transient (re-derived from job state, imperfectly)

### What's wrong

1. **Stale hidden state**: Worker destruction path clears `homeAssignment` and interrupts job but does not unconditionally call `settler.hidden = false`. If the settler was hidden at destroy-time, it stays invisible.
2. **Fragmented `entity.hidden` ownership**: Both systems set `entity.hidden` directly, with no coordination. Adding a third system (e.g., barracks) repeats the pattern again.
3. **No unified approaching state**: Garrison has `enRoute: Map<unitId, towerId>` (with reservation). Workers have no equivalent — if a building is destroyed while a worker is walking to it for their first visit, the worker continues walking to a non-existent destination and only recovers when the job is interrupted. No consistent "approaching" + "building-destroyed-mid-walk" handling.
4. **Inconsistent persistence**: Garrison serializes occupancy explicitly. Workers serialize assignment and re-derive hidden imperfectly on load. Approaching-state (enRoute) is persisted in garrison but has no equivalent for workers.
5. **No shared query API**: Nothing provides "which building is settler X committed to?" or "who is approaching/inside building Y?"

### What stays vs what changes

**Preserved behaviors:**
- Tower garrison slot/capacity model (role-based slots, max capacity) stays in `TowerGarrisonManager`
- Worker job choreography, home assignment, and occupancy counting stay in `SettlerTaskSystem`
- `UnitReservationRegistry` usage for en-route garrison state stays in `TowerGarrisonManager`
- The `entity.hidden` flag itself is unchanged

**Intentionally changing:**
- `entity.hidden` is no longer set directly by garrison or settler-task code — they call `locationManager.enterBuilding()` / `exitBuilding()` instead
- Building-destruction cleanup for both inside and approaching settlers is centralised in `SettlerBuildingLocationManager` — the manager emits `settler-location:approachInterrupted` when a building is destroyed mid-approach, and features subscribe to handle cancellation
- Garrison's `enRoute` map is replaced by `locationManager.markApproaching()` — the manager owns the state, garrison owns the UnitReservationRegistry side
- Workers register their first-visit walk via `markApproaching()` so building destruction triggers cancellation cleanly
- Persistence of both approaching and inside state moves to `SettlerBuildingLocationManager`

**Not in scope:**
- Carrier logistics tasks approaching buildings to pick up/deliver — these are logistics concerns, not entry intent; they already handle building removal via transport job cancellation
- Barracks training — no "settler inside" hiding currently; can integrate later
- Slot/capacity enforcement — stays per-feature

---

## Summary for Review

- **Interpretation**: Create a `SettlerBuildingLocationManager` that owns two related states: "settler is approaching building X with intent to enter" and "settler is confirmed inside building X". It is the single owner of `entity.hidden` transitions and emits events so features can react to building-destroyed-mid-approach. Garrison, workers, and future systems call this manager rather than managing these states themselves.

- **Assumptions**: Carriers that approach buildings to deliver/pick up are explicitly excluded — they don't enter buildings and their movement cancellation is already handled by transport job cancellation in logistics. "Approaching" means committed intent to enter (garrison walking to tower, worker walking to workplace for first visit). Worker's routine work choreography (GET_GOOD at work position, etc.) is NOT approaching — that is active work, not entry.

- **Architecture**: New `settler-location` feature with a single manager. `tower-garrison` and `settler-tasks` declare it as a dependency. The manager tracks `settler → { buildingId, status: 'approaching' | 'inside' }`. On building removal it: (a) unhides all inside settlers, (b) emits `settler-location:approachInterrupted` for approaching settlers so features cancel movement. It is `Persistable`. The garrison's `enRoute` map is eliminated in favour of `markApproaching()`.

- **Contracts & boundaries**: Manager owns location state and `entity.hidden`. Features own: slot counts (garrison), job choreography (worker tasks), unit reservations (garrison). The `approachInterrupted` event carries `{ settlerId, buildingId }` — features identify whether the settler is theirs via their own data structures (garrison via `UnitReservationRegistry`, settler-tasks via `runtimes` map).

- **Scope**: Covers approaching-to-enter and confirmed-inside states. Carriers, barracks training, and slot/capacity enforcement are excluded.

---

## Project Conventions (extracted)

### Code Style
- Feature modules live in `src/game/features/<name>/` with a barrel `index.ts`; internal files go in `internal/`
- Managers are named `*Manager`, are stateful, and have no `tick()`. Systems are named `*System` and implement `TickSystem`.
- Events follow `domain:past-tense` pattern (e.g., `settler:enteredBuilding`)
- Config objects for ≥3 injected dependencies; no positional constructors

### Error Handling
- **Optimistic**: Trust internal data. If `enterBuilding` is called for a settler already inside, throw — it violates the contract.
- Use `getEntityOrThrow(id, 'context')` for lookups in data we control; plain `getEntity(id)` at cleanup paths (entity may already be gone)
- Cleanup handlers (entity removed, building removed) are the only defensive paths; everything else throws

### Type Philosophy
- `purpose` is a string enum not a bare string — future features add new purposes without changing the manager
- `SettlerBuildingLocation` is a required-field interface, never partial
- `hidden` stays on `Entity` (it is the rendering signal); the manager drives it, does not duplicate it

### Representative Pattern

```typescript
// From src/game/features/tower-garrison/tower-garrison-manager.ts
// Shows: Persistable manager, cleanup-registry integration, event-driven lifecycle

export class TowerGarrisonManager implements Persistable<SerializedTowerGarrison> {
    readonly persistKey = 'tower-garrison';
    private garrisons = new Map<number, BuildingGarrisonState>();

    constructor(private ctx: FeatureContext) {
        ctx.cleanupRegistry.onEntityRemoved(id => this.onEntityRemoved(id), CLEANUP_PRIORITY.DEFAULT);
        ctx.on('building:removed', ({ buildingId }) => this.removeTower(buildingId));
    }

    finalizeGarrison(unitId: number, buildingId: number): void {
        const garrison = this.garrisons.get(buildingId)!;
        // ... add to slots ...
        const entity = this.ctx.gameState.getEntityOrThrow(unitId, 'garrison finalize');
        entity.hidden = true;           // <-- this is what moves to SettlerBuildingLocationManager
        this.ctx.eventBus.emit('garrison:unitEntered', { buildingId, unitId });
    }

    serialize(): SerializedTowerGarrison { /* ... */ }
    deserialize(data: SerializedTowerGarrison): void { /* ... */ }
}
```

---

## Architecture

### Data Flow

```
Feature code                      SettlerBuildingLocationManager          Entity / EventBus
  │                                          │                                    │
  ├─ markApproaching(id, bId, purpose) ────► │ map.set(id, {bId, Approaching})    │
  │  (visible, walking)                      │ (no hidden change)                 │
  │                                          │                                    │
  ├─ enterBuilding(id, bId, purpose) ──────► │ map → status = Inside              │
  │  (arrives at door)                       ├─ entity.hidden = true ────────────►│
  │                                          │                                    │
  ├─ exitBuilding(id) ──────────────────────►│ map.delete(id)                     │
  │                                          ├─ entity.hidden = false ───────────►│
  │                                          │                                    │
  ├─ cancelApproach(id) ────────────────────►│ map.delete(id) (Approaching only)  │
  │                                          │                                    │
  │   building:removed event                 │                                    │
  ├─────────────────────────────────────────►│ for Inside occupants:              │
  │   (garrison clears slots)                │   entity.hidden = false ──────────►│
  │   (settler-tasks clears job)             │   map.delete()                     │
  │                                          │ for Approaching settlers:          │
  │                                          ├─ emit approachInterrupted ────────►│ EventBus
  │                                          │   map.delete()                     │
  │   ◄── approachInterrupted subscription   │                                    │
  ├─ garrison: release reservation           │                                    │
  ├─ worker: cancel job, clear movement      │                                    │
  │                                          │                                    │
  │   entity:removed cleanup                 │                                    │
  ├─────────────────────────────────────────►│ map.delete(id) (no unhide needed)  │
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Types & Contracts | Shared enums, interfaces, event types | — | `features/settler-location/types.ts` |
| 2 | SettlerBuildingLocationManager | Core state, `entity.hidden` transitions, building-removed and entity-removed cleanup, persistence | 1, GameState, EventBus, CleanupRegistry | `features/settler-location/settler-building-location-manager.ts` |
| 3 | Feature registration | Wires feature into game-services, exports manager | 2 | `features/settler-location/index.ts`, `game-services.ts` |
| 4 | Tower garrison integration | Replace `enRoute` map + direct `entity.hidden` with location manager calls; subscribe to `approachInterrupted` | 2 | `features/tower-garrison/tower-garrison-manager.ts` |
| 5 | Settler tasks integration | Register worker approach via `markApproaching`; replace `settler.hidden` with `enterBuilding`/`exitBuilding`; subscribe to `approachInterrupted` | 2 | `features/settler-tasks/settler-task-system.ts`, `work-handlers.ts` |

---

## Shared Contracts (as code)

```typescript
// features/settler-location/types.ts

/** Whether the settler is walking to the building or already inside */
export enum SettlerBuildingStatus {
    /** Settler is walking toward the building with intent to enter */
    Approaching = 'approaching',
    /** Settler is confirmed inside the building (entity.hidden = true) */
    Inside = 'inside',
}

/** A settler's building commitment */
export interface SettlerBuildingLocation {
    readonly buildingId: number;
    readonly status: SettlerBuildingStatus;
}

/** Event emitted when a building is destroyed while settlers are approaching it */
export interface ApproachInterruptedEvent {
    readonly settlerId: number;
    readonly buildingId: number;
}

/** What SettlerBuildingLocationManager exposes to other features */
export interface ISettlerBuildingLocationManager {
    /**
     * Register settler as walking toward a building with intent to enter.
     * Settler remains visible. Throws if settler is already tracked.
     */
    markApproaching(settlerId: number, buildingId: number): void;

    /**
     * Cancel an approaching registration (e.g., settler was redirected).
     * No-op if settler is not tracked as approaching.
     */
    cancelApproach(settlerId: number): void;

    /**
     * Confirm settler is now inside the building.
     * Sets entity.hidden = true.
     * If settler was registered as Approaching this building, transitions to Inside.
     * Also accepts direct entry (no prior markApproaching).
     * Throws if settler is already Inside, or if Approaching a different building.
     */
    enterBuilding(settlerId: number, buildingId: number): void;

    /**
     * Mark settler as exiting the building.
     * Sets entity.hidden = false. Throws if settler is not tracked as Inside.
     */
    exitBuilding(settlerId: number): void;

    /** Returns current location (approaching or inside), or null if settler is not tracked */
    getLocation(settlerId: number): SettlerBuildingLocation | null;

    /** Returns true if settler is confirmed inside a building (hidden) */
    isInside(settlerId: number): boolean;

    /** Returns true if settler is tracked (approaching or inside) */
    isCommitted(settlerId: number): boolean;

    /** Returns all settler IDs currently inside the given building */
    getOccupants(buildingId: number): readonly number[];

    /** Returns all settler IDs approaching the given building */
    getApproaching(buildingId: number): readonly number[];
}

// Persistence shape — both approaching and inside are persisted
export interface SerializedSettlerLocations {
    entries: Array<{ settlerId: number; buildingId: number; status: SettlerBuildingStatus }>;
}

export interface SettlerLocationExports {
    locationManager: ISettlerBuildingLocationManager;
}
```

### Event Bus additions

| Event | Payload | Description |
|-------|---------|-------------|
| `settler-location:approachInterrupted` | `ApproachInterruptedEvent` | Emitted when a building is destroyed while a settler is approaching it. Features identify whether the settler is theirs via their own data structures, then cancel movement and release reservations. |

---

## Subsystem Details

### Subsystem 1: Types & Contracts
**File**: `src/game/features/settler-location/types.ts`
**Owns**: All shared types for the feature
**Key decisions**:
- No `purpose` field — the manager doesn't use it for any behavior, and features identify their own settlers via their own data structures (garrison via `UnitReservationRegistry`, settler-tasks via `runtimes` map)
- `getOccupants` / `getApproaching` return `readonly number[]` — callers cannot mutate the internal array; computed on-demand (O(n), called rarely)

---

### Subsystem 2: SettlerBuildingLocationManager
**File**: `src/game/features/settler-location/settler-building-location-manager.ts`
**Owns**: Core `insideMap`, `entity.hidden` transitions, cleanup subscriptions, persistence
**Depends on**: GameState, EventBus, EntityCleanupRegistry

**Constructor**: receives `FeatureContext`; subscribes to:
- `building:removed` event → calls `onBuildingRemoved(buildingId)`
- `cleanupRegistry.onEntityRemoved(id => this.onEntityRemoved(id), CLEANUP_PRIORITY.DEFAULT)`

**Internal map**: `locationMap: Map<number, SettlerBuildingLocation>` — single map for both approaching and inside states.

**`markApproaching(settlerId, buildingId)`**:
- Throws if `locationMap.has(settlerId)` — already committed to a building
- Sets `locationMap.set(settlerId, { buildingId, status: Approaching })`
- Does NOT touch `entity.hidden`

**`cancelApproach(settlerId)`**:
- No-op if settler not in map (idempotent — callers may cancel defensively)
- Throws if settler is Inside (cannot cancel an Inside entry, must call `exitBuilding`)
- Deletes from `locationMap`

**`enterBuilding(settlerId, buildingId)`**:
- If settler has an existing Approaching entry: validates it matches `buildingId`, then upgrades status to Inside
- If settler has no entry: registers directly as Inside (allows entry without prior `markApproaching`)
- Throws if settler is already Inside, or if Approaching a different building
- Gets entity via `gameState.getEntityOrThrow(settlerId, 'SettlerBuildingLocationManager.enterBuilding')`
- Sets `entity.hidden = true`

**`exitBuilding(settlerId)`**:
- Throws if settler is not Inside
- Deletes from `locationMap`
- Gets entity via `gameState.getEntityOrThrow(settlerId, 'SettlerBuildingLocationManager.exitBuilding')`
- Sets `entity.hidden = false`

**`onBuildingRemoved(buildingId)`**:
- Iterates `locationMap`, collects all entries for `buildingId` (both Approaching and Inside)
- For Inside entries: gets entity (use `getEntity` not `getEntityOrThrow` — entity may be mid-removal), sets `entity.hidden = false` if entity exists, deletes from map
- For Approaching entries: deletes from map, emits `settler-location:approachInterrupted` per settler
- Emitting happens AFTER unhiding Inside settlers so features that subscribe see a consistent state

**`onEntityRemoved(entityId)`**:
- Deletes from `locationMap` regardless of status (entity is being removed; no unhide needed)

**Persistence** (implements `Persistable<SerializedSettlerLocations>`):
- `persistKey = 'settler-building-locations'`
- `serialize()`: returns `{ entries: [...locationMap] }` (both Approaching and Inside)
- `deserialize(data)`: for each entry:
  - `locationMap.set(settlerId, { buildingId, purpose, status })`
  - If `status === Inside`: `gameState.getEntityOrThrow(settlerId, 'settler-location restore').hidden = true`
  - If `status === Approaching`: entity stays visible; feature will re-issue movement on its own `onTerrainReady` (same pattern garrison uses today)
- Runs after entity restoration via persistence registry ordering

---

### Subsystem 3: Feature Registration
**Files**: `src/game/features/settler-location/index.ts`, `src/game/game-services.ts`

**`index.ts`** exports:
```typescript
export const SettlerLocationFeature: FeatureDefinition = {
    id: 'settler-location',
    dependencies: [],  // No feature dependencies; only core services
    create(ctx: FeatureContext): FeatureInstance<SettlerLocationExports> {
        const locationManager = new SettlerBuildingLocationManager(ctx);
        return {
            exports: { locationManager } satisfies SettlerLocationExports,
            persistence: [locationManager],
        };
    },
};
```

**`game-services.ts`** changes:
- Add `SettlerLocationFeature` to `loadAll([...])` array, before `tower-garrison` and `settler-tasks`
- Extract: `this.locationManager = this.feat<SettlerLocationExports>('settler-location').locationManager`
- Pass `locationManager` in `FeatureContext` (or via `getFeature`) to garrison and settler-tasks

---

### Subsystem 4: Tower Garrison Integration
**File**: `src/game/features/tower-garrison/tower-garrison-manager.ts`
**Owns**: Garrison slots, `UnitReservationRegistry` usage, placement at approach tile
**Depends on**: `SettlerBuildingLocationManager`

**Changes**:
- **Eliminate `enRoute` map entirely** — replaced by `locationManager.markApproaching()`
- In `markEnRoute(unitId, towerId)`: call `unitReservation.reserve(unitId, ...)` (keep) AND `locationManager.markApproaching(unitId, towerId)` (new, replaces `enRoute.set`)
- In `finalizeGarrison(unitId, buildingId)`: replace `entity.hidden = true` with `locationManager.enterBuilding(unitId, buildingId)` (location manager transitions Approaching → Inside internally)
- In `ejectUnit(unitId, ...)`: replace `entity.hidden = false` with `locationManager.exitBuilding(unitId)`. Keep: `unitReservation.release(unitId)`, `placeAtApproach()`, `garrison:unitExited` event
- Subscribe to `settler-location:approachInterrupted`: check `unitReservation.isReserved(settlerId)` to identify garrison settlers; release reservation, cancel movement for those
- In `removeTower(buildingId)`: remove `entity.hidden = false` lines (location manager handles Inside); remove en-route loop (location manager emits `approachInterrupted` for those). Keep: slot cleanup, `unitReservation.release()` for garrisoned units, `placeAtApproach()` for garrisoned units.

**Handler ordering**: Location manager's `building:removed` handler fires first (registered earlier), unhiding Inside units. Garrison's handler fires second, places ejected units at the approach tile. This is the correct order.

---

### Subsystem 5: Settler Tasks Integration
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/work-handlers.ts`
**Owns**: Job choreography, home assignment, occupancy counting
**Depends on**: `SettlerBuildingLocationManager`

**`claimBuilding(runtime, buildingId)` (first assignment)**:
- After claiming, call `locationManager.markApproaching(settler.id, buildingId)` to register the walk intent
- `hasVisited = false` remains the feature-level "not yet arrived" flag

**When settler arrives at building door (first visit)**:
- Call `locationManager.enterBuilding(settler.id, buildingId)` — settler is now Inside and hidden
- Set `hasVisited = true`
- Worker is hidden until work is available

**When worker starts active work (leaves building to work)**:
- Call `locationManager.exitBuilding(settler.id)` — settler becomes visible and moves freely
- Currently: `settler.hidden = false` in job-start paths — this is replaced by `exitBuilding`

**`returnHomeAndWait()` (worker returns after job, no more work available)**:
- Currently: `if (dist <= 1) { settler.hidden = true; ... return; }`
- After: `if (dist <= 1) { locationManager.enterBuilding(settler.id, homeAssignment.buildingId); ... return; }`
- Worker is not Inside at this point (they exited when starting the previous job), so no double-enter guard needed

**`onBuildingRemoved(buildingId)` in SettlerTaskSystem**:
- Continues: clearing `homeAssignment`, interrupting jobs, cancelling movement
- Remove: any `entity.hidden = false` lines (location manager handles visibility)
- Subscribe to `settler-location:approachInterrupted`: check `runtimes.has(settlerId)` to identify worker settlers; clear `homeAssignment`, cancel job, clear movement

**`releaseBuilding(runtime)` (voluntary reassignment)**:
- If `locationManager.isInside(settler.id)`: call `locationManager.exitBuilding(settler.id)` first
- If `locationManager.isCommitted(settler.id)` (still approaching): call `locationManager.cancelApproach(settler.id)`
- Both cases leave the settler visible and ready for reassignment

**Occupancy counting** (`buildingOccupants` map): unchanged. It tracks capacity/assignment count; the location manager tracks actual location state. They serve different purposes.

---

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/settler-location/types.ts` | 1 | Shared types, enums, interfaces |
| `src/game/features/settler-location/settler-building-location-manager.ts` | 2 | Core manager, cleanup, persistence |
| `src/game/features/settler-location/index.ts` | 3 | Feature definition, barrel export |

### Modified Files
| File | Change |
|------|--------|
| `src/game/game-services.ts` | Register `SettlerLocationFeature`, extract `locationManager`, thread into dependent features |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | Replace `entity.hidden` direct writes with `locationManager.enterBuilding/exitBuilding` |
| `src/game/features/settler-tasks/settler-task-system.ts` | Replace `settler.hidden` direct writes, route through location manager |
| `src/game/features/settler-tasks/work-handlers.ts` | Same — locate all direct `hidden` assignments and replace |

### Files to Audit (may also have direct `hidden` writes)
| File | What to check |
|------|--------------|
| `src/game/features/barracks/barracks-training-manager.ts` | Does training hide the trainee? If so, add `SettlerBuildingPurpose.Training` and integrate |
| `src/game/features/building-construction/` | Does builder enter building and hide? |

---

## Verification

### Garrison
- Garrison a unit into a tower → unit becomes hidden on arrival ✓
- Save game while unit is garrisoned, reload → unit still hidden ✓
- Destroy tower while unit is garrisoned → unit becomes visible at door ✓
- Issue garrison command, destroy tower while unit is walking there → unit continues normally (not stuck walking to destroyed building; `approachInterrupted` event cancels movement) ✓
- Save game while unit is walking to tower, reload → unit re-issues movement toward tower ✓

### Workers
- Place a woodcutter hut, assign worker → worker walks to hut → hides on arrival → becomes visible when work starts → hides again when waiting ✓
- Worker's hut is demolished while worker is inside (hidden) → worker reappears immediately ✓
- Worker's hut is demolished while worker is actively working (visible, outside) → worker's job is interrupted cleanly ✓
- Worker's hut is demolished while worker is walking there (first visit) → worker becomes free immediately ✓
- Save game with worker waiting in hut (hidden) → reload, worker still hidden ✓
- Save game with worker actively working (visible) → reload, worker is visible ✓

### Manager contract
- `locationManager.getOccupants(buildingId)` returns correct settler IDs (Inside only) ✓
- `locationManager.getApproaching(buildingId)` returns correct settler IDs (Approaching only) ✓
- `enterBuilding` twice for same settler throws ✓
- `exitBuilding` for settler not Inside throws ✓
- `cancelApproach` for settler not Approaching is no-op ✓
