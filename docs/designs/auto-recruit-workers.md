# Auto-Recruit Construction Workers — Design

## Overview

When a construction site needs diggers or builders but the player has none available, idle carriers automatically walk to the nearest free pile containing a shovel (for diggers) or hammer (for builders), pick up the tool, and transform into the required worker type. Up to 4 diggers and up to 4 builders are auto-recruited per player (separate caps). Recruitment is lazy: diggers are recruited when a site enters `WaitingForDiggers`, builders only when a site enters `WaitingForBuilders` (terrain leveled + materials available).

## Architecture

### Data Flow

```
ConstructionSiteManager                    AutoRecruitSystem
  (sites needing workers)  ──────────────►  (periodic demand check)
                                                   │
                                    ┌──────────────┤
                                    ▼              ▼
                              count idle      query free piles
                            builders/diggers   for HAMMER/SHOVEL
                              per player        (PileRegistry +
                                               BuildingInventoryManager)
                                    │              │
                                    ▼              ▼
                              demand > 0?    tools available?
                                    └──────┬───────┘
                                           ▼
                                   CarrierAssigner
                                  (find idle carrier)
                                           │
                                           ▼
                                  RecruitmentJob created
                                  (walk → pickup → transform)
                                           │
                                           ▼
                              SettlerTaskSystem assigns job
                              CarrierManager marks busy
                                           │
                                           ▼
                              Carrier walks to free pile
                              Plays pickup animation
                                           │
                                           ▼
                              recruitment:completed event
                                           │
                                           ▼
                              UnitTransformer
                              (carrier → builder/digger)
                              - Change entity unitType
                              - Unregister from CarrierManager
                              - Clear carrying state
                              - Emit unit:transformed
```

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Auto-Recruit System | Periodic demand calculation, recruitment dispatch | `src/game/features/auto-recruit/auto-recruit-system.ts` |
| 2 | Tool Source Resolver | Find nearest free pile containing a specific tool material | `src/game/features/auto-recruit/tool-source-resolver.ts` |
| 3 | Recruitment Job | Choreography job: carrier walks to pile, picks up tool, triggers transform | `src/game/features/auto-recruit/recruitment-job.ts` |
| 4 | Unit Transformer | Convert carrier entity to builder/digger, manage registrations | `src/game/features/auto-recruit/unit-transformer.ts` |
| 5 | Feature Wiring | Feature module setup, event subscriptions, dependency injection | `src/game/features/auto-recruit/auto-recruit-feature.ts` |

## Data Models

### RecruitmentState (per player)

| Field | Type | Description |
|-------|------|-------------|
| pendingRecruitments | `Map<number, RecruitmentRecord>` | carrierId -> active recruitment |
| pendingDiggers | number | Count of digger recruitments currently in-flight |
| pendingBuilders | number | Count of builder recruitments currently in-flight |

### RecruitmentRecord

| Field | Type | Description |
|-------|------|-------------|
| carrierId | number | The carrier being transformed |
| targetUnitType | UnitType | Builder or Digger |
| toolMaterial | EMaterialType | HAMMER or SHOVEL |
| pileEntityId | number | Free pile to pick up from |
| siteId | number | Construction site that triggered demand |

### DemandResult

| Field | Type | Description |
|-------|------|-------------|
| unitType | UnitType | Builder or Digger |
| toolMaterial | EMaterialType | HAMMER or SHOVEL |
| siteId | number | Nearest site needing this worker |
| siteX | number | Site position X |
| siteY | number | Site position Y |

### ToolSource

| Field | Type | Description |
|-------|------|-------------|
| pileEntityId | number | Free pile entity containing the tool |
| x | number | Pile position |
| y | number | Pile position |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| MAX_AUTO_RECRUITED_DIGGERS | 4 | Hard cap on auto-recruited diggers per player |
| MAX_AUTO_RECRUITED_BUILDERS | 4 | Hard cap on auto-recruited builders per player |
| RECRUIT_CHECK_INTERVAL | 1.0 (seconds) | How often to scan for unmet demand |
| TOOL_FOR_BUILDER | EMaterialType.HAMMER (19) | Tool required for builder transformation |
| TOOL_FOR_DIGGER | EMaterialType.SHOVEL (33) | Tool required for digger transformation |

## Events

| Event | Payload | Emitter | Listeners |
|-------|---------|---------|-----------|
| `recruitment:started` | `{ carrierId, targetUnitType, pileEntityId, siteId }` | AutoRecruitSystem | (debug/UI) |
| `recruitment:completed` | `{ carrierId, targetUnitType }` | RecruitmentJob (on pickup complete) | UnitTransformer |
| `recruitment:failed` | `{ carrierId, reason }` | RecruitmentJob (pile gone, path blocked) | AutoRecruitSystem (cleanup) |
| `unit:transformed` | `{ entityId, fromType, toType }` | UnitTransformer | SettlerTaskSystem (re-register) |

## Internal APIs

### AutoRecruitSystem

```typescript
class AutoRecruitSystem {
  // Called every RECRUIT_CHECK_INTERVAL seconds
  tick(dt: number): void;

  // Calculate unmet worker demand for a player.
  // Returns demands sorted by nearest site first.
  private calculateDemand(player: number): DemandResult[];

  // Count idle + working builders/diggers for a player
  private countAvailableWorkers(player: number, unitType: UnitType): number;

  // How many recruitment slots remain for this player
  private remainingSlots(player: number): number;

  // Cancel recruitment if carrier dies or pile is destroyed
  cancelRecruitment(carrierId: number): void;
}
```

### ToolSourceResolver

```typescript
class ToolSourceResolver {
  // Find nearest free pile within player's territory containing the given tool material.
  // Returns null if none found.
  findNearestToolPile(
    material: EMaterialType,
    nearX: number,
    nearY: number,
    player: number
  ): ToolSource | null;
}
```

### RecruitmentJob

```typescript
// Create a transport-style job for carrier to walk to pile and pick up tool.
// On pickup completion, emits recruitment:completed.
function createRecruitmentJob(
  carrierId: number,
  pileEntityId: number,
  toolMaterial: EMaterialType,
  targetUnitType: UnitType,
  pileX: number,
  pileY: number
): ChoreoJobState;
```

### UnitTransformer

```typescript
class UnitTransformer {
  // Transform carrier into target unit type.
  // - Changes entity.unitType
  // - Unregisters from CarrierManager
  // - Clears carrying state (tool consumed)
  // - Emits unit:transformed
  transform(entityId: number, targetUnitType: UnitType): void;
}
```

## Error Handling & Boundaries

| Layer | On error... | Behavior |
|-------|------------|----------|
| Demand calculation | No sites need workers | Skip player, no-op |
| Tool source search | No free piles with tool | Skip this demand entry, try next tick |
| Carrier assignment | No idle carriers available | Skip, try next tick |
| Carrier pathfinding | Can't reach pile | `recruitment:failed` → cleanup record, carrier returns to idle |
| Pile destroyed mid-walk | Pile removed before arrival | `recruitment:failed` → cleanup record, carrier returns to idle |
| Tool withdrawn mid-walk | Pile emptied by another carrier | `recruitment:failed` → cleanup record, carrier returns to idle |
| Entity removed | Carrier dies during recruitment | `entity:removed` handler → cleanup record |

## Subsystem Details

### 1. Auto-Recruit System

**Files**: `src/game/features/auto-recruit/auto-recruit-system.ts`
**Owns**: Per-player recruitment state, demand calculation, dispatch orchestration
**Depends on**: ConstructionSiteManager, SettlerTaskSystem, CarrierAssigner, ToolSourceResolver, RecruitmentJob

**Key decisions**:
- Check interval of 1s (not every frame) — construction is slow, no urgency
- Digger demand checked when any site has phase `WaitingForDiggers` with unfilled digger slots and no idle diggers exist
- Builder demand checked when any site has phase `WaitingForBuilders` with unfilled builder slots and no idle builders exist
- In-flight recruitments count toward the cap but also count as "workers becoming available" so we don't over-recruit
- Priority: diggers before builders (terrain leveling blocks everything)

**Behavior**:

Per tick (every 1s):
1. For each player with active construction sites:
   a. Count all existing diggers for this player (any state) + pending digger recruitments
   b. If total < 4 and sites need diggers: recruit `min(4 - total, slotsNeeded)` diggers
   c. Count all existing builders for this player (any state) + pending builder recruitments
   d. If total < 4 and sites need builders: recruit `min(4 - total, slotsNeeded)` builders
   e. For each unmet demand:
      - Find nearest tool pile via `ToolSourceResolver`
      - Find nearest idle carrier via `CarrierAssigner.findIdleCarrier()`
      - Create `RecruitmentRecord`, store in state
      - Build `RecruitmentJob` and assign to carrier
      - Emit `recruitment:started`

**Demand calculation details**:
- Count all diggers for player = entity scan where `unitType === Digger && entity.player === player` (any state: idle, working, moving)
- Count all builders for player = same for `unitType === Builder`
- Digger shortfall = `max(0, 4 - (existingDiggers + pendingDiggerRecruitments))`, but only if any site is in `WaitingForDiggers` with unfilled slots
- Builder shortfall = `max(0, 4 - (existingBuilders + pendingBuilderRecruitments))`, but only if any site is in `WaitingForBuilders` with unfilled slots
- Recruit up to shortfall count (one carrier per recruitment)

### 2. Tool Source Resolver

**Files**: `src/game/features/auto-recruit/tool-source-resolver.ts`
**Owns**: Free pile tool queries
**Depends on**: GameState (entity iteration), BuildingInventoryManager or direct pile/inventory query

**Key decisions**:
- Query free piles by iterating entities with `SlotKind.Free` and checking pile material
- Distance-based: return nearest to reference position (the carrier or the construction site)
- Only consider piles with `amount > 0` (not reserved by other recruitments)

**Behavior**:
1. Iterate all pile entities where `kind.kind === SlotKind.Free`
2. Filter to those with `kind.material === toolMaterial`
3. Filter to piles within the player's territory (same rules as normal transport — use existing territory/logistics filters)
4. Check pile has unreserved quantity > 0
5. Sort by distance to `(nearX, nearY)`
6. Return closest, or null

**Reservation**: When a recruitment targets a pile, we must reserve the tool so multiple recruitments don't target the same single tool. Use the existing `ReservationManager` from logistics or track internally via a `Set<pileEntityId>` of reserved piles.

### 3. Recruitment Job

**Files**: `src/game/features/auto-recruit/recruitment-job.ts`
**Owns**: Job choreography for tool pickup, transformation trigger
**Depends on**: SettlerTaskSystem (job assignment), inventory system (withdrawal), EventBus

**Key decisions**:
- Reuse the existing carrier transport choreography pattern (walk → pickup animation)
- After pickup animation completes, emit `recruitment:completed` instead of standard delivery
- Tool is withdrawn from free pile inventory on pickup (consumed, not carried further)
- No delivery phase — carrier transforms in-place after pickup

**Behavior**:
1. Job created with walk target = pile position
2. Carrier walks to pile (standard pathfinding)
3. On arrival, play pickup animation (GET_GOOD choreography part)
4. On pickup complete:
   - Withdraw 1 unit of tool material from free pile inventory
   - Emit `recruitment:completed { carrierId, targetUnitType }`
5. On failure (pile gone, empty, unreachable):
   - Emit `recruitment:failed { carrierId, reason }`
   - Carrier returns to idle

### 4. Unit Transformer

**Files**: `src/game/features/auto-recruit/unit-transformer.ts`
**Owns**: Entity type mutation, system re-registration
**Depends on**: CarrierManager, GameState, EventBus

**Key decisions**:
- Transformation is instantaneous after pickup (no additional animation)
- The tool is consumed (not tracked as inventory — the unit "becomes" the worker)
- Carrier unregistered from CarrierManager, new type picked up by SettlerTaskSystem on next idle scan
- Emit `unit:transformed` so systems can react (e.g., SettlerTaskSystem re-initializes the unit's runtime)

**Behavior**:
1. Listen for `recruitment:completed` event
2. Look up entity by carrierId
3. Change `entity.unitType` from `Carrier` to `targetUnitType`
4. Call `carrierManager.unregister(carrierId)` — remove from carrier pool
5. Clear any carrying state on entity
6. Emit `unit:transformed { entityId, fromType: Carrier, toType: targetUnitType }`
7. SettlerTaskSystem listens to `unit:transformed`:
   - Reinitializes the unit's runtime with new SettlerConfig (builder/digger search type)
   - Unit enters IDLE state → next tick picks up construction job

### 5. Feature Wiring

**Files**: `src/game/features/auto-recruit/auto-recruit-feature.ts`
**Owns**: Feature module lifecycle, dependency injection
**Depends on**: All subsystems, core registries

**Behavior**:
1. Create `ToolSourceResolver` with game state access
2. Create `UnitTransformer` with CarrierManager + EventBus
3. Create `AutoRecruitSystem` with all dependencies
4. Subscribe `UnitTransformer` to `recruitment:completed`
5. Subscribe `AutoRecruitSystem` to `recruitment:failed` and `entity:removed` for cleanup
6. Register `AutoRecruitSystem.tick()` in the game loop (system registry)
7. Subscribe to `unit:transformed` in SettlerTaskSystem to reinitialize transformed units

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/auto-recruit/auto-recruit-system.ts` | Auto-Recruit System | Demand monitor + dispatch |
| `src/game/features/auto-recruit/tool-source-resolver.ts` | Tool Source Resolver | Free pile tool queries |
| `src/game/features/auto-recruit/recruitment-job.ts` | Recruitment Job | Carrier job choreography |
| `src/game/features/auto-recruit/unit-transformer.ts` | Unit Transformer | Entity type mutation |
| `src/game/features/auto-recruit/auto-recruit-feature.ts` | Feature Wiring | Module setup |

### Modified Files

| File | Change |
|------|--------|
| `src/game/features/settler-tasks/settler-task-system.ts` | Listen for `unit:transformed` → reinitialize unit runtime with new config |
| `src/game/features/carriers/carrier-manager.ts` | Add `unregister(carrierId)` method if not present |
| `src/game/game.ts` (or equivalent wiring) | Register `AutoRecruitFeature` in game setup |

## Open Questions

1. **Reservation mechanism**: Should we reserve the tool in the pile immediately when dispatching a carrier (prevents double-dispatch), or optimistically allow races and handle failure? Reservation is safer.

2. **Carrier selection**: Should we prefer carriers closest to the tool pile, or closest to the construction site? Closest to tool pile minimizes walk time.


## Out of Scope

- **Tool production priority**: No automatic ToolSmith priority changes when tools are needed
- **UI indicators**: No visual feedback for auto-recruitment in progress (can be added later via events)
- **Manual recruitment**: No player-initiated "convert carrier to builder" command
- **Tool return**: Auto-recruited workers don't revert to carriers when idle; they stay as builders/diggers permanently
- **Non-free-pile tools**: Only free piles are searched; tools in building storage are not considered
