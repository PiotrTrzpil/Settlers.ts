# Architecture Fixes — Implementation Plan

Concrete, file-by-file implementation plans for the issues identified in `docs/modularity-review.md`.

---

## Fix 1: Make EventBus Required in CommandContext

### Problem

`eventBus` is optional (`eventBus?: EventBus`) in `CommandContext`. If a caller forgets to pass it, events silently don't fire. Features relying on events (e.g., terrain restoration on `building:removed`) fail without warning.

### Files Changed

| File | Change |
|------|--------|
| `src/game/commands/command.ts` | Change `eventBus?: EventBus` → `eventBus: EventBus` in `CommandContext` and `executeCommand()` signature. Remove all `?.` guards on `ctx.eventBus`. |
| `src/game/game.ts` | Already passes `this.eventBus` — no change needed. |
| `tests/unit/helpers/test-game.ts` | All helper functions that call `executeCommand` must pass an `EventBus`. Create a default `new EventBus()` in each helper or accept one as parameter. |
| `tests/unit/command.spec.ts` | Direct `executeCommand()` calls need an `EventBus` argument. |
| `tests/unit/unit-placement-selection-movement.spec.ts` | Same — pass `new EventBus()`. |
| `tests/unit/flows/game-session.spec.ts` | Same — pass `new EventBus()` or use helper. |

### Implementation Steps

1. In `src/game/commands/command.ts`:
   - Change interface: `eventBus: EventBus` (remove `?`)
   - Change `executeCommand()` signature: `eventBus: EventBus` (remove `?`)
   - Replace all `ctx.eventBus?.emit(...)` with `ctx.eventBus.emit(...)`
   - Replace all `ctx.eventBus &&` guards with direct calls

2. In `tests/unit/helpers/test-game.ts`:
   - Add `eventBus: EventBus = new EventBus()` default parameter to `placeBuilding`, `spawnUnit`, `moveUnit`, `selectEntity`
   - `removeEntity` already accepts an optional eventBus and creates one as fallback — make it always create one

3. In test files that call `executeCommand` directly:
   - Add `import { EventBus } from '@/game/event-bus'`
   - Pass `new EventBus()` as the last argument

### Risk

Low. All production code already passes the event bus. Only test code omits it. The change surfaces any test that currently silently skips events — which is what we want.

---

## Fix 2: Convert Movement, IdleBehavior, and LumberjackSystem to TickSystem

### Problem

`GameLoop.tick()` mixes four different dispatch patterns. Only `BuildingConstructionSystem` uses the `TickSystem` interface. Movement, idle behavior, and lumberjack are hard-coded direct calls, defeating the registration pattern.

### Target State

```typescript
// game-loop.ts tick()
private tick(dt: number): void {
    debugStats.recordTick();
    for (const system of this.systems) {
        system.tick(dt);
    }
}
```

All four systems registered in order: movement → idle → construction → lumberjack.

### Files Changed

| File | Change |
|------|--------|
| `src/game/systems/movement/movement-system.ts` | Add `implements TickSystem` to `MovementSystem`. Rename internal `update(dt)` to `tick(dt)` (or add `tick` as alias). |
| `src/game/systems/movement/index.ts` | Re-export `TickSystem` is not needed; `MovementSystem` already exported. |
| `src/game/systems/idle-behavior.ts` | Wrap in a class `IdleBehaviorSystem implements TickSystem`. Move `updateIdleBehavior()` to `tick()` method. The module-level `idleStates` map becomes an instance field. Export `cleanupIdleState` as a method. |
| `src/game/systems/lumberjack-system.ts` | Add `implements TickSystem`. Add a `tick(dt)` method that wraps `update(state, dt)`. Store `GameState` ref in constructor. |
| `src/game/game-loop.ts` | Remove direct calls to `movement.update()`, `updateIdleBehavior()`, `lumberjackSystem.update()`. Register all systems in constructor. Remove import of `updateIdleBehavior`. |
| `src/game/game-state.ts` | Remove `lumberjackSystem` field (it moves to GameLoop-level registration). Keep `movement` since it's used by many systems for queries, but it registers as a TickSystem too. Remove `cleanupIdleState` import (cleanup moves to IdleBehaviorSystem listening to events or being called by entity removal). |
| `src/game/game.ts` | No changes (GameLoop constructor handles registration). |
| Tests | `state.movement.update(dt)` calls in tests remain valid (MovementSystem.tick just calls the same logic). Tests that call `updateIdleBehavior` directly need updating. |

### Implementation Steps

#### Step 2a: MovementSystem implements TickSystem

In `src/game/systems/movement/movement-system.ts`:
- Add `import type { TickSystem } from '../../tick-system'`
- Change class declaration: `export class MovementSystem implements TickSystem`
- Add `tick(dt: number): void { this.update(dt); }` method (keeping `update` for backward compat in tests)

#### Step 2b: IdleBehaviorSystem class

In `src/game/systems/idle-behavior.ts`:
- Convert to class `IdleBehaviorSystem implements TickSystem`
- Move `idleStates` map to instance field
- Constructor takes `GameState`
- `tick(dt)` replaces `updateIdleBehavior(state, dt)`
- `cleanupIdleState(entityId)` becomes instance method
- Keep the old function export as a deprecated wrapper for tests, or update all callers

#### Step 2c: LumberjackSystem implements TickSystem

In `src/game/systems/lumberjack-system.ts`:
- Add `implements TickSystem`
- Constructor takes `GameState`
- Add `tick(dt: number): void { this.update(this.state, dt); }`
- Store `state` as private field set in constructor

#### Step 2d: Update GameLoop

In `src/game/game-loop.ts`:
- Remove imports: `updateIdleBehavior`
- Constructor registers systems in order:
  1. `MovementSystem` (from `gameState.movement`)
  2. `IdleBehaviorSystem` (new instance)
  3. `BuildingConstructionSystem` (existing)
  4. `LumberjackSystem` (new instance, moved from GameState)
- `tick()` becomes a clean loop over `this.systems`
- Remove direct calls to `movement.update()`, `updateIdleBehavior()`, `lumberjackSystem.update()`

#### Step 2e: Update GameState

In `src/game/game-state.ts`:
- Remove `public readonly lumberjackSystem = new LumberjackSystem()`
- Remove `import { LumberjackSystem }`
- Remove `import { cleanupIdleState }` and the call in `removeEntity()`
- Idle cleanup will be handled by `IdleBehaviorSystem` listening for entity removal (via periodic cleanup or event)

#### Step 2f: Update Tests

- Tests calling `state.movement.update(dt)` still work (method kept for backward compat)
- Tests importing `updateIdleBehavior` need to use `IdleBehaviorSystem` class instead
- Tests referencing `state.lumberjackSystem` need to create `LumberjackSystem` directly

### System Registration Order

The order matters for correctness:

1. **MovementSystem** — Updates unit positions (must run first so other systems see current positions)
2. **IdleBehaviorSystem** — Updates animation state based on movement (must run after movement)
3. **BuildingConstructionSystem** — Construction ticks (independent of movement)
4. **LumberjackSystem** — AI behavior that issues movement commands (runs after construction so it can see completed buildings)

### Risk

Medium. Movement and lumberjack are well-tested. Idle behavior has no dedicated tests but is exercised through e2e. The key risk is registration order — we preserve the existing call order exactly.

---

## Verification Plan

After implementing both fixes:

1. `pnpm test:unit` — All unit tests pass
2. `pnpm build` — TypeScript compilation succeeds
3. Spot-check: `pnpm test:unit -- --grep "command"` for Fix 1
4. Spot-check: `pnpm test:unit -- --grep "movement"` for Fix 2
