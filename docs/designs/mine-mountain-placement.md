# Mine Mountain Placement — Design

## Overview

Mine buildings (Coal, Iron, Gold, Stone, Sulfur) should be placeable anywhere on a mountain where their footprint fits, without slope restrictions. Their construction skips the digging/leveling phase entirely — builders arrive and begin construction as soon as the first materials are delivered.

## Current State

- **Placement**: Mines already require rock terrain (`isMineBuildable` → `isRock`). However, the slope check (`computeSlopeDifficulty`) applies equally to mines and non-mines — steep mountain terrain blocks mine placement.
- **Construction**: All buildings follow the same 7-phase pipeline: `WaitingForDiggers → TerrainLeveling → Evacuating → WaitingForBuilders → ConstructionRising → CompletedRising → Completed`. Mines go through full terrain leveling even though mountains shouldn't be flattened.
- **What stays**: Terrain type check (mines must be on rock), occupancy check, bounds check, footprint blocking after leveling phase equivalent, material delivery, builder work ticks.
- **What changes**: Skip slope check for mines; skip digging phases (WaitingForDiggers, TerrainLeveling, Evacuating) for mines.
- **What gets deleted**: Nothing — all changes are conditional branches on `isMineBuilding()`.

## Summary for Review

- **Interpretation**: Mines should ignore slope/height-difference constraints during placement (they fit into the mountain as-is). During construction, mines skip the entire digging/terrain-leveling phase — once placed, they go straight to waiting for builders, and construction begins when materials arrive and builders are assigned.
- **Key decisions**: No terrain leveling for mines (no ground type change to DustyWay, no height averaging). The mountain terrain stays as-is. Footprint blocking is applied immediately at placement instead of after leveling. No `originalTerrain` capture needed for mines.
- **Assumptions**: Mines don't need terrain restoration on cancellation (terrain was never modified). The ground type stays rock under the mine.
- **Scope**: Placement validation + construction phase skip. Does not change mine production, visuals, or any other building type's behavior.

## Conventions

- Optimistic programming: no defensive fallbacks. Trust `isMineBuilding()` results.
- Feature modules: changes touch `systems/placement` and `features/building-construction` — both existing modules, no new feature module needed.
- Events: existing event names and payloads are sufficient. No new events.
- Max 140 char lines, max 250 line functions, max 600 line files.

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Placement validation | Skip slope check for mine buildings | — | `src/game/systems/placement/internal/building-validator.ts` |
| 2 | Construction phase skip | Mines start at WaitingForBuilders, skip digging entirely | — | `src/game/features/building-construction/construction-site-manager.ts`, `src/game/features/building-construction/construction-system.ts` |
| 3 | Integration tests | Verify placement on steep rock + no-dig construction flow | 1, 2 | `tests/unit/integration/construction/mine-construction.spec.ts` |

## Shared Contracts

No new types or interfaces needed. The existing `isMineBuilding(buildingType): boolean` from `src/game/buildings/types.ts` is the only predicate both subsystems use.

## Subsystem Details

### 1 — Placement validation
**Files**: `src/game/systems/placement/internal/building-validator.ts`
**Key decisions**:
- When `isMine` is true, skip the `computeSlopeDifficulty` call entirely — return `PlacementStatus.Easy` for mines regardless of terrain height differences.
- The terrain type check (`isMineBuildable` → `isRock`) and occupancy check remain unchanged.

### 2 — Construction phase skip
**Files**: `src/game/features/building-construction/construction-site-manager.ts`, `src/game/features/building-construction/construction-system.ts`
**Key decisions**:
- In `registerSite()`: when `isMineBuilding(buildingType)`, set `phase` to `WaitingForBuilders` instead of `WaitingForDiggers`. Mark `terrain.complete = true`, `terrain.progress = 1`. Emit `construction:workerNeeded` with role `'builder'` instead of `'digger'`.
- No terrain capture, no ground type change to DustyWay — mine footprint stays rock.
- Footprint blocking must be applied immediately at registration time for mines (since there's no leveling→evacuate→block flow). Emit `construction:levelingComplete` so the construction system applies footprint blocking via its existing handler — but since `terrain.modified` is already true and no `originalTerrain` exists, the handler just blocks the footprint and transitions to `WaitingForBuilders`.
- Alternative (simpler): have `registerSite` directly call `state.restoreBuildingFootprintBlock()` for mines — but this couples the manager to GameState. Better to emit the event and let the system handle it.
- In `rebuildSingleSite()` / `reemitWorkerNeeded()` in `construction-system.ts`: no changes needed — these already check `site.terrain.complete` and act accordingly. Mines with `terrain.complete = true` and `phase >= WaitingForBuilders` will correctly re-emit builder-needed and restore footprint block.
- On cancellation (`onBuildingRemoved`): no terrain restoration needed since `originalTerrain` is null. Existing null check already handles this.

### 3 — Integration tests
**Files**: `tests/unit/integration/construction/mine-construction.spec.ts`
**Key decisions**:
- Use `installRealGameData()` and the full `Simulation` harness — no mocks.
- Use `fillRockSquare` + `createSlope` to create steep rock terrain (height diff > `MAX_SLOPE_DIFF` between adjacent tiles) for placement tests.
- Use `createScenario.constructionSite()` pattern as a reference, but build a mine-specific scenario: residence + builder + storage with materials + mine site on rock terrain. No digger needed (mines skip digging).
- For the construction flow test: place a mine with `completed: false`, verify site starts at `WaitingForBuilders` (not `WaitingForDiggers`), verify `terrain.complete` is true from the start, then `waitForConstructionComplete` and assert the mine becomes operational.

**Test cases**:
1. **Steep slope placement succeeds** — create rock region with height diff > 12 between adjacent footprint tiles, place a mine → should succeed. Place a non-mine on equivalent slope → should fail with `TooSteep`.
2. **Mine skips digging phase** — place mine with `completed: false`, immediately check `constructionSiteManager.getSite()` → `phase` should be `WaitingForBuilders`, `terrain.complete` should be true, `terrain.progress` should be 1.
3. **Full mine construction flow** — place mine on rock, supply materials, provide builder → mine should complete without ever dispatching a digger. Verify no `construction:diggingStarted` event was emitted, building becomes operational.
4. **Cancellation — no terrain restoration** — place mine, cancel before completion → rock terrain should remain unchanged (no DustyWay artifacts).
5. **Non-mine unaffected** — same steep-slope scenario with a normal building → should reject placement.

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `tests/unit/integration/construction/mine-construction.spec.ts` | 3 | Integration tests for mine mountain placement and no-dig construction |

### Modified Files

| File | Change |
|------|--------|
| `src/game/systems/placement/internal/building-validator.ts` | Skip `computeSlopeDifficulty` when `isMine` is true |
| `src/game/features/building-construction/construction-site-manager.ts` | In `registerSite()`, branch on `isMineBuilding()` to skip digging setup and emit builder-needed instead |

## Verification

- Place a mine on a steep mountain slope (height diff > 12 between adjacent footprint tiles) — should succeed.
- Place a mine on rock terrain — construction should skip directly to WaitingForBuilders, no diggers dispatched.
- Cancel a mine under construction — no terrain restoration artifacts (terrain was never modified).
- Save/load a game with an in-progress mine — mine should correctly resume at WaitingForBuilders/ConstructionRising.
- Non-mine buildings are unaffected — still go through full digging/leveling flow with slope limits.
