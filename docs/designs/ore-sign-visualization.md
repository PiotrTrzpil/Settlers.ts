# Ore Sign Visualization & Geologist Prospecting

## Overview

Geologists walk to unprospected mountain tiles, perform a work animation, and place a **resource sign** — a small wooden sign sprite showing the ore type and richness level at that tile. Signs auto-disappear after a configurable timeout. Empty tiles get an "empty" sign (no ore here).

This covers two subsystems:
1. **Geologist work handler** — PositionWorkHandler for `SearchType.RESOURCE_POS`
2. **Resource sign system** — creates sign entities, tracks their lifetime, removes them on timeout

## Existing Infrastructure

Already in place (no changes needed):
- `UnitType.Geologist` (= 8), speed 1.5, category Specialist
- `SearchType.RESOURCE_POS` in types.ts
- JIL sprite indices: walk=305, work_1=306, work_2=307 (in `jil-indices.ts`)
- GIL sprite indices in `gil-indices.ts`:
  - `RESOURCE_SIGNS.EMPTY` = 1208
  - `RESOURCE_SIGNS.COAL.LOW/MED/RICH` = 1209/1210/1211
  - `RESOURCE_SIGNS.GOLD.LOW/MED/RICH` = 1212/1213/1214
  - `RESOURCE_SIGNS.IRON.LOW/MED/RICH` = 1215/1216/1217
  - `RESOURCE_SIGNS.STONE.LOW/MED/RICH` = 1218/1219/1220
  - `RESOURCE_SIGNS.SULFUR.LOW/MED/RICH` = 1221/1222/1223
- `MapObjectType.ResCoal/ResGold/ResIron/ResStone/ResSulfur` (550-555)
- `OreVeinData` with per-tile `oreType` and `oreLevel` (0-3)
- `OreType` enum: None=0, Coal=1, Iron=2, Gold=3, Sulfur=4, Stone=5
- XML job definition `JOB_GEOLOGIST_WORK` with GO_TO_POS + SEARCH tasks
- Job part `G_SEARCH` → resolves to walk animation

## Architecture

### Data Model

**Per-tile prospected state** — new `Uint8Array` in `OreVeinData`:
- `prospected: Uint8Array` — 0 = not prospected, 1 = prospected
- Methods: `isProspected(x, y)`, `setProspected(x, y)`

**Sign entity tracking** — in a new `ResourceSignSystem` (TickSystem):
- `Map<number, { expiresAt: number }>` — maps sign entity ID → removal tick time
- On tick: remove expired signs via `gameState.removeEntity()`
- On `entity:removed`: clean up tracking entry

### Subsystem 1: Geologist Work Handler

File: `src/game/features/settler-tasks/work-handlers.ts`

New factory function `createGeologistHandler()` returning a `PositionWorkHandler`:

```
findPosition(x, y):
    spiralSearch from (x, y) within GEOLOGIST_SEARCH_RADIUS
    filter: tile is rock AND not prospected
    return first match {x, y}

onWorkAtPositionComplete(posX, posY, settlerId):
    oreVeinData.setProspected(posX, posY)
    signSystem.placeSign(posX, posY)
```

Constants:
- `GEOLOGIST_SEARCH_RADIUS = 20`

### Subsystem 2: Resource Sign System

File: `src/game/features/ore-veins/resource-sign-system.ts`

```typescript
class ResourceSignSystem implements TickSystem {
    // sign entity ID → game-time expiry
    private signs: Map<number, number> = new Map();
    private elapsed = 0;

    placeSign(x: number, y: number): void
        // Read ore data from OreVeinData at (x, y)
        // Determine MapObjectType + variation from OreType + level
        // OreType.None (level 0) → MapObjectType with "empty" variation
        // OreType.Coal level 1 → ResCoal variation 0 (LOW)
        // OreType.Coal level 2 → ResCoal variation 1 (MED)
        // OreType.Coal level 3 → ResCoal variation 2 (RICH)
        // Same pattern for all ore types
        // Create entity via gameState.addEntity(EntityType.MapObject, signType, x, y, 0, undefined, variation)
        // Track: this.signs.set(entityId, this.elapsed + SIGN_LIFETIME)

    tick(dt: number): void
        this.elapsed += dt
        // Remove expired signs
        for (const [id, expiry] of this.signs)
            if (this.elapsed >= expiry)
                gameState.removeEntity(id)
                this.signs.delete(id)

    onEntityRemoved(entityId: number): void
        this.signs.delete(entityId)
```

Constants:
- `SIGN_LIFETIME = 120` (seconds — signs visible for 2 minutes)

### Subsystem 3: Resource Sign Sprite Loading

File: `src/game/renderer/decoration-sprite-map.ts` (add entries)
+ `src/game/renderer/sprite-loaders/map-objects-sprite-loader.ts` (load sign sprites)

Resource sign MapObjectTypes (ResCoal=550 etc.) need sprite mappings so the renderer can display them.

Each `Res*` type uses 3 variations (LOW=0, MED=1, RICH=2) mapped to GIL indices.
Additionally, need an "empty sign" — use a new `MapObjectType.ResEmpty = 556` or reuse one of the existing types with a dedicated variation.

**Approach**: Add a new `MapObjectType.ResEmpty = 556` for the empty sign. The sign system picks the right type based on `OreType`, and variation encodes level (0=LOW, 1=MED, 2=RICH).

GIL mapping for sprite loading:
| MapObjectType | Variation 0 (LOW) | Variation 1 (MED) | Variation 2 (RICH) |
|---|---|---|---|
| ResEmpty (556) | GIL 1208 | — | — |
| ResCoal (550) | GIL 1209 | GIL 1210 | GIL 1211 |
| ResGold (552) | GIL 1212 | GIL 1213 | GIL 1214 |
| ResIron (553) | GIL 1215 | GIL 1216 | GIL 1217 |
| ResStone (554) | GIL 1218 | GIL 1219 | GIL 1220 |
| ResSulfur (555) | GIL 1221 | GIL 1222 | GIL 1223 |

### Subsystem 4: Feature Wiring

File: `src/game/features/ore-veins/ore-sign-feature.ts` (new)

Follow the TreeFeature/CropFeature pattern:
```typescript
export const OreSignFeature: FeatureDefinition = {
    id: 'ore-signs',
    create(ctx) {
        const signSystem = new ResourceSignSystem(ctx.gameState);
        ctx.cleanupRegistry.onEntityRemoved(id => signSystem.onEntityRemoved(id));
        return {
            systems: [signSystem],
            exports: { signSystem } satisfies OreSignExports,
        };
    },
};
```

File: `src/game/game-services.ts` (modify)

- Load `OreSignFeature` in feature registry
- After `setTerrainData`: register geologist work handler
  ```typescript
  this.settlerTaskSystem.registerWorkHandler(
      SearchType.RESOURCE_POS,
      createGeologistHandler(oreVeinData, terrain, signSystem)
  );
  ```

## File Change Summary

### New Files
| File | Agent | Description |
|---|---|---|
| `src/game/features/ore-veins/resource-sign-system.ts` | A | ResourceSignSystem — tracks sign entities, removes on timeout |
| `src/game/features/ore-veins/ore-sign-feature.ts` | A | FeatureDefinition wiring for ore-signs |

### Modified Files
| File | Agent | Description |
|---|---|---|
| `src/game/features/ore-veins/ore-vein-data.ts` | B | Add `prospected` Uint8Array, `isProspected()`, `setProspected()` |
| `src/game/features/ore-veins/index.ts` | B | Export new types |
| `src/game/features/settler-tasks/work-handlers.ts` | C | Add `createGeologistHandler()` factory |
| `src/game/game-services.ts` | D | Load OreSignFeature, register geologist handler |
| `src/game/types/map-object-types.ts` | E | Add `ResEmpty = 556` |
| `src/game/renderer/decoration-sprite-map.ts` | E | Add resource sign sprite pool entries for ResCoal-ResSulfur + ResEmpty |
| `src/game/renderer/sprite-loaders/map-objects-sprite-loader.ts` | E | Load resource sign sprites (GIL 1208-1223) with variation support |

## Parallelization Plan

### Agent A — ResourceSignSystem + Feature
**Files owned**: `resource-sign-system.ts`, `ore-sign-feature.ts`

Create `ResourceSignSystem` implementing `TickSystem`:
- Constructor takes `GameState` and `OreVeinData`
- `placeSign(x, y)` reads ore type/level, creates sign entity with correct MapObjectType + variation
- `tick(dt)` removes expired signs
- `onEntityRemoved(id)` cleans up tracking
- `SIGN_LIFETIME = 120`

OreType → MapObjectType mapping:
- `None → MapObjectType.ResEmpty`
- `Coal → MapObjectType.ResCoal`
- `Iron → MapObjectType.ResIron`
- `Gold → MapObjectType.ResGold`
- `Sulfur → MapObjectType.ResSulfur`
- `Stone → MapObjectType.ResStone`

Level → variation: `level - 1` (1→0=LOW, 2→1=MED, 3→2=RICH). For empty signs, variation=0.

Create `OreSignFeature` following TreeFeature pattern. Export `OreSignExports = { signSystem: ResourceSignSystem }`.

### Agent B — OreVeinData prospected tracking
**Files owned**: `ore-vein-data.ts`, `index.ts`

Add to `OreVeinData`:
- `readonly prospected: Uint8Array` (initialized to 0 in constructor, same size as oreType)
- `isProspected(x: number, y: number): boolean` — returns `this.prospected[this.toIndex(x, y)]! !== 0`
- `setProspected(x: number, y: number): void` — sets `this.prospected[this.toIndex(x, y)] = 1`

Update `index.ts` to export `ResourceSignSystem` from `./resource-sign-system` and `OreSignFeature` from `./ore-sign-feature`.

### Agent C — Geologist work handler
**Files owned**: `work-handlers.ts`

Add `createGeologistHandler()` factory:
```typescript
import type { ResourceSignSystem } from '../ore-veins/resource-sign-system';

const GEOLOGIST_SEARCH_RADIUS = 20;

export function createGeologistHandler(
    oreVeinData: OreVeinData,
    terrain: TerrainData,
    signSystem: ResourceSignSystem,
): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,
        findPosition: (x: number, y: number) => {
            return spiralSearch(x, y, terrain.width, terrain.height, (tx, ty) => {
                if (Math.abs(tx - x) > GEOLOGIST_SEARCH_RADIUS || Math.abs(ty - y) > GEOLOGIST_SEARCH_RADIUS) return false;
                return terrain.isRock(tx, ty) && !oreVeinData.isProspected(tx, ty);
            });
        },
        onWorkAtPositionComplete: (posX: number, posY: number, _settlerId: number) => {
            oreVeinData.setProspected(posX, posY);
            signSystem.placeSign(posX, posY);
        },
    };
}
```

Existing imports already available in `work-handlers.ts`: `spiralSearch`, `TerrainData`, `WorkHandlerType`, `PositionWorkHandler`.
New imports needed: `OreVeinData` from `../ore-veins/ore-vein-data`, `ResourceSignSystem` (type-only) from `../ore-veins/resource-sign-system`.

### Agent D — GameServices wiring
**Files owned**: `game-services.ts`

1. Import `OreSignFeature` and `ResourceSignSystem` type from `./features/ore-veins`
2. Import `createGeologistHandler` from `./features/settler-tasks/work-handlers`
3. Add `OreSignFeature` to `featureRegistry.loadAll([...])` array
4. Add public field: `public readonly signSystem!: ResourceSignSystem`
5. After feature loading, retrieve: `this.signSystem = this.featureRegistry.getFeatureExports<OreSignExports>('ore-signs').signSystem`
6. In `setTerrainData()`, after ore vein data creation, register geologist handler:
   ```typescript
   this.settlerTaskSystem.registerWorkHandler(
       SearchType.RESOURCE_POS,
       createGeologistHandler(this.oreVeinData, terrain, this.signSystem)
   );
   ```

### Agent E — Sprite loading + MapObjectType
**Files owned**: `map-object-types.ts`, `decoration-sprite-map.ts`, `map-objects-sprite-loader.ts`

1. In `map-object-types.ts`: Add `ResEmpty = 556` after `ResSulfur = 555`. Add all `Res*` types to the category mapping as `MapObjectCategory.Decorations` (signs are non-blocking decorations).

2. In `decoration-sprite-map.ts`: Add resource sign entries to `CATEGORY_SPRITE_POOLS` or a new dedicated mapping. Each Res* type maps variation → GIL index:
   - ResEmpty: variation 0 → GIL 1208
   - ResCoal: variations [1209, 1210, 1211]
   - ResGold: variations [1212, 1213, 1214]
   - ResIron: variations [1215, 1216, 1217]
   - ResStone: variations [1218, 1219, 1220]
   - ResSulfur: variations [1221, 1222, 1223]

3. In `map-objects-sprite-loader.ts`: Add a `loadResourceSignSprites()` function that loads GIL indices 1208-1223 from file 5 (landscape GFX) and registers them via `registry.registerMapObject()` keyed by (MapObjectType, variation). Call it from the main `loadMapObjectSprites()` flow.

## Dependency Graph

```
Agent B (OreVeinData.prospected) ──┐
                                   ├── Agent C (geologist handler) ──┐
Agent A (ResourceSignSystem) ──────┤                                 ├── Agent D (wiring)
                                   │                                 │
Agent E (sprites + types) ─────────┘─────────────────────────────────┘
```

Agents A, B, E are fully independent. Agent C depends on A+B interfaces. Agent D depends on all.

**Recommended spawn order**: A, B, E in parallel → C after A+B → D after all.
Or: spawn all 5 in parallel, tell C and D to write imports as if dependencies exist.
