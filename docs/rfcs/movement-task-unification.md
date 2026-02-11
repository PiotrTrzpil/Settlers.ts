# Plan: Unify Movement Under SettlerTaskSystem

## Goal

Make MovementSystem a pure "backend" (pathfinding, collisions, positions) and route ALL movement through SettlerTaskSystem. Remove IdleBehaviorSystem — its responsibilities move into SettlerTaskSystem.

## Current State

```
User Command ─────────────────────────> MovementSystem.moveUnit()
                                              │
                                              ▼ (emits events)
                                        IdleBehaviorSystem
                                              │ (plays animations)
                                              ▼
                                        AnimationService

SettlerTaskSystem ──(for workers)──────> MovementSystem.moveUnit()
                   ──(plays animations)─> AnimationService
```

**Problems:**
- IdleBehaviorSystem and SettlerTaskSystem both control animations
- IdleBehaviorSystem must check "is this unit managed?" to avoid conflicts
- Movement is initiated from multiple places with different animation handling

## Target State

```
User Command ──────> SettlerTaskSystem.assignMoveTask()
                              │
                              ├──(movement)──> MovementSystem (backend)
                              └──(animation)──> AnimationService

Worker Jobs ───────> SettlerTaskSystem (existing YAML-based jobs)
                              │
                              ├──(movement)──> MovementSystem (backend)
                              └──(animation)──> AnimationService
```

**Benefits:**
- Single system controls all unit behavior and animation
- MovementSystem is pure infrastructure
- No coordination/checking between animation systems
- Consistent model for all unit types

---

## Implementation Steps

### Phase 1: Extend SettlerTaskSystem for Simple Movement

**1.1 Add MoveTask type to SettlerTaskSystem**

File: `src/game/systems/settler-tasks/settler-task-system.ts`

- Add a new task type for simple movement (user commands)
- This is NOT a YAML job, just an internal task that:
  - Calls `movementSystem.moveUnit()`
  - Plays walk animation
  - Completes when movement controller becomes idle

```typescript
interface MoveTaskState {
  type: 'move';
  targetX: number;
  targetY: number;
}
```

**1.2 Add public method to assign move tasks**

```typescript
// Called by command system for user-initiated moves
assignMoveTask(entityId: number, targetX: number, targetY: number): boolean
```

**1.3 Handle units without YAML configs**

Currently `tick()` only processes units with `settlerConfigs`. Need to also:
- Track units with active move tasks (even without YAML config)
- Update move tasks to completion

### Phase 2: Handle Animation in SettlerTaskSystem

**2.1 Move walk animation logic from IdleBehaviorSystem**

When a move task starts:
```typescript
this.animationService.play(entityId, getWalkSequenceKey(entity), { loop: true, direction });
```

When move task completes (unit stops):
```typescript
this.animationService.play(entityId, ANIMATION_SEQUENCES.DEFAULT);
this.animationService.stop(entityId);
```

**2.2 Handle direction changes during movement**

In `tick()`, detect direction changes from MovementController and update animation:
```typescript
const controller = this.gameState.movement.getController(entityId);
const currentDirection = controller?.direction;
// If direction changed, update animation direction
this.animationService.setDirection(entityId, currentDirection);
```

**2.3 Move idle turning logic from IdleBehaviorSystem**

- Track `idleTime` per unit
- When unit has no task and is idle, occasionally change direction
- Use existing RNG for deterministic behavior

### Phase 3: Update Command System

**3.1 Change `executeMoveUnit` in command.ts**

Before:
```typescript
return ctx.state.movement.moveUnit(cmd.entityId, cmd.targetX, cmd.targetY);
```

After:
```typescript
return ctx.settlerTaskSystem.assignMoveTask(cmd.entityId, cmd.targetX, cmd.targetY);
```

**3.2 Change `executeMoveSelectedUnits`**

Same pattern - route through SettlerTaskSystem.

**3.3 Update CommandContext to include settlerTaskSystem**

Add `settlerTaskSystem` to the command context so commands can access it.

### Phase 4: Simplify MovementSystem

**4.1 Remove animation-related events**

Remove emission of:
- `unit:movementStarted` (only used by IdleBehaviorSystem)
- `unit:directionChanged` (only used by IdleBehaviorSystem)

Keep:
- `unit:movementStopped` (still used by CarrierSystem for arrival detection)

**4.2 Clean up event definitions**

In `event-bus.ts`, remove unused event type definitions.

### Phase 5: Remove IdleBehaviorSystem

**5.1 Delete the file**

Delete: `src/game/systems/idle-behavior.ts`

**5.2 Remove from game-loop.ts**

- Remove import
- Remove construction and registration
- Remove `setManagedCheck` call
- Remove `cleanupIdleState` call in entity removal

**5.3 Update any other references**

Search for `idleBehaviorSystem` and `IdleBehaviorSystem` references.

### Phase 6: Handle CarrierSystem

CarrierSystem currently listens to `unit:movementStopped` for arrival detection.

**Options:**
1. Keep the event (minimal change) ✓
2. Change CarrierSystem to poll movement state in tick()

**Decision:** Keep `unit:movementStopped` for now. CarrierSystem using it for arrival detection is fine — it's not about animation.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/game/systems/settler-tasks/settler-task-system.ts` | Add MoveTask, animation handling, idle turning, public API |
| `src/game/systems/settler-tasks/types.ts` | Add MoveTaskState type if needed |
| `src/game/systems/movement/movement-system.ts` | Remove `movementStarted` and `directionChanged` events |
| `src/game/commands/command.ts` | Route moves through SettlerTaskSystem |
| `src/game/game-loop.ts` | Remove IdleBehaviorSystem, update command context |
| `src/game/event-bus.ts` | Remove unused event types |
| `src/game/systems/idle-behavior.ts` | DELETE |

---

## Testing Strategy

1. **Unit tests**: Existing settler task tests should still pass
2. **Manual testing**:
   - Click to move a unit → should walk with animation
   - Unit arrives → should stop and play idle animation
   - Woodcutter job → should still work (existing behavior)
   - Carrier delivery → should still work (uses its own animation system)
3. **E2E tests**: Run full suite to catch regressions

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing worker behavior | Keep YAML job handling unchanged, only add MoveTask |
| Animation glitches during transition | Test each phase incrementally |
| CarrierSystem breaks | Keep `movementStopped` event, CarrierSystem has its own animation controller |
| Direction not updating during walk | Explicitly track and update direction in tick() |

---

## Order of Implementation

1. Phase 1 (extend SettlerTaskSystem) - can test independently
2. Phase 2 (animation handling) - verify walk/idle animations work
3. Phase 3 (command system) - now user commands go through tasks
4. Phase 4 (simplify MovementSystem) - remove unused events
5. Phase 5 (remove IdleBehaviorSystem) - final cleanup
6. Phase 6 (verify CarrierSystem) - ensure no regressions
