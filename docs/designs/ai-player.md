# AI Player — Design

## Overview

A computer-controlled player that builds an economy, trains soldiers, and attacks enemies — all through the same command system that human players use. The AI is a feature module with a **behavior-tree-based decision engine** built from the existing `src/game/ai/` BT primitives (`Selector`, `Guard`, `Action`, etc.). Each AI player gets a decision tree that prioritizes: defend → train → attack → build economy. Build orders are race-specific data tables covering all 4 main races (Roman, Viking, Mayan, Trojan). This enables full headless game simulations (multiple AI players on a real map, running until one wins).

## Summary for Review

- **Interpretation**: An MVP AI player that can be instantiated per player index and plugged into GameCore. It issues `PlaceBuildingCommand`, `RecruitSpecialistCommand`, and `MoveUnitCommand` through `executeCommand()` — no special privileges. It uses a composable decision tree (existing BT nodes) to evaluate priorities each tick, and follows a race-specific hardcoded build order to establish a full economy (wood→boards, stone, food, race-specific drink, mines, weapons), then trains soldiers and attacks.
- **Key decisions**:
  - One `AiPlayerController` instance per AI player, all managed by a single `AiPlayerSystem` (TickSystem).
  - The AI's decision logic is a **behavior tree** composed from existing `Selector`/`Guard`/`Action` primitives with `T = AiPlayerController`. This makes adding new behaviors trivial (insert a new `guard(condition, action)` at the right priority).
  - Race-specific build orders are pure data tables — the core economy (wood, stone, food, mines, weapons) is shared; only the drink chain differs per race.
  - Building placement uses `spiralSearch` from the AI's castle position — same utility the test harness uses.
  - The AI throttles decisions (one evaluation per N ticks) to avoid spamming commands every frame.
  - The AI queries game state read-only (inventories, entity counts, territory) and acts only via commands.
- **Assumptions**:
  - AI players have castles placed on the map before the AI starts (standard map setup).
  - Territory is enabled — the AI places buildings within its own territory.
  - The AI doesn't need to handle map exploration/fog of war (not implemented yet).
  - Carrier spawning is handled automatically by residences (existing system).
- **Scope**: MVP — hardcoded build orders for 4 races, single attack strategy. Deferred: DarkTribe support, defensive garrisoning, resource trading, spell casting, difficulty levels.

## Conventions

- Optimistic programming: no `?.` on required deps, `getEntityOrThrow()`, throw with context
- Use enum members (`BuildingType.WoodcutterHut`), never numeric literals
- Feature module: `src/game/features/ai-player/` with `index.ts` barrel, `internal/` for implementation
- Events: `domain:past-tense` format (e.g., `ai:attackLaunched`)
- Race is always required, never optional — get from `gameState.playerRaces`
- Max 140 chars line length, max cyclomatic complexity 15
- All mutations through commands; tick systems catch errors, don't throw
- `Readonly<T>` from queries to prevent mutation
- Deterministic iteration: sort Maps before iterating for replay consistency

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Feature wiring | Feature definition, system registration, exports | — | `ai-player-feature.ts`, `index.ts` |
| 2 | Decision tree | Composable BT-based priority tree + per-player controller state | 1 | `internal/ai-decision-tree.ts`, `internal/ai-player-controller.ts` |
| 3 | Economy planner | Build order execution, building placement, production monitoring | 2 | `internal/economy-planner.ts` |
| 4 | Military planner | Soldier training, attack coordination, target selection | 2 | `internal/military-planner.ts` |
| 5 | Build orders | Race-specific build order data tables | — | `internal/build-orders.ts` |
| 6 | World queries | Read-only helpers to query game state for AI decisions | — | `internal/ai-world-queries.ts` |
| 7 | Integration test | Full game simulation: 2+ AI players on a test map, run until victory | 1-6 | `tests/unit/integration/ai/ai-game-simulation.spec.ts` |

## Shared Contracts

```typescript
// ─── src/game/features/ai-player/types.ts ────────────────────────

import type { BuildingType } from '@/game/buildings/building-type';
import type { Race } from '@/game/core/race';
import type { TickSystem } from '@/game/core/tick-system';

/** A single step in the AI's build order. */
export interface BuildStep {
    readonly buildingType: BuildingType;
    /** How many of this building to place before moving to next step. */
    readonly count: number;
}

/** Configuration for an AI player instance. */
export interface AiPlayerConfig {
    /** Player index (0-based). */
    readonly player: number;
    /** Ticks between AI evaluations (throttle). Default: 30 (~1 second). */
    readonly evaluationInterval?: number;
    /** Override build order. Uses race-appropriate default if not provided. */
    readonly buildOrder?: readonly BuildStep[];
}

/** Read-only snapshot of AI state for diagnostics/testing. */
export interface AiPlayerState {
    readonly player: number;
    readonly race: Race;
    readonly buildOrderIndex: number;
    readonly buildingsPlaced: number;
    readonly soldiersCount: number;
    readonly attacksSent: number;
    readonly attackTarget: { x: number; y: number } | null;
}

// ─── Feature exports (accessed via ctx.getFeature('ai-player')) ──

export interface AiPlayerExports {
    readonly aiSystem: AiPlayerSystem;
}

// ─── System interface ────────────────────────────────────────────

export interface AiPlayerSystem extends TickSystem {
    /** Add an AI controller for a player. Call after map is loaded. */
    addPlayer(config: AiPlayerConfig): void;
    /** Remove an AI controller. */
    removePlayer(player: number): void;
    /** Get current state of an AI player (for diagnostics/tests). */
    getState(player: number): Readonly<AiPlayerState>;
    /** Get all active AI player indices. */
    getActivePlayers(): readonly number[];
}

// ─── Build order data ────────────────────────────────────────────

/** Get the default build order for a race. */
export type BuildOrderFactory = (race: Race) => readonly BuildStep[];
```

## Subsystem Details

### 1. Feature Wiring
**Files**: `src/game/features/ai-player/ai-player-feature.ts`, `src/game/features/ai-player/index.ts`
**Dependencies**: `['combat', 'territory', 'victory-conditions', 'inventory']`
**Key decisions**:
- Single `AiPlayerSystemImpl` registered as a TickSystem in group `'AI'`
- Depends on combat (to check soldier states), territory (placement within borders), victory-conditions (stop when game ends), inventory (check material counts)
- The system is ticked **after** all other systems — AI reads post-tick state and queues commands for next tick
- No persistence (AI state is ephemeral — restarting AI from scratch on load is fine for MVP)

### 2. Decision Tree
**Files**: `src/game/features/ai-player/internal/ai-decision-tree.ts`, `src/game/features/ai-player/internal/ai-player-controller.ts`
**Key decisions**:
- Uses existing BT primitives from `src/game/ai/` with `T = AiPlayerController`
- Top-level tree structure (priority-based via `selector`):
  ```
  selector(
      guard(isGameOver,           action(doNothing)),
      guard(canPlaceNextBuilding, action(placeBuilding)),
      guard(canTrainSoldier,      action(trainSoldier)),
      guard(shouldAttack,         action(launchAttack)),
  )
  ```
- Each `guard` condition and `action` callback are thin wrappers that call into the economy/military planners
- The controller holds mutable state: `buildOrderIndex`, `attackTarget`, `ticksSinceEval`, `soldierIds: Set<number>`
- `evaluate()` is called every `evaluationInterval` ticks (default 30) — it ticks the BT root node once
- The decision tree is constructed once per controller at creation time — conditions close over the controller instance
- Easy to extend: adding "defend when under attack" = `guard(isUnderAttack, action(defend))` inserted before the attack guard

### 3. Economy Planner
**Files**: `src/game/features/ai-player/internal/economy-planner.ts`
**Key decisions**:
- Uses `spiralSearch` from the castle position to find valid building positions within territory
- Checks `canPlaceBuildingFootprint` before issuing `place_building` command (same validation as human player)
- Walks the build order array: tracks how many of each step have been placed vs. required count. When current step is satisfied, advances `buildOrderIndex`.
- Places one building per evaluation cycle (avoid overwhelming logistics)
- The controller does NOT wait for buildings to finish construction before placing the next one — it queues buildings eagerly
- Mines require rock terrain — economy planner searches for existing rock tiles near the castle
- If placement fails (no valid position), skip and retry next evaluation

### 4. Military Planner
**Files**: `src/game/features/ai-player/internal/military-planner.ts`
**Key decisions**:
- Once a barracks exists and has weapons available, issue `recruit_specialist` commands to train swordsmen
- Soldiers are tracked by querying `entityIndex.idsOfTypeAndPlayer(EntityType.Unit, player)` and filtering by `isUnitTypeMilitary()`
- Attack trigger: when the AI has accumulated >= 5 idle military units, send them all to the nearest enemy castle
- Target selection: find the nearest enemy castle by iterating enemy player buildings
- Attack = issue `move_unit` command for each soldier toward the enemy castle position. Combat system handles engagement automatically when units get close to enemies.
- After an attack wave is sent, reset counter and accumulate more soldiers

### 5. Build Orders
**Files**: `src/game/features/ai-player/internal/build-orders.ts`
**Key decisions**:
- Pure data — no logic, just arrays of `BuildStep` per race
- Common core shared by all races (first ~80% of the build order is identical):
  1. WoodcutterHut x2, ForesterHut x1, Sawmill x1 (wood/boards)
  2. StonecutterHut x1 (stone)
  3. ResidenceSmall x1 (carriers)
  4. GrainFarm x1, Mill x1, Bakery x1, WaterworkHut x1 (bread chain)
  5. **Race-specific drink chain** (see below)
  6. CoalMine x1, IronMine x1 (ore)
  7. IronSmelter x1, WeaponSmith x1 (weapons)
  8. Barrack x1 (training)
  9. ResidenceSmall x1 (more carriers)
- Race-specific drink chains:
  - **Roman**: Vinyard x1 (produces Wine directly from grapes)
  - **Viking**: BeekeeperHut x1, MeadMakerHut x1 (Honey → Mead)
  - **Mayan**: AgaveFarmerHut x1, TequilaMakerHut x1 (Agave → Tequila)
  - **Trojan**: SunflowerFarmerHut x1, SunflowerOilMakerHut x1 (Sunflower → SunflowerOil)
- `getBuildOrder(race: Race): readonly BuildStep[]` — returns the full order with the race-specific section spliced in
- Exposed as importable data so tests can assert against it

### 6. World Queries
**Files**: `src/game/features/ai-player/internal/ai-world-queries.ts`
**Key decisions**:
- Pure functions that take `GameState` + `GameServices` and return data — no side effects
- `getPlayerBuildings(state, player, buildingType?)` — count/list buildings of a type
- `getPlayerMilitaryUnits(state, player)` — list idle military units (not in combat, not moving)
- `findNearestEnemyCastle(state, player, fromX, fromY)` — returns position or null
- `getPlayerCastlePosition(state, player)` — find the AI's own castle for spiral placement center
- `countOperationalBuildings(state, services, player, buildingType)` — buildings without construction sites

### 7. Integration Test
**Files**: `tests/unit/integration/ai/ai-game-simulation.spec.ts`
**Key decisions**:
- Uses `Simulation` harness with a larger map (256x256) and 2 players
- Each player gets a castle placed manually, then an AI controller is added
- Tests for each race: Roman vs Viking, Mayan vs Trojan, etc.
- `sim.runUntil(() => victorySystem.getResult().ended, { maxTicks: 300_000 })` — run until someone wins
- Intermediate assertions: after N ticks, check that AI has placed buildings, has soldiers, etc.
- Separate focused tests: "AI builds basic economy", "AI trains soldiers", "AI attacks enemy"
- At least one test per race to verify race-specific drink chains are built correctly

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/ai-player/index.ts` | 1 | Public barrel — exports feature definition + types |
| `src/game/features/ai-player/types.ts` | — | Shared types (AiPlayerConfig, AiPlayerState, BuildStep, etc.) |
| `src/game/features/ai-player/ai-player-feature.ts` | 1 | FeatureDefinition + AiPlayerExports |
| `src/game/features/ai-player/internal/ai-player-system.ts` | 1,2 | AiPlayerSystemImpl — TickSystem managing all controllers |
| `src/game/features/ai-player/internal/ai-player-controller.ts` | 2 | Per-player state + throttled evaluation |
| `src/game/features/ai-player/internal/ai-decision-tree.ts` | 2 | BT tree factory — builds the decision tree from BT primitives |
| `src/game/features/ai-player/internal/economy-planner.ts` | 3 | Build order execution + placement |
| `src/game/features/ai-player/internal/military-planner.ts` | 4 | Training + attack logic |
| `src/game/features/ai-player/internal/build-orders.ts` | 5 | Race-specific build order data tables |
| `src/game/features/ai-player/internal/ai-world-queries.ts` | 6 | Read-only game state queries |
| `tests/unit/integration/ai/ai-game-simulation.spec.ts` | 7 | Full game simulation test |

### Modified Files
| File | Change |
|------|--------|
| `src/game/game-services.ts` | Add `AiPlayerFeature` to `loadAll()` array (last tier — depends on everything) |
| `src/game/game-core.ts` | Add `setupAiPlayers()` method that adds AI controllers for non-human players after map load |

## Verification
1. **Economy bootstrap**: AI player (any race) places all buildings in the build order within ~5000 ticks on a flat test map. Inventories show materials flowing.
2. **Race-specific drink chain**: Each of the 4 races builds its correct drink production buildings (Vinyard / BeekeeperHut+MeadMakerHut / AgaveFarmerHut+TequilaMakerHut / SunflowerFarmerHut+SunflowerOilMakerHut).
3. **Soldier training**: After weapon smith produces swords and barracks has gold, soldiers appear within ~2000 ticks.
4. **Attack wave**: When AI accumulates 5+ soldiers, they move toward the enemy castle. Combat system engages them with any defenders.
5. **Full game**: Two AI players (different races) on a test map. Run headless until `victorySystem.getResult().ended === true`. One player wins. No crashes, no infinite loops.
