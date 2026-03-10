# Garrison as Worker Assignment

## Goal

Treat garrison dispatch identically to worker-to-workplace dispatch. A garrisoned soldier is a worker assigned to a tower — walks there, enters, stays inside.

## Flow

1. Garrison command calls `settlerTaskSystem.assignWorkerToBuilding(soldierId, towerId)` → sets `homeAssignment`, marks approaching
2. Builds `WORKER_DISPATCH` choreo: `choreo('WORKER_DISPATCH').goToDoorAndEnter(towerId).build()`
3. Assigns via `settlerTaskSystem.assignJob(soldierId, job)`
4. Soldier walks to tower door → `ENTER_BUILDING` executor fires → `locationManager.enterBuilding()`
5. Location manager emits new `settler-location:entered` event
6. Garrison manager listens → `finalizeGarrison()` (add to role slot, transition reservation to 'garrison')
7. `completeJob()` runs → unit is inside, `homeAssignment` exists → BUT we must NOT exit

## Key Problem: completeJob exits workers with homeAssignment

Current `completeJob` (worker-job-lifecycle.ts:161-167):
- If unit is inside AND has homeAssignment → exitBuilding (so worker can search for new work)
- If unit is inside AND no homeAssignment → stays inside (dispatch job placed them there)

For garrison: unit has homeAssignment (tower) but should NOT exit.

### Solution: Release homeAssignment on garrison finalization

When garrison manager finalizes (on `settler-location:entered`):
1. Add unit to garrison slots
2. Transition reservation to 'garrison'
3. Call `settlerTaskSystem.releaseWorkerAssignment(soldierId)` — clears homeAssignment + decrements occupant count
4. Now completeJob sees no homeAssignment → stays inside ✓

The garrison manager fully owns the garrisoned unit from this point. The settler task system no longer tracks it as a building worker.

## New Event: `settler-location:entered`

Added to `SettlerBuildingLocationManager.enterBuilding()`:
```typescript
this.ctx.eventBus.emit('settler-location:entered', { settlerId, buildingId });
```

## Changes

### settler-building-location-manager.ts
- Emit `settler-location:entered` in `enterBuilding()`

### event-bus.ts
- Add `settler-location:entered` event type

### tower-garrison-manager.ts
- Remove `markEnRoute()`, `cancelEnRoute()`
- Remove `tryFinalizeAtDoor()` (use assignWorkerToBuilding + WORKER_DISPATCH instead)
- Add `settler-location:entered` listener that checks if the entered building is a garrison tower → `finalizeGarrison()`
- `finalizeGarrison` simplified: just add to slots + transition reservation + emit event
- Constructor takes `releaseWorkerAssignment` callback
- `isEnRoute()` → check `locationManager.getApproaching()` against garrison buildings (same as before)
- `getEnRouteSlotCounts()` → unchanged (already uses locationManager)

### settler-task-system.ts
- Add `releaseWorkerAssignment(settlerId)` public method — clears homeAssignment, decrements occupant count, but does NOT exit building or cancel approach

### garrison-commands.ts
- Replace `manager.markEnRoute()` with `settlerTaskSystem.assignWorkerToBuilding()`
- Replace `GARRISON_DISPATCH` choreo with `WORKER_DISPATCH` + `goToDoorAndEnter()`
- Remove `manager.cancelEnRoute()` fallback
- Remove `manager.tryFinalizeAtDoor()` special case — just always assign job (if already at door, choreo completes instantly)

### tower-garrison-feature.ts
- Remove ENTER_GARRISON executor registration
- Remove `settler:taskFailed` listener for GARRISON_DISPATCH
- `onTerrainReady`: re-build `WORKER_DISPATCH` (not GARRISON_DISPATCH) jobs for approaching units
- Pass `releaseWorkerAssignment` callback to garrison manager

### dispatch-executors.ts
- Remove `createEnterGarrisonExecutor`

### choreo-builder.ts
- Remove `goToDoorAndGarrison()` method
- Remove `enterGarrison()` method

### choreo types.ts
- Remove `ENTER_GARRISON` from ChoreoTaskType enum

### event-formatting.ts (debug)
- Update any references to GARRISON_DISPATCH / ENTER_GARRISON

## Invariants

- Slot availability still accounts for approaching + garrisoned (via locationManager.getApproaching)
- Reservation transitions: 'garrison-en-route' (on assignWorkerToBuilding?) → 'garrison' (on finalizeGarrison)
  - Actually: assignWorkerToBuilding doesn't reserve. Garrison command must reserve BEFORE calling assignWorkerToBuilding.
  - OR: use the existing reservation in markEnRoute... but we're removing that.
  - New approach: garrison command reserves unit, then calls assignWorkerToBuilding, then assigns job.
- Building destroyed: `settler-location:approachInterrupted` still fires → garrison manager releases reservation (existing listener)
- Entity killed: `onForcedRelease` on reservation cleans up slots (existing)
- Save/load: approaching state persisted by location manager, garrison state by garrison manager. onTerrainReady rebuilds jobs.

## What This Eliminates

- `ENTER_GARRISON` task type and executor
- `goToDoorAndGarrison()` / `enterGarrison()` builder methods
- `markEnRoute()` / `cancelEnRoute()` on TowerGarrisonManager
- `tryFinalizeAtDoor()` on TowerGarrisonManager
- The `settler:taskFailed` cleanup listener for GARRISON_DISPATCH
- GARRISON_DISPATCH as a distinct job ID (now just WORKER_DISPATCH)
- `arrival-detector.ts` (already deleted)
