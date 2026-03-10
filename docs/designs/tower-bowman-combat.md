# Tower Bowman Combat — Design

## Overview

Garrisoned bowmen are rendered visually on top of towers/castles and shoot nearby enemy units with ranged attacks (arrows). This extends the existing tower-garrison and combat systems with rendering and ranged attack behavior for garrisoned bowmen.

## Summary for Review

- **Interpretation**: Bowmen garrisoned in towers should (1) appear visually on the tower sprite and (2) automatically attack nearby enemies with ranged projectile attacks, without leaving the tower.
- **Key decisions**:
  - Bowmen rendered as sprite overlays at predefined offset positions on each tower type (no physics — just visual slots)
  - Ranged attacks deal damage directly (no projectile entity/travel time) — arrow visual is cosmetic only (stretch goal, can defer)
  - Tower combat is a new TickSystem in the tower-garrison feature, not part of the existing CombatSystem (garrisoned units are hidden and not in the combat state machine)
  - Attack range, cooldown, and damage reuse `getCombatStats()` from combat-state but with a tower-specific range constant
- **Assumptions**: Swordsmen garrisoned in towers do NOT attack — only bowmen. Arrow projectile visuals can be deferred to a follow-up.
- **Scope**: Included: rendering bowmen on towers, tower ranged attack system. Deferred: arrow projectile visuals, tower destruction animation, swordsman tower combat.

## Conventions

- Optimistic programming: no `?.` or `?? fallback` on required values — use `!` or `getEntityOrThrow`
- Feature modules: single entry point `index.ts`, internal/ for non-public code
- Events: `domain:past-tense` format (e.g., `garrison:bowmanFired`)
- Systems catch+log errors in tick; commands return boolean
- Use `sortedEntries()` for deterministic iteration over Maps
- Max complexity 15 per function, max 140 char lines
- Race is never optional

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Tower bowman positions | Define visual offset positions for bowmen on each tower/castle type | — | `src/game/features/tower-garrison/internal/bowman-positions.ts` |
| 2 | Tower combat system | Tick system: garrisoned bowmen scan for enemies, deal ranged damage | 1 | `src/game/features/tower-garrison/internal/tower-combat-system.ts` |
| 3 | Tower bowman render pass | Render pass: draw bowman sprites at tower offset positions | 1 | `src/game/features/tower-garrison/internal/tower-bowman-render-pass.ts` |
| 4 | Feature wiring | Register new system, render pass, and events in tower-garrison-feature | 1, 2, 3 | `src/game/features/tower-garrison/tower-garrison-feature.ts` (modify) |

## Shared Contracts

```typescript
// ── bowman-positions.ts ──

/** Pixel offset from tower entity position for each bowman visual slot. */
export interface BowmanSlotPosition {
    /** Pixel offset X from tower sprite origin */
    readonly offsetX: number;
    /** Pixel offset Y from tower sprite origin */
    readonly offsetY: number;
}

/**
 * Returns the visual positions for bowman slots on this building type.
 * Array length matches bowmanSlots.max from garrison-capacity.
 * Returns undefined for non-garrison buildings.
 */
export function getBowmanSlotPositions(buildingType: BuildingType): readonly BowmanSlotPosition[] | undefined;

// ── tower-combat-system.ts ──

/** Range in hex tiles at which garrisoned bowmen can fire. */
export const TOWER_ATTACK_RANGE = 8;

/** How often garrisoned bowmen scan for targets (seconds). */
export const TOWER_SCAN_INTERVAL = 0.5;

export interface TowerCombatSystemConfig {
    garrisonManager: TowerGarrisonManager;
    combatSystem: CombatSystem;  // for getState() health checks and applyDamage event
    gameState: GameState;
    eventBus: EventBus;
}

// ── Events emitted ──

// 'garrison:bowmanFired' → { buildingId: number; bowmanId: number; targetId: number; damage: number }

// ── tower-bowman-render-pass.ts ──

// Implements PluggableRenderPass. Registered at RenderLayer.AboveEntities.
// prepare() reads garrison state + bowman positions to build sprite list.
// draw() emits bowman sprites at tower position + slot offset.
```

## Subsystem Details

### 1. Tower Bowman Positions
**Files**: `src/game/features/tower-garrison/internal/bowman-positions.ts`
**Key decisions**:
- Positions are pixel offsets relative to the tower's tile-to-screen position (same coordinate space as building overlays)
- Hardcoded per BuildingType — GuardTowerSmall (2 slots), GuardTowerBig (3), Castle (5)
- Values will need visual tuning; start with reasonable defaults spread across the tower top

### 2. Tower Combat System
**Files**: `src/game/features/tower-garrison/internal/tower-combat-system.ts`
**Key decisions**:
- Iterates garrisons (not individual units) — for each tower with bowmen, scan for enemies within `TOWER_ATTACK_RANGE` of the **building position** (not the hidden unit position)
- Uses `gameState.getEntitiesInRadius(building.x, building.y, TOWER_ATTACK_RANGE)` for enemy detection
- Each bowman has an independent attack timer (stored in a `Map<number, number>` keyed by unit ID)
- Damage uses `getCombatStats(bowmanUnitType).attackPower` — same stats as field combat
- Damage is applied via the CombatSystem's state: decrement `targetState.health`, emit `combat:unitAttacked`, trigger kill if health <= 0
- Only targets units registered in CombatSystem (i.e., military units with health > 0)
- Deterministic target selection: pick nearest enemy; ties broken by entity ID

### 3. Tower Bowman Render Pass
**Files**: `src/game/features/tower-garrison/internal/tower-bowman-render-pass.ts`
**Key decisions**:
- Registered as `PluggableRenderPass` at `RenderLayer.AboveEntities` so bowmen draw on top of tower sprites
- For each garrison with bowmen: resolve bowman sprite (idle/fight animation via `EntitySpriteResolver`), emit at tower screen position + slot pixel offset
- Bowmen face the direction of their current target (if attacking) or a default direction (if idle)
- Uses the same sprite batch renderer as `EntitySpritePass` — no new GL resources needed
- Needs access to `TowerGarrisonManager` and `GameState` to know which towers have bowmen and where they are
- The render pass reads a `towerBowmanRenderState` map populated by the tower combat system each tick (target direction per bowman)

### 4. Feature Wiring
**Files**: `src/game/features/tower-garrison/tower-garrison-feature.ts` (modify)
**Key decisions**:
- Add `TowerCombatSystem` to `systems` array
- Add `renderPasses` array to feature instance with the tower bowman render pass definition
- Tower combat system needs access to `CombatSystem` — add `'combat'` to feature dependencies and get it from `ctx.getFeature`
- Export `towerCombatSystem` in `TowerGarrisonExports` for debug access

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/tower-garrison/internal/bowman-positions.ts` | 1 | Visual slot offsets per tower type |
| `src/game/features/tower-garrison/internal/tower-combat-system.ts` | 2 | Ranged attack tick system |
| `src/game/features/tower-garrison/internal/tower-bowman-render-pass.ts` | 3 | Render garrisoned bowmen on towers |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | Add combat system, render pass, combat dependency |
| `src/game/features/tower-garrison/types.ts` | Add `TowerBowmanRenderState` interface if needed |

## Verification
- Place a GuardTowerSmall, garrison 2 bowmen → bowmen sprites visible on tower
- Enemy unit walks within range 8 → bowmen attack, enemy takes damage and dies
- Enemy outside range → no attack
- Tower destroyed → bowmen ejected, stop attacking, render pass stops drawing them
- Multiple towers with bowmen → each tower independently targets nearest enemy
