# MaterialTransfer — Unified Material Movement & Conservation

## Problem

Material movement is currently scattered across 4 systems with 15+ independent mutation points.
Moving material from building to carrier requires calling `withdrawReservedOutput()`, `setCarrying()`,
`carrierManager.startDelivery()`, and emitting an event — four separate calls, four places to forget one.

Consequences:
- Cancelling a transport job after pickup silently lost the carried material (recently fixed with a
  one-off `place_pile` in `interruptJob`). Every future cleanup path must remember the same workaround.
- No system verifies conservation. Material can vanish with no warning, assertion, or log.
- `entity.carrying` is set/cleared by 8 different callers with no central coordination.
- CarrierManager tracks a 4-state status machine (`Idle/Walking/PickingUp/Delivering`) that nothing
  reads for decisions — it mirrors state already in `activeJobs` and `runtime.job`.

## Solution

A single `MaterialTransfer` service with 4 methods that owns all cross-container material movement.
Eliminate `CarrierManager.status` (keep carrier registration/events). Make `setCarrying`/`clearCarrying`
internal to MaterialTransfer. Register a safety net on entity removal that drops carried material as a
free pile automatically.

## Architecture

```
                         MaterialTransfer
                        ┌───────────────────┐
                        │  produce()        │  ← resource gathering, production deposit
  Inventory ──withdraw──│  pickUp()         │──setCarrying──► Entity.carrying
  Slots      ─deposit───│  deliver()        │──clearCarrying─┘
                        │  drop()           │──place_pile──► Free Pile
                        │  onEntityRemoved()│  (safety net)
                        └───────────────────┘
                               │
                     uses (internally):
                     - BuildingInventoryManager (withdraw/deposit)
                     - GameState (entity lookup, position)
                     - executeCommand('place_pile') (free pile creation)
```

### What MaterialTransfer Does NOT Own

- **Reservations** — InventoryReservationManager still handles slot-level reservation bookkeeping.
  TransportJob.cancel() still releases reservations. MaterialTransfer only does the physical movement.
- **Request lifecycle** — RequestManager still tracks Pending/InProgress/Fulfilled.
- **Carrier registration** — CarrierManager still registers/removes carriers and emits
  `carrier:created`/`carrier:removed`. It loses status tracking.
- **Building-internal operations** — `consumeProductionInputs()`, `produceOutput()` stay on
  BuildingInventoryManager (no carrier involved, no transit).

---

## API

```typescript
class MaterialTransfer {
    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        executeCommand: (cmd: Command) => CommandResult,
        eventBus: EventBus,
    );

    /**
     * Material appears from nothing onto a carrier (resource gathering).
     * Sets entity.carrying. Emits 'material:produced'.
     */
    produce(carrierId: number, material: EMaterialType, amount: number): void;

    /**
     * Transfer material from a building inventory slot to a carrier.
     * Withdraws from inventory + sets entity.carrying atomically.
     * Returns amount picked up (0 = failed).
     *
     * @param reserved - true: use withdrawReservedOutput (carrier transport)
     *                   false: use withdrawInput (worker pickup)
     */
    pickUp(carrierId: number, fromBuilding: number, material: EMaterialType,
           amount: number, reserved: boolean): number;

    /**
     * Transfer material from a carrier to a building inventory slot.
     * Deposits into inventory + clears entity.carrying atomically.
     * Returns amount deposited.
     *
     * @param slotType - 'input': depositInput (carrier delivery)
     *                   'output': depositOutput (worker PUT_GOOD)
     */
    deliver(carrierId: number, toBuilding: number, slotType: 'input' | 'output'): number;

    /**
     * Drop whatever the carrier is holding as a free pile at its current position.
     * No-op if carrier isn't carrying anything.
     * Clears entity.carrying. Emits 'material:dropped'.
     */
    drop(carrierId: number): void;

    /**
     * Safety net for entity removal. If entity was carrying material, drops it
     * as a free pile. Registered at CLEANUP_PRIORITY.EARLY so it runs before
     * logistics cleanup.
     */
    onEntityRemoved(entityId: number): void;
}
```

Notes:
- `setCarrying()` and `clearCarrying()` become private to MaterialTransfer (or module-internal).
  No external code touches `entity.carrying` directly.
- `drop()` uses `executeCommand({ type: 'place_pile', ... })` internally — same mechanism as the
  existing bug fix, but centralized.
- `produce()` is for resource gathering and similar "material from nothing" paths.
  Production deposit (`produceOutput`) stays on BuildingInventoryManager since it doesn't involve
  a carrier — it's a building-internal slot operation.

---

## Behavior Changes

### 1. Carried material is never silently lost

`onEntityRemoved` is registered at `CLEANUP_PRIORITY.EARLY`. If any entity is removed while
`entity.carrying` is set, material is dropped as a free pile. This is a **structural guarantee** —
you cannot forget it in a cleanup path because the safety net is always registered.

### 2. `entity.carrying` becomes read-only to external code

External code can read `entity.carrying` (for rendering, UI, diagnostics) but only MaterialTransfer
writes it. The `setCarrying()`/`clearCarrying()` functions are no longer exported from `entity.ts`.

### 3. CarrierManager loses status tracking

`CarrierStatus` enum, `carrier:statusChanged` event, and all status transition methods
(`startTransport`, `startDelivery`, `startPickup`, `completeTransport`) are removed.
CarrierManager retains:
- `registerCarrier()` / `removeCarrier()` — carrier lifecycle
- `carrier:created` / `carrier:removed` events
- `hasCarrier()` / `getAllCarriers()` — carrier queries
- `canAssignJobTo()` — returns `!activeJobs.has(carrierId)` (moved to LogisticsDispatcher
  or takes activeJobs as parameter)

`hadActiveJob` on `carrier:removed` is derived from `activeJobs.has(carrierId)` in
LogisticsDispatcher instead of carrier status.

### 4. TransportJob loses pickup/complete, keeps cancel

`TransportJob.pickup()` and `TransportJob.complete()` are removed. Their inventory operations
move to `MaterialTransfer.pickUp()` and `MaterialTransfer.deliver()`. Their request/reservation
bookkeeping moves to the call sites in transport-executors.

TransportJob retains:
- `cancel()` — releases reservation + resets request to pending + emits `carrier:transportCancelled`
- All readonly fields (requestId, sourceBuilding, destBuilding, material, amount, carrierId)
- `status` — but simplified: `Active | Cancelled` (no more `PickedUp` or `Completed`;
  those states are now implicit in whether the carrier is carrying material)

Alternatively, TransportJob.cancel() could also move to a standalone function or to
LogisticsDispatcher, making TransportJob a pure data record. This is optional and can be
decided during implementation.

### 5. Dual cleanup path for carrier removal is eliminated

Currently, carrier removal triggers both:
- SettlerTaskSystem.interruptJob() -> transportJob.cancel()
- LogisticsDispatcher.handleCarrierRemoved() -> transportJob.cancel() (redundant no-op)

After migration: LogisticsDispatcher.handleCarrierRemoved() is removed. The
`carrier:transportCancelled` event (from interruptJob path) already cleans up `activeJobs`.
The `carrier:removed` subscription in LogisticsDispatcher can be removed entirely.

### 6. Overflow on delivery becomes a drop

Currently, `depositInput` overflow is logged but the overflow amount vanishes. With MaterialTransfer,
if `deliver()` deposits less than carried, the remainder is `drop()`-ed as a free pile. No material
is lost.

---

## Subsystems

| # | Subsystem | Responsibility | New/Modified Files |
|---|-----------|---------------|-------------------|
| 1 | MaterialTransfer service | Core service: produce, pickUp, deliver, drop, onEntityRemoved | `src/game/features/logistics/material-transfer.ts` (new) |
| 2 | Entity carrying lockdown | Make setCarrying/clearCarrying internal; export only read access | `src/game/entity.ts` |
| 3 | Transport executor migration | Replace manual withdraw+setCarrying with MaterialTransfer calls | `src/game/features/settler-tasks/internal/transport-executors.ts` |
| 4 | Inventory executor migration | Replace manual withdraw/deposit+setCarrying/clearCarrying | `src/game/features/settler-tasks/internal/inventory-executors.ts` |
| 5 | TransportJob simplification | Remove pickup()/complete(), keep cancel() | `src/game/features/logistics/transport-job.ts` |
| 6 | Worker interrupt migration | Replace manual drop logic with materialTransfer.drop() | `src/game/features/settler-tasks/worker-task-executor.ts` |
| 7 | CarrierManager status removal | Remove CarrierStatus enum, status transitions, statusChanged event | `src/game/features/carriers/carrier-manager.ts`, `carrier-state.ts` |
| 8 | LogisticsDispatcher cleanup | Remove handleCarrierRemoved, wire canAssignJobTo via activeJobs | `src/game/features/logistics/logistics-dispatcher.ts`, `carrier-assigner.ts` |
| 9 | Wiring & registration | Create MaterialTransfer in game-services, register onEntityRemoved | `src/game/game-services.ts` |
| 10 | ChoreoContext update | Add materialTransfer to ChoreoContext, remove carrierManager | `src/game/features/settler-tasks/choreo-types.ts` |
| 11 | Persistence update | Update save/restore to not rely on CarrierStatus | `src/game/game-state-persistence.ts` |
| 12 | Event cleanup | Remove carrier:statusChanged from event-bus, event-formatting | `src/game/event-bus.ts`, `src/game/event-formatting.ts` |
| 13 | Auto-recruit migration | Replace carrierManager.startTransport with activeJobs tracking | `src/game/features/auto-recruit/auto-recruit-system.ts` |
| 14 | Barracks migration | Replace carrierManager status usage | `src/game/features/barracks/barracks-training-manager.ts` |
| 15 | Tests | Update transport-job tests, add MaterialTransfer unit tests, update integration tests | `tests/unit/` |

---

## Migration Plan

### Phase 1: Introduce MaterialTransfer (subsystems 1, 9, 10)

**Can be done independently. No behavior changes yet — just adding the new service.**

Create `MaterialTransfer` class with all 4 methods. Wire it into `game-services.ts`.
Add it to `ChoreoContext`. Register `onEntityRemoved` at `CLEANUP_PRIORITY.EARLY`.

At this point, nothing calls MaterialTransfer yet — it exists alongside the old code.

Dependencies: none
Validates with: `pnpm lint`

### Phase 2: Migrate executors (subsystems 3, 4, 6) — PARALLELIZABLE

These three subsystems can be done in parallel. Each replaces direct inventory/carrying
calls with MaterialTransfer calls in a single file.

#### 2a: Transport executors (`transport-executors.ts`)

Replace in `executeTransportPickup`:
```
// OLD:
const withdrawn = transportJob.pickup();
setCarrying(settler, material, withdrawn);
ctx.carrierManager.startDelivery(settler.id);

// NEW:
const withdrawn = ctx.materialTransfer.pickUp(settler.id, sourceBuildingId, material, amount, true);
// TransportJob reservation bookkeeping (consumeReservationForRequest) called separately
// since MaterialTransfer doesn't own reservations.
transportJob.markPickedUp();   // or inline: reservationManager.consumeReservationForRequest(requestId)
```

Replace in `executeTransportDelivery`:
```
// OLD:
const deposited = transportJob.complete(amount);
clearCarrying(settler);

// NEW:
const deposited = ctx.materialTransfer.deliver(settler.id, destBuildingId, 'input');
// Request fulfillment called separately:
requestManager.fulfillRequest(requestId);
```

Remove `import { setCarrying, clearCarrying }` — no longer needed.

Dependencies: Phase 1
Validates with: `pnpm lint` + `pnpm test:unit`

#### 2b: Inventory executors (`inventory-executors.ts`)

Replace in `executeGetGood` (worker branch):
```
// OLD:
const withdrawn = ctx.inventoryManager.withdrawInput(buildingId, material, 1);
setCarrying(settler, material, 1);

// NEW:
const withdrawn = ctx.materialTransfer.pickUp(settler.id, buildingId, material, 1, false);
```

Replace in `depositWorkerGood`:
```
// OLD:
ctx.inventoryManager.depositOutput(buildingId, explicitMaterial, 1);
clearCarrying(settler);

// NEW:
ctx.materialTransfer.deliver(settler.id, buildingId, 'output');
```

Replace in `executeResourceGathering`:
```
// OLD:
setCarrying(settler, material, 1);

// NEW:
ctx.materialTransfer.produce(settler.id, material, 1);
```

Replace in `executeLoadGood`:
```
// OLD:
const withdrawn = ctx.inventoryManager.withdrawInput(buildingId, material, 1);
setCarrying(settler, material, 1);

// NEW:
const withdrawn = ctx.materialTransfer.pickUp(settler.id, buildingId, material, 1, false);
```

Remove `import { setCarrying, clearCarrying }`.

Dependencies: Phase 1
Validates with: `pnpm lint` + `pnpm test:unit`

#### 2c: Worker interrupt path (`worker-task-executor.ts`)

Replace in `interruptJob`:
```
// OLD:
if (job.transportData) {
    const transportJob = job.transportData.transportJob;
    transportJob.cancel();
    if (settler.carrying) {
        this.choreoContext.executeCommand({ type: 'place_pile', ... });
    }
}
if (settler.carrying) { clearCarrying(settler); }

// NEW:
if (job.transportData) {
    job.transportData.transportJob.cancel();
}
this.choreoContext.materialTransfer.drop(settler.id);
```

The `drop()` call replaces both the manual `place_pile` command AND `clearCarrying`.
It's a no-op if the carrier isn't carrying anything.

Dependencies: Phase 1
Validates with: `pnpm lint` + `pnpm test:unit`

### Phase 3: Simplify TransportJob (subsystem 5)

Remove `pickup()` and `complete()` from TransportJob. The reservation consumption
and request fulfillment that lived inside those methods moves to the call sites
in transport-executors (phase 2a already set this up).

TransportJob retains `cancel()` (reservation release + request reset).
Remove `TransportJobStatus.PickedUp` and `TransportJobStatus.Completed` — only
`Active` and `Cancelled` remain.

Update `TransportJob.create()` to no longer need `inventoryManager` in deps
(it was only used by pickup/complete).

Dependencies: Phase 2a
Validates with: `pnpm lint` + `pnpm test:unit`

### Phase 4: Remove CarrierManager status (subsystems 7, 8, 12, 13, 14) — PARALLELIZABLE

These can be done in parallel after phases 2 and 3.

#### 4a: CarrierManager simplification (`carrier-manager.ts`, `carrier-state.ts`)

Remove from CarrierState: `status` field.
Remove from CarrierManager: `setStatus()`, `startTransport()`, `startDelivery()`,
`startPickup()`, `completeTransport()`.

Change `canAssignJobTo()`: needs to check whether carrier has an active job. Two options:
- Accept `activeJobs: ReadonlyMap<number, unknown>` as parameter
- Move `canAssignJobTo` to LogisticsDispatcher (it already owns `activeJobs`)

Preferred: move to LogisticsDispatcher. CarrierManager becomes a pure registry.

Change `removeCarrier()`: `hadActiveJob` derived from caller (LogisticsDispatcher
passes it based on `activeJobs.has()`), or remove `hadActiveJob` from the event
if nothing reads it.

Remove `CarrierStatus` enum. Remove `carrier:statusChanged` event from event-bus.ts
and event-formatting.ts.

Dependencies: Phase 2 (no more status transition calls in executors)
Validates with: `pnpm lint`

#### 4b: LogisticsDispatcher cleanup (`logistics-dispatcher.ts`, `carrier-assigner.ts`)

Remove `handleCarrierRemoved()` — the `carrier:transportCancelled` event already
cleans up `activeJobs` (via the existing subscription at line 167).

Remove the `carrier:removed` subscription (line 171).

Move `canAssignJobTo` logic into `carrier-assigner.ts`:
```
// OLD:
if (!this.carrierManager.canAssignJobTo(carrier.entityId)) continue;

// NEW:
if (this.activeJobs.has(carrier.entityId)) continue;
```

This requires CarrierAssigner to receive `activeJobs` (read-only) or a
`isCarrierBusy(id)` callback. LogisticsDispatcher already owns activeJobs
and creates CarrierAssigner, so this is straightforward.

Remove `carrierManager.startTransport()` call in carrier-assigner — the carrier
is now "busy" simply by being in `activeJobs`.

Dependencies: Phase 2, Phase 4a
Validates with: `pnpm lint` + `pnpm test:unit`

#### 4c: Auto-recruit and barracks migration

In `auto-recruit-system.ts`: Replace `carrierManager.startTransport(carrierId)` with
whatever mechanism marks a carrier busy (add to an active set, or leave as-is if
auto-recruit uses its own tracking).

In `barracks-training-manager.ts`: Replace `carrierManager.canAssignJobTo()` — barracks
needs to know if a carrier is available. Either pass `activeJobs` or expose
`isCarrierBusy()` from LogisticsDispatcher.

In `auto-recruit-system.ts` and `barracks-training-manager.ts`: Replace
`carrierManager.getAllCarriers()` iteration with the CarrierManager registry
(still exists — only status was removed).

Dependencies: Phase 4a
Validates with: `pnpm lint` + `pnpm test:unit`

#### 4d: Persistence update (`game-state-persistence.ts`)

Remove serialization of `CarrierStatus`. On restore, carriers are created as
registered (no status to restore — they start idle). Active jobs are not persisted
across save/load anyway (carriers reset to idle on load).

Remove `carryingMaterial`/`carryingAmount` from carrier restore — `entity.carrying`
is restored from entity data directly.

Dependencies: Phase 4a
Validates with: `pnpm lint`

### Phase 5: Entity carrying lockdown (subsystem 2)

After all callers are migrated (phases 2-4), lock down `entity.carrying`:

- Remove `export` from `setCarrying()` and `clearCarrying()` in `entity.ts`.
- Re-export them only from `material-transfer.ts` (for MaterialTransfer's internal use).
- Or move them into MaterialTransfer as private methods.
- Keep `getCarryingState()` exported (read-only access).

If any caller was missed, this phase will produce compile errors — that's the point.

Dependencies: Phases 2, 3, 4
Validates with: `pnpm lint`

### Phase 6: Tests (subsystem 15) — PARALLELIZABLE with Phases 2-4

#### 6a: MaterialTransfer unit tests

Test produce/pickUp/deliver/drop with stub inventory and game state.
Test onEntityRemoved safety net (entity removed while carrying → free pile created).
Test drop is no-op when not carrying.
Test deliver overflow → remainder dropped as free pile.

#### 6b: Update transport-job tests

Remove tests for pickup()/complete() (methods removed).
Update cancel tests (simplified status: Active → Cancelled only).

#### 6c: Update integration tests

Existing carrier-inventory and transport integration tests should still pass
with no changes (behavior is preserved, only internal wiring changed).
Add a specific test: "carrier interrupted mid-delivery drops material as free pile".

---

## Parallelism Summary

```
Phase 1 (MaterialTransfer + wiring)
   │
   ├──► Phase 2a (transport-executors)
   ├──► Phase 2b (inventory-executors)
   ├──► Phase 2c (worker-interrupt)
   │       │
   │       ▼
   │    Phase 3 (TransportJob simplification)
   │       │
   ├──►────┤
   │       ▼
   │    Phase 4a (CarrierManager status removal)
   │       │
   │       ├──► Phase 4b (LogisticsDispatcher cleanup)
   │       ├──► Phase 4c (auto-recruit + barracks)
   │       └──► Phase 4d (persistence)
   │               │
   │               ▼
   └──►──────► Phase 5 (carrying lockdown)

Phase 6 (tests) can run alongside Phases 2-4.
```

Maximum parallelism: 3 workers in Phase 2, 3 workers in Phase 4.

---

## Events After Migration

### Removed
- `carrier:statusChanged` — nothing subscribes to it; status no longer tracked

### Unchanged
- `carrier:created` — still emitted by CarrierManager.registerCarrier()
- `carrier:removed` — still emitted by CarrierManager.removeCarrier()
- `carrier:transportCancelled` — still emitted by TransportJob.cancel()
- `carrier:pickupComplete` — still emitted by transport-executors
- `carrier:pickupFailed` — still emitted by transport-executors
- `carrier:deliveryComplete` — still emitted by transport-executors
- `pile:freePilePlaced` — emitted by place_pile command (used by drop())

### New (optional)
- `material:dropped` — emitted by MaterialTransfer.drop() when material is dropped as free pile.
  Useful for diagnostics/timeline. Payload: `{ entityId, material, amount, x, y, reason }`.
  Can be deferred — the `pile:freePilePlaced` event from the `place_pile` command already
  covers the logistics registration.

---

## Risk Assessment

**Low risk:**
- MaterialTransfer is additive in Phase 1 — no behavior changes until Phase 2.
- Each executor migration (Phase 2) is a single file with clear before/after.
- Safety net (onEntityRemoved) provides immediate value even before full migration.

**Medium risk:**
- CarrierManager status removal (Phase 4) touches multiple files. `canAssignJobTo` callers
  in auto-recruit and barracks need careful migration.
- Persistence format changes (Phase 4d) must handle both old and new save formats, or
  bump the save version.

**Mitigations:**
- Phase 4 subsystems are independent and can be merged one at a time.
- Each phase has a clear validation step (`pnpm lint` + `pnpm test:unit`).
- Phase 5 (lockdown) is the final gate — compile errors catch any missed callers.
