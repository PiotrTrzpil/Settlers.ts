# Death Angel — Design

## Overview

When any unit dies in combat, a translucent angel entity spawns at the death position, plays its idle animation once (rising animation), and is then removed from the game. This is a visual-only effect — angels do not participate in combat, logistics, or settler tasks.

## Summary for Review

- **Interpretation**: Replicate the classic Settlers 4 death angel mechanic. When a unit's health reaches zero in combat, instead of silently disappearing, an angel entity spawns at the death location, plays one cycle of its idle animation, then gets removed. This gives visual feedback that a unit has fallen.

- **Assumptions**:
  - Angel sprites exist in all race JIL files at indices 333-335 (they do — this was a core Settlers 4 mechanic). We use the dying unit's race to load the correct race-specific angel sprite.
  - We only use `Angel` (level 1, JIL 333) for the death effect — `Angel2`/`Angel3` are unused here (those are Dark Tribe gameplay units with no relevance to death effects).
  - The angel animation has N frames at 100ms/frame. We use a fixed duration of 3 seconds as a conservative timer; the angel is removed when the timer expires regardless of actual frame count. This avoids needing to query the sprite loader for frame count at runtime.

- **Architecture**: A single `death-angel` feature module listens to the `combat:unitDefeated` event, spawns an angel entity at the dying unit's position (same player and race), plays a non-looping idle animation, and removes it after a timer. A TickSystem drives the timers. Angel units are excluded from settler-task processing via a unit-type guard to prevent animation interference. Combat won't target angels because `isUnitTypeMilitary()` returns false for Worker-category units.

- **Contracts & boundaries**: The death-angel feature only interacts with the game via `combat:unitDefeated` events (input), `addUnit`/`removeEntity` commands (entity lifecycle), and `EntityVisualService` (animation). No exports — no other feature depends on death angels.

- **Scope**: Combat death only. Does not cover non-combat unit removal (e.g., dismissal, starvation). Could be extended later by listening to additional events.

## Project Conventions (extracted)

### Code Style
- Feature modules live in `src/game/features/<name>/` with `index.ts` barrel
- `*-system.ts` for TickSystem, `*-feature.ts` for FeatureDefinition
- Config object pattern for 3+ dependencies
- `@/` path alias for imports

### Error Handling
- Optimistic: assume required values exist, crash loudly with context
- `getEntityOrThrow(id, 'context')` for entity lookups
- TickSystem.tick() wraps per-entity work in try/catch to avoid cascading failures

### Type Philosophy
- Required fields are required — no optional `?` for always-present values
- Race is always a required parameter, never optional with fallback

### Representative Pattern

```typescript
// From src/game/features/combat/combat-feature.ts
export const CombatFeature: FeatureDefinition = {
    id: 'combat',
    dependencies: [],

    create(ctx) {
        const combatSystem = new CombatSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            visualService: ctx.visualService,
            executeCommand: ctx.executeCommand,
        });

        ctx.on('unit:spawned', ({ entityId, unitType, player }) => {
            if (isUnitTypeMilitary(unitType)) {
                combatSystem.register(entityId, player, unitType);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(combatSystem.unregister.bind(combatSystem));

        return {
            systems: [combatSystem],
            exports: { combatSystem } satisfies CombatExports,
        };
    },
};
```

## Architecture

### Data Flow

```
combat:unitDefeated event
        |
        v
DeathAngelFeature handler
  - reads dying unit position + race from GameState
  - spawns angel entity via addUnit (selectable=false)
  - initialises visual state + starts idle animation
  - registers angel in DeathAngelSystem timer map
        |
        v
DeathAngelSystem.tick(dt)
  - advances timers for all active angels
  - when timer expires: removeEntity command
        |
        v
entity:removed (cleanup)
  - DeathAngelSystem removes angel from tracking map
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Death Angel Feature | Event handling, angel spawn, animation, timer-based cleanup | combat (event source) | `src/game/features/death-angel/` |
| 2 | Settler Task Exclusion | Skip angel unit types in tick loop | — | `src/game/features/settler-tasks/settler-task-system.ts` |
| 3 | Wiring | Register feature in game-services | 1 | `src/game/game-services.ts` |

## Shared Contracts (as code)

```typescript
// No exported types — this feature is self-contained.
// Internal state tracked by DeathAngelSystem:

interface AngelEntry {
    entityId: number;      // ID of the spawned angel entity
    elapsedMs: number;     // time since spawn
}

// Constants
const ANGEL_DURATION_MS = 3000;  // total time angel is visible
```

## Subsystem Details

### Subsystem 1: Death Angel Feature Module

**Files**: `src/game/features/death-angel/death-angel-system.ts`, `src/game/features/death-angel/death-angel-feature.ts`, `src/game/features/death-angel/index.ts`

**Owns**: angel spawning, animation playback, timed removal

**Key decisions**:
- Use `UnitType.Angel` (index 58) for all death angels regardless of the dying unit's type or level. The race comes from the dying unit to load correct race-specific sprites.
- Angel entity is spawned with `selectable: false` — not clickable, not targetable.
- Fixed 3-second timer rather than frame-count-based completion detection. Avoids coupling to sprite loader internals. The renderer clamps non-looping animations to the last frame, so the angel stays on its final frame until removal.
- Angel entity inherits the dying unit's player. Combat targeting already filters by `isUnitTypeMilitary()` so Angel (category Worker) is never targeted regardless of player.

**Behavior — `death-angel-feature.ts`**:
1. `create(ctx)` subscribes to `combat:unitDefeated`
2. Handler reads dying entity from `gameState.getEntity(entityId)` (entity still exists at event time — event fires before `remove_entity` command)
3. Spawns angel: `ctx.gameState.addUnit(UnitType.Angel, entity.x, entity.y, entity.player, entity.race, false)`
4. Clears tile occupancy so the angel doesn't block pathfinding: `ctx.gameState.tileOccupancy.delete(tileKey(entity.x, entity.y))` — `addEntity` always sets occupancy for units, but angels are visual-only and must not block movement
5. Calls `ctx.visualService.play(angelId, 'idle', { loop: false, direction: 0 })` to start the one-shot animation
5. Registers `{ entityId: angelId, elapsedMs: 0 }` in the system's tracking map
6. Registers cleanup via `ctx.cleanupRegistry.onEntityRemoved(...)` to handle removal from tracking

**Behavior — `death-angel-system.ts`**:
- Implements `TickSystem`
- `tick(dt)`: iterates tracked angels, increments `elapsedMs`, calls `executeCommand({ type: 'remove_entity', entityId })` when timer exceeds `ANGEL_DURATION_MS`
- Each tick also re-applies `visualService.play(entityId, 'idle', { loop: false })` to counteract idle-animation-controller interference (play() with same key just sets `playing = true` without restarting — see entity-visual-service.ts line 171-181)
- Cleanup callback removes angel from tracking map when entity is removed

**`index.ts`**: Barrel re-exporting `DeathAngelFeature`.

### Subsystem 2: Settler Task Exclusion

**Files**: `src/game/features/settler-tasks/settler-task-system.ts`

**Change**: In the `tick()` method (around line 665), add a guard to skip angel unit types. Angel entities are ephemeral visual effects and must not get runtimes or animation processing from the settler task system.

```typescript
// In tick(dt):
for (const entity of this.gameState.entityIndex.ofType(EntityType.Unit)) {
    // Skip ephemeral visual-only units (death angels)
    if (isAngelUnitType(entity.subType as UnitType)) continue;

    try {
        const runtime = this.getRuntime(entity.id);
        this.stateMachine.updateUnit(entity, runtime, dt);
    } catch (e) { ... }
}
```

**Helper**: Add `isAngelUnitType()` to `src/game/unit-types.ts`:
```typescript
export function isAngelUnitType(type: UnitType): boolean {
    return type === UnitType.Angel || type === UnitType.Angel2 || type === UnitType.Angel3;
}
```

This is preferred over modifying idle-animation-controller because it prevents runtime creation, memory allocation, and all processing — not just animation interference.

### Subsystem 3: Wiring

**Files**: `src/game/game-services.ts`

**Change**: Add `DeathAngelFeature` to `featureRegistry.loadAll()` after `CombatFeature` (Tier 0, since it only listens to an event — no feature dependency needed, only needs the `combat:unitDefeated` event which exists from EventBus):

```typescript
this.featureRegistry.loadAll([
    // Tier 0: no dependencies
    MovementFeature,
    // ... existing ...
    CombatFeature,
    DeathAngelFeature,   // <-- add here
    // ...
]);
```

Add the import at the top of game-services.ts.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/death-angel/death-angel-system.ts` | 1 | TickSystem: timer tracking and angel removal |
| `src/game/features/death-angel/death-angel-feature.ts` | 1 | FeatureDefinition: event handling and angel spawning |
| `src/game/features/death-angel/index.ts` | 1 | Barrel file |

### Modified Files
| File | Change | Subsystem |
|------|--------|-----------|
| `src/game/unit-types.ts` | Add `isAngelUnitType()` helper | 2 |
| `src/game/features/settler-tasks/settler-task-system.ts` | Skip angel units in `tick()` | 2 |
| `src/game/game-services.ts` | Register `DeathAngelFeature`, add import | 3 |

## Verification

- Start a game with military units from two players in proximity
- Units engage in combat; when one dies, an angel appears at the death position
- Angel plays its rising/idle animation once over ~3 seconds
- Angel disappears after animation completes
- No console errors from settler-task-system or idle-animation-controller
- Angel is not selectable or targetable by other units
- Multiple angels can exist simultaneously (one per death)
- Angels do not block tile occupancy or pathfinding for other units (occupancy is explicitly cleared after spawn)
