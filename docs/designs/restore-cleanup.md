# Restore Path Cleanup — Design

## Overview

Clean up persistence/restore code after the entity-job-id feature. Fix stale comments, remove sentinel hacks, consolidate duplicated building scans, and add missing validation. This is purely cleanup — no behavioral changes.

## Problems

1. **4 features do identical full-entity scans** filtering for completed buildings in `onRestoreComplete` (tower-garrison, barracks, building-demand, victory-conditions). Each iterates `ctx.gameState.entities`, skips non-buildings and construction sites. This is O(4N) where N = entity count.

2. **`rebuildFromEntities` uses fake values** in reconstructed `TransportJobRecord`: `demandId: 0` (sentinel) and `sourceBuilding: destBuilding` (stand-in). These exist because the record interface requires them, but they're meaningless for delivery-only jobs.

3. **Stale comment** in `settler-task-persistence.ts` says synthetic jobs are "handled by LogisticsDispatcherFeature persistence" — but logistics persistence no longer exists (transport jobs are transient now).

4. **No `nextJobId` validation** on restore — if the counter is somehow less than max `entity.jobId`, IDs will collide.

5. **Garrison restore ignores `entity.jobId`** — uses `entity.hidden` + location manager status instead. Should use `entity.jobId` as the primary signal since that's the whole point of the feature.

## Conventions

- Optimistic programming: trust contracts, fail loudly, no silent fallbacks
- File max 600 lines TS, function max 250 lines (aim ≤80)
- Features own their state — but shared infrastructure can live in feature-registry or game-state

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Building restore event | Emit `building:restored` from game-state-persistence for completed buildings, replace 4 feature scans | `src/game/state/game-state-persistence.ts`, `src/game/features/tower-garrison/tower-garrison-feature.ts`, `src/game/features/barracks/barracks-feature.ts`, `src/game/features/building-demand/building-demand-feature.ts`, `src/game/features/victory-conditions/victory-conditions-feature.ts`, `src/game/event-types-features.ts` |
| 2 | Transport record cleanup | Make `sourceBuilding` and `demandId` optional on TransportJobRecord for reconstruction | `src/game/features/logistics/transport-job-record.ts`, `src/game/features/logistics/logistics-dispatcher.ts` |
| 3 | Stale comments & validation | Fix stale synthetic comment, add nextJobId validation | `src/game/features/settler-tasks/settler-task-persistence.ts`, `src/game/state/game-state-persistence.ts` |

## Subsystem Details

### 1. Building restore event

Instead of 4 features each scanning all entities, emit a `building:restored` event per completed building from `restoreEntities()` (which already iterates entities). Each feature replaces its `onRestoreComplete` scan with an event listener.

**In `game-state-persistence.ts` `restoreEntities()`:**
After all entities are recreated (line 353), do a second pass over building entities:
```typescript
for (const e of snapshot.entities) {
    if (e.type === EntityType.Building && !constructionSiteIds.has(e.id)) {
        eventBus.emit('building:restored', { buildingId: e.id, buildingType: e.subType, race: e.race, player: e.player });
    }
}
```

**Event type** — add to `event-types-features.ts`:
```typescript
'building:restored': GameEventBase & { buildingId: number; buildingType: BuildingType; race: Race; player: number };
```

**Each feature** replaces its `onRestoreComplete` building scan with a listener registered during `create()`:
- **tower-garrison**: `eventBus.on('building:restored', ...)` → `if (isGarrisonBuildingType(bt)) manager.initTower(id, bt)`
- **barracks**: `eventBus.on('building:restored', ...)` → `if (bt === BuildingType.Barrack) barracksTrainingManager.initBarracks(id, race)`
- **building-demand**: `eventBus.on('building:restored', ...)` → `if (!BUILDING_SPAWN_ON_COMPLETE[bt]) buildingDemandSystem.addDemandFromBuilding(id, bt, race)`
- **victory-conditions**: `eventBus.on('building:restored', ...)` → `victorySystem.onBuildingCompleted(bt, player)`

Wait — there's a problem. These event listeners need to ONLY fire during restore, not during normal gameplay. The `building:completed` event already fires during normal gameplay. Using `building:restored` as a separate event means features subscribe in `create()` but only get events during restore.

Actually this is fine — `building:restored` only fires from `restoreEntities()`, which only runs during save/load. It's a restore-specific event.

But: features register the listener in `create()`, which runs both on fresh game and on restore. On fresh game, `restoreEntities()` never fires, so the listener is dormant. That's correct.

**Key consideration:** `onRestoreComplete` runs AFTER `restoreEntities` (and after `deserializeAll`). If we emit `building:restored` from `restoreEntities()`, the listeners must be registered before that point. Feature `create()` runs before any restore, so listeners ARE registered in time.

But wait — the restore sequence is: clear state → restore entities → restore terrain → deserialize features → rebuild indices → notify restore complete. The event listeners are set up in `create()` which runs when features are first loaded (before any restore). So listeners exist when `restoreEntities` fires. Good.

However, there's a subtlety: some features need other state to be deserialized first (e.g., `constructionSiteManager.hasSite()` needs construction data). But `restoreEntities` runs BEFORE `deserializeAll`. So at the time `building:restored` fires, construction sites haven't been deserialized yet.

This means we can't use the `constructionSiteManager.hasSite()` check in the listener — construction data isn't available yet. We'd need to pass the `constructionSiteIds` set from the snapshot.

Actually, the simpler approach: DON'T emit during `restoreEntities()`. Instead, add a utility function that features call in their `onRestoreComplete` — a shared helper that returns the completed buildings list. Or just use the existing `building:completed` event pattern.

Let me rethink. The simplest consolidation:

**Option A: Shared helper in game-state or feature-registry**
```typescript
// In feature-registry.ts or a restore-utils.ts
function forEachCompletedBuilding(gameState: GameState, constructionSiteManager: ConstructionSiteManager, callback: (entity: Entity) => void): void {
    for (const e of gameState.entities) {
        if (e.type !== EntityType.Building) continue;
        if (constructionSiteManager.hasSite(e.id)) continue;
        callback(e);
    }
}
```
Each feature calls this instead of writing its own loop.

This is the least invasive — no new events, no ordering concerns, just DRY.

### 2. Transport record cleanup

Make `demandId` and `sourceBuilding` writable with default sentinel values for reconstruction:

Actually, making them optional changes the interface everywhere. The sentinel values work fine — just document them clearly. The real issue is the comment "cosmetic stand-in" which is vague.

Better: add a static factory for reconstruction:
```typescript
// In transport-job-service.ts or transport-job-record.ts
function createDeliveryOnlyRecord(params: {
    gameState: GameState;
    carrierId: number;
    destBuilding: number;
    material: EMaterialType;
    amount: number;
    slotId: number;
    gameTime: number;
}): TransportJobRecord {
    return {
        id: params.gameState.allocateJobId(),
        demandId: -1,
        sourceBuilding: params.destBuilding,
        destBuilding: params.destBuilding,
        material: params.material,
        amount: params.amount,
        carrierId: params.carrierId,
        slotId: params.slotId,
        phase: TransportPhase.PickedUp,
        createdAt: params.gameTime,
    };
}
```

This encapsulates the sentinel values in one place with a clear name.

### 3. Stale comments & validation

**Stale comment fix** in `settler-task-persistence.ts`:
```typescript
// OLD: "Transport jobs (carriers) are explicitly excluded — they are handled by
//       LogisticsDispatcherFeature persistence + onRestoreComplete re-dispatch."
// NEW: "Transport jobs (carriers) are synthetic and excluded — their state is
//       reconstructed from entity.jobId + entity.carrying on restore."
```

**nextJobId validation** in `restoreFromSnapshot()`:
After restoring entities, scan for max jobId and ensure counter is above it:
```typescript
let maxJobId = snapshot.nextJobId;
for (const e of snapshot.entities) {
    if (e.jobId !== undefined && e.jobId >= maxJobId) {
        maxJobId = e.jobId + 1;
    }
}
game.state.nextJobId = maxJobId;
```

## File Map

### Modified Files

| File | Change |
|------|--------|
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | Replace building scan in onRestoreComplete with shared helper |
| `src/game/features/barracks/barracks-feature.ts` | Replace building scan with shared helper |
| `src/game/features/building-demand/building-demand-feature.ts` | Replace building scan with shared helper |
| `src/game/features/victory-conditions/victory-conditions-feature.ts` | Replace building scan with shared helper |
| `src/game/features/logistics/transport-job-record.ts` | Add `createDeliveryOnlyRecord()` factory |
| `src/game/features/logistics/logistics-dispatcher.ts` | Use `createDeliveryOnlyRecord()` in `rebuildFromEntities()` |
| `src/game/features/settler-tasks/settler-task-persistence.ts` | Fix stale comment about synthetic jobs |
| `src/game/state/game-state-persistence.ts` | Add nextJobId validation after entity restore |

### New Files

| File | Purpose |
|------|---------|
| `src/game/features/restore-utils.ts` | `forEachCompletedBuilding()` shared helper |
