# Feature Module Architecture

This document describes how to structure features as self-contained modules to improve maintainability, testability, and the ability to add/remove features cleanly.

## The Problem

Features that are scattered across many files create several issues:

1. **Hard to understand** - Logic for one feature lives in 10+ files
2. **Hard to modify** - Changing behavior requires edits everywhere
3. **Hard to remove** - Removing a feature means hunting through the codebase
4. **Tight coupling** - Core systems know about every feature

**Example: Territory System (removed)**

The territory system touched 13+ files:
- `game.ts` - TerritoryMap instance, rebuild calls
- `entity-renderer.ts` - territory border rendering
- `building-indicator-renderer.ts` - territory validation
- `command.ts` - territory parameter in placement
- `placement.ts` - territory validation functions
- `debug-stats.ts` - territory settings
- `use-renderer.ts` - territory state syncing
- Plus dedicated files: `territory.ts`, `territory-border-renderer.ts`

Removing it required editing all these files and understanding how each one used territory.

## The Solution: Feature Modules

A feature module is a self-contained directory that:

1. **Owns all its logic** - State, updates, validation, rendering hints
2. **Exposes a minimal public API** - Other code imports only from `index.ts`
3. **Registers with core systems** - Instead of core systems importing the feature
4. **Uses events/hooks** - Reacts to game events rather than being called directly

### Directory Structure

```
src/game/features/<feature-name>/
  ├── index.ts              # Public API - ONLY file imported by others
  ├── <feature>-system.ts   # Main update logic (if needed)
  ├── state.ts              # Feature-specific state types
  ├── hooks.ts              # Event handlers / integration points
  └── internal/             # Private implementation details
      └── ...
```

### Core Principles

#### 1. Single Entry Point

All external code imports only from `index.ts`:

```typescript
// GOOD - single import point
import { BuildingConstructionSystem } from '@/game/features/building-construction';

// BAD - importing internal files
import { applyTerrainLeveling } from '@/game/features/building-construction/internal/terrain';
```

#### 2. Registration Over Import

Core systems provide registration points; features register themselves:

```typescript
// GOOD - feature registers with core
gameLoop.registerTickSystem(constructionSystem);
placementValidator.register('building', buildingValidator);
eventBus.on('building:removed', handleBuildingRemoved);

// BAD - core imports and calls feature directly
import { updateBuildingConstruction } from './buildings/construction';
// ... later in tick():
updateBuildingConstruction(state, dt, ctx);
```

#### 3. Events Over Direct Calls

Features react to events rather than being called by commands:

```typescript
// GOOD - command emits event, feature reacts
// In command.ts:
eventBus.emit('building:removed', { entityId, buildingState });

// In feature module:
eventBus.on('building:removed', ({ entityId, buildingState }) => {
  restoreOriginalTerrain(buildingState);
});

// BAD - command directly calls feature logic
import { restoreOriginalTerrain } from '../systems/terrain-leveling';
// ... in executeRemoveEntity():
restoreOriginalTerrain(bs, groundType, groundHeight, mapSize);
```

#### 4. Query Interface for Rendering

Renderers query feature modules for display data:

```typescript
// GOOD - renderer queries feature for what to display
const visualState = constructionSystem.getVisualState(buildingId);
if (visualState.useConstructionSprite) { ... }

// BAD - renderer imports internal types and computes state itself
import { BuildingConstructionPhase, getBuildingVisualState } from '../buildings/construction';
const bs = state.buildingStates.get(id);
const visual = getBuildingVisualState(bs);
```

---

## Example Migration: Building Construction

### Current State (Scattered)

The building construction feature is currently spread across:

| File | Responsibility |
|------|----------------|
| `buildings/construction.ts` | Phase transitions, visual state calculation |
| `buildings/state.ts` | `BuildingState` type definition |
| `systems/terrain-leveling.ts` | Terrain capture/restore during construction |
| `game-loop.ts` | Calls `updateBuildingConstruction()` every tick |
| `game-state.ts` | Holds `buildingStates: Map<number, BuildingState>` |
| `commands/command.ts` | Calls `restoreOriginalTerrain()` on building removal |
| `entity-renderer.ts` | Reads construction phase to pick sprites |

### Target State (Feature Module)

```
src/game/features/building-construction/
  ├── index.ts                    # Public API
  ├── construction-system.ts      # Tick updates, registers with GameLoop
  ├── types.ts                    # BuildingState, BuildingConstructionPhase
  ├── visual-state.ts             # getVisualState() for renderers
  └── internal/
      ├── phase-transitions.ts    # Phase progression logic
      └── terrain-capture.ts      # Terrain leveling (moved from systems/)
```

### Public API (`index.ts`)

```typescript
// Only these are importable by external code

// Types
export type { BuildingState, BuildingVisualState } from './types';
export { BuildingConstructionPhase } from './types';

// System (for registration)
export { BuildingConstructionSystem } from './construction-system';

// Queries (for renderers)
export { getVisualState } from './visual-state';
```

### System Registration

```typescript
// construction-system.ts
export class BuildingConstructionSystem implements TickSystem {
  private state: GameState;
  private terrainCtx: TerrainContext;

  constructor(state: GameState, terrainCtx: TerrainContext) {
    this.state = state;
    this.terrainCtx = terrainCtx;
  }

  // Called by GameLoop
  tick(dt: number): void {
    for (const [id, bs] of this.state.buildingStates) {
      this.updateBuilding(id, bs, dt);
    }
  }

  // React to building removal
  onBuildingRemoved(entityId: number, buildingState: BuildingState): void {
    restoreOriginalTerrain(buildingState, this.terrainCtx);
  }

  private updateBuilding(id: number, bs: BuildingState, dt: number): void {
    // Phase transition logic (moved from construction.ts)
  }
}
```

### GameLoop Changes

```typescript
// game-loop.ts - BEFORE
import { updateBuildingConstruction } from './buildings/construction';

private tick(dt: number): void {
  this.gameState.movement.update(dt);
  updateBuildingConstruction(this.gameState, dt, terrainContext);
  this.gameState.lumberjackSystem.update(this.gameState, dt);
}

// game-loop.ts - AFTER
private systems: TickSystem[] = [];

registerSystem(system: TickSystem): void {
  this.systems.push(system);
}

private tick(dt: number): void {
  for (const system of this.systems) {
    system.tick(dt);
  }
}
```

### Command Changes

```typescript
// command.ts - BEFORE
import { restoreOriginalTerrain } from '../systems/terrain-leveling';

function executeRemoveEntity(ctx: CommandContext, cmd: RemoveEntityCommand): boolean {
  if (entity.type === EntityType.Building) {
    const bs = state.buildingStates.get(cmd.entityId);
    if (bs) {
      restoreOriginalTerrain(bs, groundType, groundHeight, mapSize);
    }
  }
  state.removeEntity(cmd.entityId);
  return true;
}

// command.ts - AFTER
function executeRemoveEntity(ctx: CommandContext, cmd: RemoveEntityCommand): boolean {
  if (entity.type === EntityType.Building) {
    const bs = state.buildingStates.get(cmd.entityId);
    ctx.eventBus.emit('building:removed', { entityId: cmd.entityId, buildingState: bs });
  }
  state.removeEntity(cmd.entityId);
  return true;
}
```

### Renderer Changes

```typescript
// entity-renderer.ts - BEFORE
import { getBuildingVisualState, BuildingConstructionPhase } from '../buildings/construction';

const bs = this.buildingStates.get(entity.id);
const visual = getBuildingVisualState(bs);
if (visual.useConstructionSprite) { ... }

// entity-renderer.ts - AFTER
import { getVisualState } from '@/game/features/building-construction';

const visual = getVisualState(entity.id, this.buildingStates);
if (visual.useConstructionSprite) { ... }
```

---

## Migration Checklist

When migrating a feature to a module:

### 1. Audit Current Usage
- [ ] Grep for all imports/references to the feature
- [ ] List every file that uses it
- [ ] Identify: state, update logic, validation, rendering, commands

### 2. Design the Module
- [ ] Define the public API (keep it minimal)
- [ ] Identify what needs to register with core systems
- [ ] Identify events the feature should react to
- [ ] Identify queries renderers/UI need

### 3. Create the Module Structure
- [ ] Create `features/<name>/` directory
- [ ] Move existing code into appropriate files
- [ ] Create `index.ts` with public exports only

### 4. Add Registration Points to Core
- [ ] Add `registerSystem()` to GameLoop if needed
- [ ] Add event emission to commands if needed
- [ ] Add validator registration if needed

### 5. Update Dependents
- [ ] Change imports to use `features/<name>` index
- [ ] Replace direct calls with registrations
- [ ] Replace direct logic with event handlers
- [ ] Replace internal queries with public API

### 6. Verify
- [ ] Feature still works end-to-end
- [ ] All tests pass
- [ ] No imports from `features/<name>/internal/`
- [ ] Removing the feature = delete folder + remove registrations

---

## Feature Candidates

Features that would benefit from this pattern:

| Feature | Files Affected | Complexity | Value |
|---------|---------------|------------|-------|
| Building Construction | 8+ | High | High |
| Economy/Materials | 16+ | Medium | High |
| Lumberjack System | 3 | Low | Low (already decent) |
| Audio System | 7 | Low | Low (already decent) |
| Placement Validation | 6 | Medium | Medium |

---

## Anti-Patterns to Avoid

### Leaky Abstractions

```typescript
// BAD - exposing internal state structure
export function getConstructionProgress(bs: BuildingState): number {
  return bs.elapsedTime / bs.totalDuration;
}

// GOOD - hiding internal details
export function getConstructionProgress(buildingId: number): number {
  const bs = getBuildingState(buildingId);
  return bs ? bs.elapsedTime / bs.totalDuration : 1.0;
}
```

### Feature-Specific Types in Core

```typescript
// BAD - core system knows about feature types
interface GameState {
  buildingStates: Map<number, BuildingState>;  // Feature-specific!
  resourceStates: Map<number, ResourceState>;  // Feature-specific!
}

// BETTER - generic extension point
interface GameState {
  featureStates: Map<string, Map<number, unknown>>;
}

// Or use the feature module to manage its own state entirely
```

### Circular Dependencies

```typescript
// BAD - feature imports core, core imports feature
// feature/index.ts
import { GameState } from '../game-state';

// game-state.ts
import { BuildingState } from './features/building-construction';

// GOOD - use interfaces/events to break cycles
// Feature defines its own state, doesn't import GameState type
// Core emits events, doesn't import feature modules
```
