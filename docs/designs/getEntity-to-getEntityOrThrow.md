# getEntity → getEntityOrThrow Migration — Design

## Overview

Migrate ~80 internal `getEntity()` calls to `getEntityOrThrow('context')` to enforce the project's optimistic programming rules. Silent `undefined` returns on stored entity IDs hide bugs; throwing with context surfaces them immediately.

## Current State

- **102 `getEntity()` calls** vs 53 `getEntityOrThrow()` — ratio should be inverted
- Many internal systems defensively check `if (!entity)` after looking up an ID they stored themselves — this is a contract violation per `docs/optimistic.md`
- Some calls are legitimately defensive (scripting API, tick-loop cleanup, UI, tests)

## Summary for Review

- **Interpretation**: Mechanically replace `getEntity()` → `getEntityOrThrow('context')` wherever the caller stored the entity ID and expects it to exist. Remove the now-dead defensive branches.
- **Key decisions**:
  - **Tick-loop cleanup is legitimate**: Systems iterating their own state maps (combat, logistics) may encounter entities removed mid-tick. These use `getEntity()` + `if (!entity) { delete; continue }` correctly — this is not a workaround.
  - **Command handlers should throw**: Command entity IDs are validated at dispatch; handlers should trust them.
  - **Tests stay as-is**: Test code uses `getEntity()` with `!` or `.toBeDefined()` assertions — no change needed.
  - **Scripting API stays as-is**: Lua scripts are an external boundary — defensive checks are correct.
- **Assumptions**: No `getEntity()` call in production code needs a new `| undefined` return path — if the entity is gone when it shouldn't be, we want a crash.
- **Scope**: Only `getEntity()` → `getEntityOrThrow()` conversions. No new APIs, no structural changes. ~80 call sites across ~35 files.

## Conventions

- `getEntityOrThrow(id, 'descriptive context')` — always include context string describing what the ID represents (e.g., `'source building in carrier dropoff'`, `'settler in task system'`)
- Remove dead `if (!entity)` branches entirely — don't leave empty blocks or comments
- No `!` non-null assertions on entity lookups — use `getEntityOrThrow` instead
- No `?.` on the returned entity — it's guaranteed non-null
- Keep line length ≤ 140 chars; if the context string makes it too long, use a shorter but still descriptive context

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Logistics & Inventory | Transport, supply, fulfillment, inventory, bottleneck | — | 14 files |
| 2 | Settler Tasks & Jobs | Task system, executors, worker tracking, job lifecycle | — | 10 files |
| 3 | Combat & Military | Combat system, siege, tower garrison | — | 12 files |
| 4 | Building Systems | Construction, demand, lifecycle, overlays, triggers | — | 10 files |
| 5 | Commands & Input | Command handlers, selection, input modes | — | 5 files |
| 6 | Miscellaneous | AI, CLI, victory, territory, recruit, carrier registry | — | 8 files |

All subsystems are independent — no cross-subsystem dependencies for this refactoring.

## Shared Contracts

No new types or signatures. The only contract is the existing:

```typescript
// Already exists in game-state.ts — no changes needed
public getEntityOrThrow(id: number, context?: string): Entity
```

**Pattern to apply everywhere:**

```typescript
// BEFORE — defensive check on stored ID
const entity = this.gameState.getEntity(storedId);
if (!entity) {
    return; // or continue, or return failure
}
entity.doSomething();

// AFTER — trust the contract
const entity = this.gameState.getEntityOrThrow(storedId, 'description of what storedId represents');
entity.doSomething();
```

## Decision Guide: getEntity vs getEntityOrThrow

**Use `getEntityOrThrow`** when:
- The ID was stored by your system (registry, state map field, job data, class field)
- The ID came from a command (commands are validated at dispatch)
- The ID came from an event payload (event source guarantees existence)

**Keep `getEntity`** when:
- **Tick-loop cleanup**: Iterating a state map where entries may reference entities removed earlier in the same tick — `if (!entity) { map.delete(id); continue; }` is correct
- **External boundary**: Scripting API (Lua), user input, external queries
- **UI/render**: Selection panel, overlay resolution, computed properties
- **Tests**: Test assertions with `!` or `.toBeDefined()`
- **Existence checks**: Pure `if (gameState.getEntity(id))` used only to check liveness, not to use the entity

## Subsystem Details

### 1. Logistics & Inventory
**Files**:
- `src/game/features/logistics/match-diagnostics.ts`
- `src/game/features/logistics/fulfillment-diagnostics.ts`
- `src/game/features/logistics/logistics-snapshot.ts` (4 calls)
- `src/game/features/logistics/resource-supply.ts`
- `src/game/features/logistics/carrier-assigner.ts` (3 calls)
- `src/game/features/logistics/fulfillment-matcher.ts` (3 calls, but line ~263 is a pure existence check — keep as `getEntity`)
- `src/game/features/logistics/bottleneck-detection.ts` (2 calls)
- `src/game/features/logistics/transport-job-service.ts`
- `src/game/features/material-transfer/material-transfer.ts`
- `src/game/features/material-requests/material-request-system.ts` (2 calls)
- `src/game/systems/inventory/building-inventory-helpers.ts` (2 calls)
- `src/game/systems/inventory/building-inventory.ts` (2 calls)

**Key decisions**:
- `fulfillment-matcher.ts:263` — pure existence check (`if (!gameState.getEntity(id))`) to skip stale requests. Keep as `getEntity` — this is intentional liveness filtering.
- All other calls have stored IDs (request.buildingId, carrierId from registry, slot.entityId) — convert to `getEntityOrThrow`.

### 2. Settler Tasks & Jobs
**Files**:
- `src/game/features/settler-tasks/settler-task-system.ts` (~10 calls)
- `src/game/features/settler-tasks/internal/control-executors.ts`
- `src/game/features/settler-tasks/internal/movement-executors.ts`
- `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts`
- `src/game/features/settler-tasks/worker-task-executor.ts`
- `src/game/features/settler-tasks/building-worker-tracker.ts` (2 calls)
- `src/game/features/settler-location/settler-building-location-manager.ts`

**Key decisions**:
- `settler-task-system.ts:550` — checks if building still exists during task cleanup. If this is a tick-loop cleanup pattern, keep as `getEntity`. If it's a stored ID that must exist, convert.
- `movement-executors.ts:393` — target may be destroyed between job creation and execution. This is a mid-action check — **keep as `getEntity`** since the target is a remote entity that can be independently destroyed.

### 3. Combat & Military
**Files**:
- `src/game/features/combat/combat-system.ts` (3 calls)
- `src/game/features/combat/combat-feature.ts`
- `src/game/features/building-siege/building-siege-system.ts` (5 calls)
- `src/game/features/building-siege/building-siege-feature.ts`
- `src/game/features/building-siege/siege-helpers.ts`
- `src/game/features/tower-garrison/tower-garrison-feature.ts`
- `src/game/features/tower-garrison/tower-garrison-manager.ts` (3 calls)
- `src/game/features/tower-garrison/internal/tower-bowman-render-pass.ts`
- `src/game/features/tower-garrison/internal/garrison-commands.ts` (4 calls)
- `src/game/features/tower-garrison/internal/tower-combat-system.ts`

**Key decisions**:
- `combat-system.ts:136` — **keep as `getEntity`**. This is the tick-loop cleanup pattern: iterating `this.states` map, entities may be removed mid-tick. The `if (!entity) { delete; continue }` is correct.
- `combat-system.ts:379` (target lookup) — target may have died. If this is a `state.targetId` lookup during pursuit/attack, the target can be independently killed. **Keep as `getEntity`** and handle gracefully.
- All garrison and siege stored IDs (towerId, unitId, bowmanId, buildingId from registries) → convert to `getEntityOrThrow`.

### 4. Building Systems
**Files**:
- `src/game/features/building-construction/residence-spawner.ts`
- `src/game/features/building-construction/construction-system.ts` (2 calls)
- `src/game/features/building-construction/building-lifecycle-feature.ts`
- `src/game/features/building-demand/building-demand-system.ts` (2 calls)
- `src/game/features/building-overlays/building-overlay-feature.ts`
- `src/game/features/building-overlays/trigger-system.ts` (2 calls)
- `src/game/input/modes/building-adjust-mode.ts`

**Key decisions**:
- `construction-system.ts:444` — tickEvacuation checking if building still exists. If the building can be cancelled/demolished during evacuation, this is a legitimate existence check — **keep as `getEntity`**.
- `building-demand-system.ts:184` — pure existence check for building liveness. **Keep as `getEntity`** if it's filtering stale demand entries.
- All event-handler lookups (onBuildingPlaced, onBuildingCompleted) with stored buildingId → convert to `getEntityOrThrow`.

### 5. Commands & Input
**Files**:
- `src/game/commands/handlers/selection-handlers.ts` (5 calls)
- `src/game/commands/handlers/unit-handlers.ts`
- `src/game/commands/handlers/building-handlers.ts`

**Key decisions**:
- Command `entityId` values come from validated commands. Convert all to `getEntityOrThrow(cmd.entityId, 'command target')`.
- `selection-handlers.ts:78,95` — iterating `cmd.entityIds`/`cmd.candidateIds`. These IDs come from the selection, which was valid at command creation. Convert to `getEntityOrThrow`.

### 6. Miscellaneous
**Files**:
- `src/game/features/ai-player/internal/ai-world-queries.ts`
- `src/game/features/recruit/recruit-choreo-executors.ts`
- `src/game/features/victory-conditions/victory-conditions-system.ts`
- `src/game/features/territory/territory-feature.ts`
- `src/game/systems/carrier-registry.ts`
- `src/game/cli/commands/queries.ts` (2 calls)

**Key decisions**:
- `recruit-choreo-executors.ts:38` — pile target may have been destroyed mid-recruitment. **Keep as `getEntity`** — this is a mid-action target that can be independently removed.
- `victory-conditions-system.ts:159` — iterating tracked set, entity may have been removed. **Keep as `getEntity`** if it's a cleanup loop.
- `carrier-registry.ts:32` — defensive check on stored entityId. Convert to `getEntityOrThrow`.

## File Map

### Modified Files

| File | Subsystem | Change |
|------|-----------|--------|
| `src/game/features/logistics/match-diagnostics.ts` | 1 | 1 call → getEntityOrThrow |
| `src/game/features/logistics/fulfillment-diagnostics.ts` | 1 | 1 call → getEntityOrThrow |
| `src/game/features/logistics/logistics-snapshot.ts` | 1 | 4 calls → getEntityOrThrow |
| `src/game/features/logistics/resource-supply.ts` | 1 | 1 call → getEntityOrThrow |
| `src/game/features/logistics/carrier-assigner.ts` | 1 | 3 calls → getEntityOrThrow |
| `src/game/features/logistics/fulfillment-matcher.ts` | 1 | 2 of 3 calls → getEntityOrThrow (keep existence check) |
| `src/game/features/logistics/bottleneck-detection.ts` | 1 | 2 calls → getEntityOrThrow |
| `src/game/features/logistics/transport-job-service.ts` | 1 | 1 call → getEntityOrThrow |
| `src/game/features/material-transfer/material-transfer.ts` | 1 | 1 call → getEntityOrThrow |
| `src/game/features/material-requests/material-request-system.ts` | 1 | 2 calls → getEntityOrThrow |
| `src/game/systems/inventory/building-inventory-helpers.ts` | 1 | 2 calls → getEntityOrThrow |
| `src/game/systems/inventory/building-inventory.ts` | 1 | 2 calls → getEntityOrThrow |
| `src/game/features/settler-tasks/settler-task-system.ts` | 2 | ~8 of 10 calls → getEntityOrThrow |
| `src/game/features/settler-tasks/internal/control-executors.ts` | 2 | 1 call → getEntityOrThrow |
| `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts` | 2 | 1 call → getEntityOrThrow |
| `src/game/features/settler-tasks/worker-task-executor.ts` | 2 | 1 call → getEntityOrThrow |
| `src/game/features/settler-tasks/building-worker-tracker.ts` | 2 | 2 calls → getEntityOrThrow |
| `src/game/features/settler-location/settler-building-location-manager.ts` | 2 | 1 call → getEntityOrThrow |
| `src/game/features/combat/combat-feature.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/building-siege/building-siege-system.ts` | 3 | 3-4 of 5 calls → getEntityOrThrow |
| `src/game/features/building-siege/building-siege-feature.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/building-siege/siege-helpers.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | 3 | 3 calls → getEntityOrThrow |
| `src/game/features/tower-garrison/internal/tower-bowman-render-pass.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/tower-garrison/internal/garrison-commands.ts` | 3 | 4 calls → getEntityOrThrow |
| `src/game/features/tower-garrison/internal/tower-combat-system.ts` | 3 | 1 call → getEntityOrThrow |
| `src/game/features/building-construction/residence-spawner.ts` | 4 | 1 call → getEntityOrThrow |
| `src/game/features/building-construction/building-lifecycle-feature.ts` | 4 | 1 call → getEntityOrThrow |
| `src/game/features/building-demand/building-demand-system.ts` | 4 | 1 of 2 calls → getEntityOrThrow |
| `src/game/features/building-overlays/building-overlay-feature.ts` | 4 | 1 call → getEntityOrThrow |
| `src/game/features/building-overlays/trigger-system.ts` | 4 | 2 calls → getEntityOrThrow |
| `src/game/input/modes/building-adjust-mode.ts` | 4 | 1 call → getEntityOrThrow |
| `src/game/commands/handlers/selection-handlers.ts` | 5 | 5 calls → getEntityOrThrow |
| `src/game/commands/handlers/unit-handlers.ts` | 5 | 1 call → getEntityOrThrow |
| `src/game/commands/handlers/building-handlers.ts` | 5 | 1 call → getEntityOrThrow |
| `src/game/features/ai-player/internal/ai-world-queries.ts` | 6 | 1 call → getEntityOrThrow |
| `src/game/systems/carrier-registry.ts` | 6 | 1 call → getEntityOrThrow |
| `src/game/cli/commands/queries.ts` | 6 | 2 calls → getEntityOrThrow |

### Unchanged Files (legitimate getEntity usage)
- `src/game/scripting/api/settlers-api.ts` — external boundary
- `src/game/scripting/api/buildings-api.ts` — external boundary
- `src/game/features/combat/combat-system.ts:136` — tick-loop cleanup
- `src/composables/*` — UI boundary
- `src/components/use-renderer/overlay-resolution.ts` — render boundary
- `src/game/features/victory-conditions/victory-conditions-feature.ts` — event cleanup
- All test files

## Verification

1. `pnpm lint` passes — no type errors from removed `| undefined` branches
2. `pnpm test:unit` passes — no regressions from removed defensive paths
3. Grep confirms: no remaining `getEntity(` calls in production code outside the "keep" list
4. Grep confirms: every `getEntityOrThrow` call includes a non-empty context string
