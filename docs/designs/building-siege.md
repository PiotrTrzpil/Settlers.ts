# Building Siege — Design

## Overview

Swordsmen can attack enemy garrison buildings (towers, castles). Defenders are ejected one at a time to fight at the door. Up to 2 attackers engage each defender simultaneously (via existing CombatSystem). When all defenders are dead and no garrison remains, the attacker enters and captures the building (ownership changes to attacker's player).

## Summary for Review

- **Interpretation**: Swordsmen walk to enemy tower/castle door. System ejects one defender at a time. CombatSystem handles the actual fighting (1 defender vs up to 2 attackers). When defender dies, next is ejected. When building is empty, an attacker enters → building changes player/race ownership.
- **Key decisions**:
  - New feature module `building-siege` with its own TickSystem — doesn't modify CombatSystem internals
  - Reacts to `combat:unitDefeated` to know when to eject next defender or capture
  - Siege state is per-building (not per-attacker) — one `SiegeState` tracks the building, its attackers, and current defender
  - Ownership change needs a new `GameState.changeEntityOwner()` method for EntityIndex re-indexing
  - The siege system force-assigns combat targets: tells attackers to fight the ejected defender by directly setting their CombatState
- **Assumptions**: No ranged siege (bowmen don't attack buildings). Building doesn't take structural damage — only garrison soldiers are fought. Ungarrisoned buildings are captured immediately when a swordsman arrives at the door.
- **Scope**: Core siege lifecycle only. No UI indicators, no sound effects, no building destruction on capture. Those are follow-ups.

## Conventions

- Optimistic programming: no `?.` on required deps, `getEntityOrThrow()`, throw with context
- Feature module pattern: `index.ts` barrel, `*-feature.ts` definition, `*-system.ts` tick system
- Events: `"siege:started"`, `"siege:defenderEjected"`, `"siege:buildingCaptured"` (past-tense)
- Config objects for 3+ constructor params
- TickSystems catch/log errors per-entity, don't throw
- Deterministic iteration: `sortedEntries()` on state maps
- Race is never optional — capture sets building race from `playerRaces.get(newPlayer)`

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Siege system | Per-tick siege lifecycle: track attackers, eject defenders, detect capture | — | `building-siege-system.ts` |
| 2 | Feature wiring | Event subscriptions, feature registration, command handlers | 1 | `building-siege-feature.ts`, `index.ts` |
| 3 | Ownership change | Re-index entity when player changes | — | `game-state.ts` (method addition) |
| 4 | Integration | Events, commands, game-services registration | 1,2 | `event-bus.ts`, `command-types.ts`, `game-services.ts` |

## Shared Contracts

```typescript
// ── Siege state (building-siege-system.ts) ──────────────────────────

export enum SiegePhase {
    /** Attackers approaching door, no defender ejected yet */
    Approaching = 0,
    /** Defender ejected, combat in progress */
    Fighting = 1,
    /** All defenders dead, attacker entering building */
    Capturing = 2,
}

export interface SiegeState {
    buildingId: number;
    /** Player who is attacking this building */
    attackerPlayer: number;
    phase: SiegePhase;
    /** Swordsman IDs committed to this siege (at door or approaching) */
    attackerIds: number[];
    /** Currently ejected defender entity ID (null if none yet or between defenders) */
    activeDefenderId: number | null;
}

// ── New events (event-bus.ts additions) ─────────────────────────────

'siege:started': {
    buildingId: number;
    attackerPlayer: number;
};

'siege:defenderEjected': {
    buildingId: number;
    defenderId: number;
};

'siege:buildingCaptured': {
    buildingId: number;
    oldPlayer: number;
    newPlayer: number;
};

// ── New command (command-types.ts addition) ──────────────────────────

/** Internal command: siege system captures a building (changes ownership). */
export interface CaptureBuildingCommand {
    type: 'capture_building';
    buildingId: number;
    newPlayer: number;
}

// ── GameState addition ──────────────────────────────────────────────

/** Re-index an entity under a new player. Updates entity.player, entity.race, and EntityIndex. */
public changeEntityOwner(entityId: number, newPlayer: number): void;
```

## Subsystem Details

### 1. Siege System (`building-siege-system.ts`)

**Files**: `src/game/features/building-siege/building-siege-system.ts`

**Config deps**: `gameState`, `eventBus`, `garrisonManager`, `combatSystem`, `visualService`, `executeCommand`

**Key decisions**:
- State map: `Map<number, SiegeState>` keyed by building ID (one siege per building)
- Swordsmen don't use CombatSystem's idle scan for buildings — siege is initiated externally (by the feature detecting swordsmen arriving at enemy garrison building doors)
- **Attacker arrival detection**: Subscribe to `unit:movementStopped`. If unit is a swordsman near an enemy garrison building door → begin or join siege.
- **Defender ejection**: Call `garrisonManager.ejectUnit()`. Then force-assign combat: set ejected unit and attackers (up to 2) into CombatSystem Fighting state targeting each other.
- **Defender death detection**: Subscribe to `combat:unitDefeated`. If the defeated entity is the active defender of a siege → eject next defender or transition to Capturing.
- **Capture**: When no defenders remain (garrison empty + no en-route), execute `capture_building` command.
- **Attacker death**: If an attacker dies during siege, remove from `attackerIds`. If no attackers left, cancel siege.
- **Max 2 attackers fighting**: Only first 2 in `attackerIds` get assigned as combatants against the defender. Others wait at door.
- **Tick check interval**: 10 ticks. Used for: detecting new swordsmen near enemy buildings (idle scan), checking if approaching attackers arrived.

**Behavior (non-obvious)**:
- When a defender is ejected, the siege system calls `combatSystem.releaseFromCombat()` on attackers first (they may be idle-scanning elsewhere), then manually sets their combat state to Fighting with targetId = defender. Similarly for the defender targeting the first attacker.
- Capturing an empty building (0 garrisoned, 0 en-route): swordsman arrives at door → immediate capture, no fighting phase.
- After capture: garrison is re-initialized for new owner via `garrisonManager.removeTower()` + `garrisonManager.initTower()`. The capturing swordsman is garrisoned into the building.

### 2. Feature Wiring (`building-siege-feature.ts`, `index.ts`)

**Files**: `src/game/features/building-siege/building-siege-feature.ts`, `src/game/features/building-siege/index.ts`

**Dependencies**: `['combat', 'tower-garrison', 'movement', 'settler-location']`

**Key decisions**:
- Subscribes to: `unit:movementStopped`, `combat:unitDefeated`, `building:removed`, `entity:removed` (via cleanupRegistry)
- `building:removed` → cancel any active siege on that building
- `entity:removed` (cleanup) → remove dead attackers from siege state
- Provides `capture_building` command handler
- System group: `'Military'`

### 3. Ownership Change (`game-state.ts`)

**Files**: `src/game/game-state.ts` (add `changeEntityOwner` method)

**Key decisions**:
- `changeEntityOwner(entityId, newPlayer)`: removes from old `(type, oldPlayer)` index, updates `entity.player` and `entity.race` (from `playerRaces.get(newPlayer)`), adds to new `(type, newPlayer)` index.
- Emits a new `'building:ownerChanged'` event with `{ entityId, buildingType, oldPlayer, newPlayer }` so territory and other features can react.

### 4. Integration (events, commands, game-services)

**Files**: `src/game/event-bus.ts`, `src/game/commands/command-types.ts`, `src/game/game-services.ts`

**Changes**:
- `event-bus.ts`: Add `siege:started`, `siege:defenderEjected`, `siege:buildingCaptured`, `building:ownerChanged` event types
- `command-types.ts`: Add `CaptureBuildingCommand` interface + add to `Command` union
- `game-services.ts`: Import + register `BuildingSiegeFeature` in `loadAll` (after tower-garrison, same tier). Extract `siegeSystem` export.
- `event-formatting.ts`: Add formatters for new events

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/building-siege/building-siege-system.ts` | 1 | Siege lifecycle tick system |
| `src/game/features/building-siege/building-siege-feature.ts` | 2 | Feature definition + wiring |
| `src/game/features/building-siege/index.ts` | 2 | Barrel exports |

### Modified Files
| File | Change |
|------|--------|
| `src/game/event-bus.ts` | Add 4 new event types |
| `src/game/commands/command-types.ts` | Add `CaptureBuildingCommand` + union member |
| `src/game/game-state.ts` | Add `changeEntityOwner()` method |
| `src/game/game-services.ts` | Register feature, extract `siegeSystem` export |
| `src/game/debug/event-formatting.ts` | Add formatters for 4 new events |

## Verification
1. **Swordsman attacks garrisoned tower**: Walks to door → defender ejected → fight → defender dies → next defender → all dead → building captured, now belongs to attacker's player
2. **Ungarrisoned building**: Swordsman walks to empty enemy tower door → immediate capture
3. **Attacker dies mid-siege**: Remove from siege. If last attacker, cancel siege. Remaining defenders stay garrisoned.
4. **Building destroyed during siege**: Siege cancelled, attackers return to idle
5. **Multiple attackers**: Only 2 fight the defender at once. When defender dies and next is ejected, the 2 closest re-engage.
