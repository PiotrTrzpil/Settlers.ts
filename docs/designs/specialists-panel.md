# Specialists Panel — Design

## Overview

Add a new **SP** (Specialists) tab to the left sidebar in `map-view.vue`. Each specialist row shows a live count plus ±1/±5 buttons. Clicking +N enqueues N recruitment requests. A new `SpecialistRecruitQueue` tick system drains that queue as idle carriers become available — assigning each carrier a transform job via the existing `UnitTransformer`. Thief uses a carrier but no tool (new direct-transform choreo path). The UI shows both queued (waiting for a carrier) and pending (carrier in transit) counts separately.

## Summary for Review

- **Interpretation**: A management panel for manually queueing specialist creation. Each row shows: live count, `+Q` queued (no carrier yet), `+P` pending (carrier walking to tool), and ±1/±5 buttons. Clicking +N adds to the queue; the `SpecialistRecruitQueue` tick system matches queued requests to idle carriers over time. All specialists — including Thief — go through a carrier transform. Thief just skips the tool pickup step.
- **Assumptions**: -1/-5 decrements the queue (if queued > 0, reduce queue; never cancels an in-flight transform). Race filtering applies. The queue is not persisted across saves (too transient). Carrier selection mirrors `AutoRecruitSystem` logic: nearest idle, non-reserved, non-logistics carrier for that player.
- **Architecture**: New `SpecialistRecruitQueue` TickSystem queues requests and drains them each tick interval. It owns the queue counts and exposes them for the UI. New `UnitTransformer.requestDirectTransform()` handles no-tool types (Thief). New `TRANSFORM_DIRECT` choreo task type emits `recruitment:completed` without touching a pile. A `recruit_specialist` command enqueues N requests. Composable reads queue + pending counts reactively.
- **Scope**: Includes SP tab, specialist icons, queue system, no-tool transform path, recruit command, composable, and panel component. Does NOT include persistence of the queue, per-type caps, or AI integration with existing AutoRecruitSystem.

## Project Conventions (extracted)

### Code Style
- Vue: `<script setup lang="ts">`, Composition API, `defineProps<{...}>()`
- Composables: named `use-<noun>.ts`, JSDoc header, explicit return type
- Commands: interface in `command-types.ts`, handler in `handlers/unit-handlers.ts`, registered in `register-handlers.ts`
- TickSystems: `*-system.ts` file, class implements `TickSystem`, never throw from `tick()` (catch + log)
- Managers: `*-manager.ts` or `*-queue.ts` — state containers, no `tick()`
- Line length: 140 chars TS, 150 chars Vue

### Error Handling (Optimistic)
- No `?.` on required dependencies — `!.` or direct access
- No silent fallbacks — trust stored IDs, throw with context
- Command handlers return `CommandResult` — never throw; use `commandFailed()` for user-visible failures
- `tick()` bodies are wrapped in try/catch that logs and swallows (never crash the game loop)

### Type Philosophy
- Required fields are non-optional; `private foo!: Bar` for definite assignment
- `satisfies` on feature exports object
- No `Pick`/`Omit` for public interfaces — explicit `interface` shapes

### Representative Pattern

```typescript
// AutoRecruitSystem — tick system pattern to follow for SpecialistRecruitQueue
export class AutoRecruitSystem implements TickSystem {
    private accumulatedTime = 0;

    tick(dt: number): void {
        this.accumulatedTime += dt;
        if (this.accumulatedTime < RECRUIT_CHECK_INTERVAL) return;
        this.accumulatedTime -= RECRUIT_CHECK_INTERVAL;
        try { this.runCheck(); } catch (e) { log.error('...', e); }
    }

    private runCheck(): void {
        // find idle carrier via query(carrierRegistry.store, gameState.store)
        // call unitTransformer.requestTransform(carrierId, type, material, x, y, player)
    }
}

// Vue command execution pattern (from GarrisonPanel.vue):
function recruit(unitType: UnitType, count: number): void {
    props.game?.execute({ type: 'recruit_specialist', unitType, count, player: ..., race: ... });
}
```

## Architecture

### Data Flow

```
User clicks +N
  → recruit_specialist command
  → SpecialistRecruitQueue.enqueue(unitType, count, toolMaterial, player, race)
      queued[unitType] += count

Each tick (interval ~1s):
  SpecialistRecruitQueue.tick():
    for each (unitType, queued) in queue where queued > 0:
      find idle carrier for that player
      if found AND toolMaterial !== null:
        unitTransformer.requestTransform(carrierId, unitType, toolMaterial, x, y, player)
        queue[unitType]--
      if found AND toolMaterial === null (Thief):
        unitTransformer.requestDirectTransform(carrierId, unitType, player)
        queue[unitType]--
      (if no idle carrier, leave in queue for next tick)

User clicks -N:
  recruit_specialist command with count = -N
  SpecialistRecruitQueue.dequeue(unitType, N)
    queued[unitType] = max(0, queued - N)  ← only reduces queue, never cancels in-flight

UI display (per-tick computed):
  liveCount   = entityIndex.count(Unit, player, subType === type)
  queuedCount = specialistQueue.getQueuedCount(type)
  pendingCount = unitTransformer.getPendingCountByType(type)
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Specialist palette | Static `SpecialistDef[]` with tool requirements | — | `src/views/palette-data.ts` |
| 2 | No-tool transform path | `TRANSFORM_DIRECT` choreo task + `UnitTransformer.requestDirectTransform()` | — | `src/game/features/auto-recruit/recruitment-job.ts`, `src/game/features/auto-recruit/unit-transformer.ts`, `src/game/features/settler-tasks/internal/inventory-executors.ts`, `src/game/features/settler-tasks/choreo-types.ts` |
| 3 | `SpecialistRecruitQueue` | Queue requests, drain to UnitTransformer each tick | 2 | `src/game/features/auto-recruit/specialist-recruit-queue.ts` |
| 4 | Feature wiring | Expose `unitTransformer` + `specialistQueue` on `GameServices`, wire queue into feature | 2, 3 | `src/game/features/auto-recruit/auto-recruit-feature.ts`, `src/game/game-services.ts` |
| 5 | `recruit_specialist` command | Enqueue/dequeue N requests | 3, 4 | `src/game/commands/command-types.ts`, `src/game/commands/handlers/unit-handlers.ts`, `src/game/commands/register-handlers.ts` |
| 6 | Specialist icons + sidebar state | Load icons for specialists, extend `activeTab` type | 1 | `src/views/use-map-view.ts`, `src/views/palette-data.ts` |
| 7 | `use-specialists` composable | Reactive live + queued + pending counts per type | 4 | `src/composables/use-specialists.ts` |
| 8 | `SpecialistsPanel.vue` + map-view wiring | Render specialist rows; add SP tab | 6, 7 | `src/components/SpecialistsPanel.vue`, `src/views/map-view.vue` |

## Shared Contracts (as code)

```typescript
// ── palette-data.ts ───────────────────────────────────────────────────────

export interface SpecialistDef {
    type: UnitType;
    id: string;
    name: string;
    icon: string;
    /** Tool the carrier must pick up. null = no tool needed (Thief). */
    toolMaterial: EMaterialType | null;
}

export const ALL_SPECIALISTS: SpecialistDef[] = [
    { type: UnitType.Builder,   id: 'builder',   name: 'Builder',   icon: '👷', toolMaterial: EMaterialType.HAMMER },
    { type: UnitType.Digger,    id: 'digger',     name: 'Digger',    icon: '🕳️', toolMaterial: EMaterialType.SHOVEL },
    { type: UnitType.Geologist, id: 'geologist',  name: 'Geologist', icon: '🔍', toolMaterial: EMaterialType.PICKAXE },
    { type: UnitType.Pioneer,   id: 'pioneer',    name: 'Pioneer',   icon: '🚩', toolMaterial: EMaterialType.SHOVEL },
    { type: UnitType.Gardener,  id: 'gardener',   name: 'Gardener',  icon: '🌱', toolMaterial: EMaterialType.SHOVEL },
    { type: UnitType.Thief,     id: 'thief',      name: 'Thief',     icon: '🥷', toolMaterial: null },
];

// ── choreo-types.ts addition ──────────────────────────────────────────────

// Add to ChoreoTaskType enum:
TRANSFORM_DIRECT = 'TRANSFORM_DIRECT',  // transform in place, no tool pile

// ── unit-transformer.ts additions ────────────────────────────────────────

// New public method:
requestDirectTransform(carrierId: number, targetUnitType: UnitType, player: number): boolean;
// Behavior: reserve carrier, assign direct-transform choreo job (no pile),
// add to this.pending with pileEntityId = -1 as sentinel.

// ── specialist-recruit-queue.ts ───────────────────────────────────────────

export interface SpecialistQueueEntry {
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    count: number;
}

export class SpecialistRecruitQueue implements TickSystem {
    enqueue(unitType: UnitType, count: number, toolMaterial: EMaterialType | null, player: number, race: Race): void;
    /** Reduces queued count by up to `count`. Never goes below zero. */
    dequeue(unitType: UnitType, count: number): void;
    getQueuedCount(unitType: UnitType): number;
    tick(dt: number): void;  // drains queue by finding idle carriers
}

// ── command-types.ts addition ─────────────────────────────────────────────

export interface RecruitSpecialistCommand {
    type: 'recruit_specialist';
    unitType: UnitType;
    /** Positive = enqueue N. Negative = dequeue N (e.g. -1 for the -1 button). */
    count: number;
    player: number;
    race: Race;
}
// Add to GameCommand union: | RecruitSpecialistCommand

// ── auto-recruit-feature.ts exports addition ──────────────────────────────

export interface AutoRecruitExports {
    autoRecruitSystem: AutoRecruitSystem;
    unitTransformer: UnitTransformer;
    specialistQueue: SpecialistRecruitQueue;  // NEW
}

// ── game-services.ts additions ────────────────────────────────────────────

import type { UnitTransformer } from './features/auto-recruit';
import type { SpecialistRecruitQueue } from './features/auto-recruit/specialist-recruit-queue';

public readonly unitTransformer: UnitTransformer;      // NEW
public readonly specialistQueue: SpecialistRecruitQueue; // NEW

// ── use-specialists.ts ────────────────────────────────────────────────────

export interface SpecialistEntry {
    type: UnitType;
    id: string;
    name: string;
    icon: string;
    toolMaterial: EMaterialType | null;
    liveCount: number;
    queuedCount: number;   // in SpecialistRecruitQueue (no carrier yet)
    pendingCount: number;  // in UnitTransformer (carrier walking)
}

export function useSpecialists(
    game: Ref<Game | null>,
    tick: Ref<number>,
    race: Ref<Race>,
): ComputedRef<SpecialistEntry[]>;
```

## Subsystem Details

### Subsystem 1: Specialist Palette (`palette-data.ts`)

**Files**: `src/views/palette-data.ts`
**Owns**: `SpecialistDef` type and `ALL_SPECIALISTS` array
**Key decisions**:
- `toolMaterial: null` for Thief — handled differently by `UnitTransformer.requestDirectTransform()`
- Race filtering happens in the composable via `isUnitAvailableForRace(type, race)`, not here
- Digger and Builder included — this is the manual-creation surface for all worker specialists, even those auto-recruit handles

**Behavior**: Append `SpecialistDef` interface and `ALL_SPECIALISTS` array after the existing `ALL_UNITS` export.

---

### Subsystem 2: No-tool transform path

**Files**:
- `src/game/features/settler-tasks/choreo-types.ts` — add `TRANSFORM_DIRECT` to `ChoreoTaskType` enum
- `src/game/features/auto-recruit/recruitment-job.ts` — add `createDirectTransformJob()` and `executeTransformDirect()`
- `src/game/features/settler-tasks/internal/inventory-executors.ts` — register `TRANSFORM_DIRECT` executor
- `src/game/features/auto-recruit/unit-transformer.ts` — add `requestDirectTransform()`

**Owns**: Carrier-to-specialist transform without any tool pile interaction

**Key decisions**:
- `createDirectTransformJob(targetUnitType)` builds a choreo job with only a single `TRANSFORM_DIRECT` node (no `GO_TO_TARGET`). The carrier transforms in place on the current tick — no walking.
- `executeTransformDirect(settler, job, ...)` just emits `recruitment:completed` immediately. No pile lookup, no inventory withdrawal.
- `UnitTransformer.requestDirectTransform(carrierId, targetUnitType, player)`:
  - Assigns the direct transform job via `settlerTaskSystem.assignJob()`
  - Reserves the carrier with `purpose: 'unit-transform'`
  - Adds to `this.pending` using `pileEntityId: -1` as a sentinel (no real pile)
  - The existing `handleCompleted` handler works unchanged because it doesn't use `pileEntityId` after the pilot finishes — it only uses it to call `toolSourceResolver.release()`. Add a guard: `if (p.pileEntityId !== -1) this.toolSourceResolver.release(p.pileEntityId)`.
- `requestDirectTransform` returns `boolean` (false if job assignment failed)

**Behavior**:
```typescript
// recruitment-job.ts addition:
export function createDirectTransformJob(targetUnitType: UnitType): ChoreoJobState {
    const nodes: ChoreoNode[] = [{ task: ChoreoTaskType.TRANSFORM_DIRECT, /* defaults */ }];
    const job = createChoreoJobState('AUTO_RECRUIT', nodes);
    job.carryingGood = targetUnitType as unknown as EMaterialType;
    return job;
}

export function executeTransformDirect(settler: Entity, job: ChoreoJobState, _node: ChoreoNode, _dt: number, ctx: ControlContext): TaskResult {
    const targetUnitType = job.carryingGood as unknown as UnitType;
    ctx.eventBus.emit('recruitment:completed', { carrierId: settler.id, targetUnitType });
    return TaskResult.DONE;
}
```

---

### Subsystem 3: `SpecialistRecruitQueue`

**Files**: `src/game/features/auto-recruit/specialist-recruit-queue.ts`
**Owns**: Queue state, tick-based drain logic, idle carrier selection

**Key decisions**:
- Implements `TickSystem` with a `DRAIN_INTERVAL = 0.5` second check (more responsive than AutoRecruitSystem's 1.0s)
- Queue is `Map<UnitType, SpecialistQueueEntry>` — one entry per type (not a list), `count` field
- `enqueue(type, count, ...)`: if entry exists, add to `count`; else create new entry
- `dequeue(type, count)`: `entry.count = Math.max(0, entry.count - count)`; delete entry if count reaches 0
- Drain loop: for each queued type, try to find one idle carrier and dispatch one request; repeat until no carrier found or count reaches 0
- Idle carrier selection: same logic as `AutoRecruitSystem.findIdleCarrier()` — nearest carrier for that player that is neither reserved nor has an active logistics job
- Uses `query(carrierRegistry.store, gameState.store)` for carrier iteration (same ECS pattern as AutoRecruitSystem)
- `getQueuedCount(type): number` — returns `entry?.count ?? 0`

**Config interface**:
```typescript
export interface SpecialistRecruitQueueConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
    unitTransformer: UnitTransformer;
    unitReservation: UnitReservationRegistry;
    isCarrierBusy: (carrierId: number) => boolean;
}
```

---

### Subsystem 4: Feature wiring

**Files**:
- `src/game/features/auto-recruit/auto-recruit-feature.ts` — create `SpecialistRecruitQueue`, add to systems and exports
- `src/game/game-services.ts` — extract and expose `unitTransformer` and `specialistQueue`

**`auto-recruit-feature.ts` changes**:
1. Import `SpecialistRecruitQueue`
2. Instantiate: `const specialistQueue = new SpecialistRecruitQueue({ gameState, eventBus, carrierRegistry, unitTransformer, unitReservation, isCarrierBusy })`
3. Add to `systems: [autoRecruitSystem, specialistQueue]`
4. Add to `exports: { autoRecruitSystem, unitTransformer, specialistQueue } satisfies AutoRecruitExports`

**`game-services.ts` changes**:
1. Import `UnitTransformer` type from `'./features/auto-recruit'`
2. Import `SpecialistRecruitQueue` type
3. Add `public readonly unitTransformer: UnitTransformer;` and `public readonly specialistQueue: SpecialistRecruitQueue;` fields
4. In constructor section 3: extract alongside `autoRecruitSystem`:
   ```typescript
   const arExports = this.feat<AutoRecruitExports>('auto-recruit');
   this.autoRecruitSystem = arExports.autoRecruitSystem;
   this.unitTransformer = arExports.unitTransformer;
   this.specialistQueue = arExports.specialistQueue;
   ```

---

### Subsystem 5: `recruit_specialist` command

**Files**:
- `src/game/commands/command-types.ts` — add `RecruitSpecialistCommand`, add to union
- `src/game/commands/handlers/unit-handlers.ts` — add handler
- `src/game/commands/register-handlers.ts` — register handler

**Handler logic**:
```typescript
function handleRecruitSpecialist(cmd: RecruitSpecialistCommand, ctx: CommandContext): CommandResult {
    const def = ALL_SPECIALISTS.find(s => s.type === cmd.unitType);
    if (!def) return commandFailed(`Unknown specialist type: ${UnitType[cmd.unitType]}`);

    if (cmd.count > 0) {
        ctx.services.specialistQueue.enqueue(cmd.unitType, cmd.count, def.toolMaterial, cmd.player, cmd.race);
    } else if (cmd.count < 0) {
        ctx.services.specialistQueue.dequeue(cmd.unitType, -cmd.count);
    }

    return { success: true };
}
```

**Key decisions**:
- Handler is stateless — all logic is in `SpecialistRecruitQueue`
- No error if nothing was queued (e.g. no carriers will ever come) — optimistic, silent
- `count` uses sign to encode enqueue vs dequeue (avoids two separate command types)
- Import `ALL_SPECIALISTS` from `'@/views/palette-data'` — acceptable since this is a dev-tool/debug command, not deep game logic; alternatively duplicate the tool-material mapping inline if import direction is wrong (views → game is backward). **Prefer**: extract `SPECIALIST_TOOL_MAP: Record<UnitType, EMaterialType | null>` into `src/game/features/auto-recruit/specialist-tool-map.ts` and import that from both `palette-data.ts` and the handler.

---

### Subsystem 6: Specialist icons + sidebar state

**Files**: `src/views/use-map-view.ts`, `src/views/palette-data.ts`

**`use-map-view.ts` changes**:
1. Add `specialistIcons: Ref<Record<string, IconEntry>>` ref
2. Extend `VALID_TABS` set to include `'specialists'` and extend the type union
3. In `setupIconLoading()`: add `loadUnitIcons(fm, race, ALL_SPECIALISTS)` watches (same pattern as `unitIcons`)
4. Return `specialistIcons` from `useMapView()`

**Notes**: `loadUnitIcons()` accepts `{ id: string; type: UnitType }[]` — `ALL_SPECIALISTS` satisfies this shape. No changes to the icon loader needed.

---

### Subsystem 7: `use-specialists.ts` composable

**Files**: `src/composables/use-specialists.ts`
**Owns**: Reactive per-type counts (live + queued + pending), race filtering

```typescript
/**
 * Composable for the SP (Specialists) panel.
 *
 * Returns reactive specialist entries for all specialist types available
 * to the current race. Each entry includes live count, queued count
 * (waiting for a carrier in SpecialistRecruitQueue), and pending count
 * (carrier currently walking to a tool pile).
 */
export function useSpecialists(
    game: Ref<Game | null>,
    tick: Ref<number>,
    race: Ref<Race>,
): ComputedRef<SpecialistEntry[]>
```

**Behavior**:
- `void tick.value;` at top of computed to re-evaluate each frame
- For each specialist in `ALL_SPECIALISTS`, check `isUnitAvailableForRace(type, race.value)` — skip if false
- `liveCount`: iterate `game.state.entities`, count `type === EntityType.Unit && subType === unitType && player === game.currentPlayer`
- `queuedCount`: `game.services.specialistQueue.getQueuedCount(type)`
- `pendingCount`: `game.services.unitTransformer.getPendingCountByType(type)`
- Returns empty array when `game.value` is null

---

### Subsystem 8: `SpecialistsPanel.vue` + map-view wiring

**Files**: `src/components/SpecialistsPanel.vue`, `src/views/map-view.vue`

**`SpecialistsPanel.vue` props**:
```typescript
defineProps<{
    game: Game | null;
    race: Race;
    specialistIcons: Record<string, IconEntry>;
}>();
```

**Layout per row**:
```
[icon] Geologist   3 (+2 +1)   [-5] [-1] [+1] [+5]
                   ↑live  ↑queued+pending
```
- Count display: `liveCount` then `(+N)` where N = `queuedCount + pendingCount` when N > 0
- Tooltip on the `(+N)`: `"Q: ${queuedCount} queued, P: ${pendingCount} in transit"`
- +1/+5: `game.execute({ type: 'recruit_specialist', unitType, count: 1 or 5, player: game.currentPlayer, race })`
- -1/-5: `game.execute({ type: 'recruit_specialist', unitType, count: -1 or -5, player: game.currentPlayer, race })`
- -N buttons are disabled when `queuedCount === 0` (nothing to cancel in the queue)

**`map-view.vue` changes**:
1. Add SP tab button: `<button class="tab-btn" :class="{ active: activeTab === 'specialists' }" @click="activeTab = 'specialists'">SP</button>`
2. Add content block: `<div v-if="activeTab === 'specialists'" class="tab-content"><specialists-panel :game="game" :race="currentRace" :specialistIcons="specialistIcons" /></div>`
3. Import `SpecialistsPanel`; receive `specialistIcons` from `useMapView()` destructure

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/auto-recruit/specialist-recruit-queue.ts` | 3 | Queue + tick drain for specialist recruitment requests |
| `src/game/features/auto-recruit/specialist-tool-map.ts` | 5 | `SPECIALIST_TOOL_MAP` — game-side tool requirement table |
| `src/composables/use-specialists.ts` | 7 | Reactive live + queued + pending counts per specialist type |
| `src/components/SpecialistsPanel.vue` | 8 | SP tab UI — rows with icon, count, and ±1/±5 buttons |

### Modified Files

| File | Change |
|------|--------|
| `src/views/palette-data.ts` | Add `SpecialistDef` interface and `ALL_SPECIALISTS` array |
| `src/game/features/settler-tasks/choreo-types.ts` | Add `TRANSFORM_DIRECT` to `ChoreoTaskType` enum |
| `src/game/features/auto-recruit/recruitment-job.ts` | Add `createDirectTransformJob()` and `executeTransformDirect()` |
| `src/game/features/settler-tasks/internal/inventory-executors.ts` | Register `TRANSFORM_DIRECT` executor |
| `src/game/features/auto-recruit/unit-transformer.ts` | Add `requestDirectTransform()`; guard `toolSourceResolver.release()` for `pileEntityId === -1` |
| `src/game/features/auto-recruit/auto-recruit-feature.ts` | Create `SpecialistRecruitQueue`; add to systems and exports |
| `src/game/features/auto-recruit/index.ts` | Re-export `SpecialistRecruitQueue` and `AutoRecruitExports` update |
| `src/game/game-services.ts` | Add `unitTransformer` and `specialistQueue` fields; extract from auto-recruit exports |
| `src/game/commands/command-types.ts` | Add `RecruitSpecialistCommand`; add to `GameCommand` union |
| `src/game/commands/handlers/unit-handlers.ts` | Add `handleRecruitSpecialist()` |
| `src/game/commands/register-handlers.ts` | Register `'recruit_specialist'` handler |
| `src/views/use-map-view.ts` | Add `specialistIcons`, extend `activeTab` type to include `'specialists'` |
| `src/views/map-view.vue` | Add SP tab button and `SpecialistsPanel` content block |

## Verification

- Load test map. SP tab appears in left sidebar.
- Click SP — panel shows 6 rows: Builder, Digger, Geologist, Pioneer, Gardener, Thief, all showing count 0.
- Click +1 on Builder with a carrier on map: carrier walks to nearest hammer pile and transforms. Count shows `0 (+1)` during transform, then `1` after.
- Click +5 on Geologist with 1 idle carrier: 1 starts walking to pickaxe pile immediately; 4 remain in queue showing `0 (+5)`. As carriers finish other tasks and go idle, queue drains.
- Click +1 then -1 on Pioneer: queued shows +1 then 0 (decrement cancels the queue entry).
- Click +1 on Thief: carrier transforms in place (no walking to pile). Thief appears immediately or after 1 tick.
- -N buttons disabled when nothing queued (nothing to dequeue).
- Specialist icons load from sprite files; emoji fallback renders when assets unavailable.
