# CLI Map Rendering — Design

## Overview

Upgrade the `map` CLI command from a flat single-character display (everything is `B`, `U`, `T`, `.`) to a Dwarf-Fortress-style rich symbol map that distinguishes terrain types, building categories, unit roles, resources, and vegetation. Add configurable viewport sizes and display layers.

## Current State

- **What exists**: `mapCommand()` in `src/game/cli/commands/queries.ts` (lines 283-322) renders a text grid using `renderTileChar()`, `groundEntityChar()`, and `terrainChar()`.
- **What stays**: Command structure (`map <x> <y> [radius]`), coordinate clamping, Y-label alignment, center-point marker.
- **What changes**: Symbol rendering extracted to a dedicated module with rich per-category symbols. New flags for viewport size and layer filtering.
- **What gets deleted**: Inline `terrainChar()`, `groundEntityChar()`, `renderTileChar()` helpers replaced by the new module.

## Summary for Review

- **Interpretation**: Replace the generic single-char map with rich, distinctive symbols per entity/terrain category (DF-style). Add `--size` presets (small/medium/large/custom radius) and `--layer` filtering.
- **Key decisions**: Symbols are plain ASCII (no Unicode) so they work in any terminal. Entity subtype determines the symbol (e.g., trees=`T`, mines=`M`, military=`!`), not just entity type. A legend line is appended after the grid.
- **Assumptions**: No ANSI color for now (can be added later). Player ownership not shown in symbols (would need color). The map stays single-character-per-tile (no multi-char cells).
- **Scope**: Rich symbols + size presets + layer flags. Deferred: color, multi-char tiles, fog-of-war.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, throw with context
- Max 140 char lines, max cyclomatic complexity 15
- Use enum members, never numeric literals
- CLI commands follow `CliCommand` interface pattern in `types.ts`
- Use `optInt()` / flag parsing from existing CLI helpers

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Symbol mapping | Map entity/terrain to display character | — | `src/game/cli/map-symbols.ts` |
| 2 | Map renderer | Build text grid from game state | 1 | `src/game/cli/map-renderer.ts` |
| 3 | Command wiring | Parse args, call renderer, format output | 2 | `src/game/cli/commands/queries.ts` (modify) |

## Shared Contracts

```typescript
// ── src/game/cli/map-symbols.ts ──

import type { Entity } from '@/game/entity';
import type { TerrainData } from '@/game/terrain/terrain-data';

/** Which layers to include in the map render. */
export interface MapLayerFilter {
    terrain: boolean;   // terrain symbols (water, rock, grass, etc.)
    buildings: boolean;  // building entities
    units: boolean;      // unit entities
    objects: boolean;    // trees, stones, resources, bushes, decorations
    piles: boolean;      // stacked material piles
}

/** Preset viewport sizes. */
export type MapSizePreset = 'sm' | 'md' | 'lg' | 'xl';

/** Resolved viewport dimensions. */
export interface MapViewport {
    cx: number;
    cy: number;
    radius: number;
}

/**
 * Return a single ASCII character representing the entity or terrain at a tile.
 * Priority: unit > building > pile > map object > terrain.
 */
export function renderTileSymbol(
    entity: Entity | undefined,
    groundEntity: Entity | undefined,
    terrainType: number,
    terrainHeight: number,
    layers: MapLayerFilter
): string;

/** Resolve a size preset or custom radius to a MapViewport. */
export function resolveViewport(
    cx: number, cy: number,
    sizeOrRadius: MapSizePreset | number,
    terrain: TerrainData
): MapViewport;

/** Return a compact legend string for all symbols that appear in the rendered grid. */
export function buildLegend(usedSymbols: Set<string>): string;


// ── src/game/cli/map-renderer.ts ──

import type { GameCore } from '@/game/game-core';
import type { MapLayerFilter, MapViewport } from './map-symbols';

/** Render the map viewport to a multi-line string (header + grid + legend). */
export function renderMapText(
    game: GameCore,
    viewport: MapViewport,
    layers: MapLayerFilter
): string;
```

## Subsystem Details

### 1. Symbol Mapping (`src/game/cli/map-symbols.ts`)

**Files**: `src/game/cli/map-symbols.ts` (new)

**Key decisions**:
- Symbols are categorized by what a player would care about — distinguish production buildings from military, workers from soldiers, trees from rocks.
- Each symbol is a single ASCII char. The mapping is a pure function with no side effects.

**Symbol table** (implementation guide):

| Category | Condition | Symbol | Mnemonic |
|----------|-----------|--------|----------|
| **Terrain** | | | |
| Water | groundType ≤ 8 | `~` | waves |
| Rock/mountain | groundType = 32 | `^` | peak |
| Beach | groundType = 48 | `,` | sand |
| Swamp | groundType = 80-81 | `%` | muck |
| River | groundType = 96-99 | `~` | flowing water (same as water) |
| Snow | groundType = 128-129 | `*` | snowflake |
| Desert | groundType = 64-65 | `_` | flat |
| Mud | groundType = 144-145 | `#` | sticky |
| Grass (default) | all other passable | `.` | dot |
| **Units** | | | |
| Carrier | UnitType.Carrier | `c` | carrier |
| Builder | UnitType.Builder | `b` | builder |
| Worker (other) | category = Worker | `w` | worker |
| Military (melee) | Swordsman*, AxeWarrior* | `!` | sword |
| Military (ranged) | Bowman*, BlowgunWarrior*, BackpackCatapultist* | `>` | arrow |
| Squad leader | SquadLeader | `@` | commander |
| Donkey | UnitType.Donkey | `d` | donkey |
| **Buildings** | | | |
| Castle/Fortress | Castle, Fortress | `C` | castle |
| StorageArea | StorageArea | `S` | storage |
| Guard tower | GuardTowerSmall/Big | `G` | guard |
| Barrack | Barrack | `X` | training |
| Production building | all other buildings | `B` | building |
| Mine | CoalMine, IronMine, GoldMine, StoneMine, SulfurMine | `M` | mine |
| Residence | ResidenceSmall/Medium/Big | `H` | house |
| Temple | SmallTemple, LargeTemple, DarkTemple | `&` | temple |
| **Map Objects** | | | |
| Tree (any) | subType 0-26 (tree range) | `T` | tree |
| Resource deposit | subType 100-106 | `$` | resource |
| Crop | subType 200-205 | `"` | growing |
| Bush | subType 300-318 | `;` | shrub |
| Decorative stone | subType 400-449 | `o` | boulder |
| Mushroom | subType 380-395 | `m` | mushroom |
| Water feature (pond) | subType 500-512 | `~` | water |
| Wonder/large structure | subType 600-612 | `W` | wonder |
| Other map object | fallback | `.` | blend with terrain |
| **Stacked Piles** | | | |
| Any pile | EntityType.StackedPile | `P` | pile |

**Behavior**:
- `renderTileSymbol` checks layers filter first — if a layer is disabled, skip entities of that type
- Priority order: unit (top) → building → pile → map object → terrain
- `buildLegend()` only includes symbols actually present in the rendered area, formatted as a compact one-liner: `~=water ^=rock T=tree B=building ...`

### 2. Map Renderer (`src/game/cli/map-renderer.ts`)

**Files**: `src/game/cli/map-renderer.ts` (new)

**Key decisions**:
- Iterates the viewport rect once, calling `renderTileSymbol` per tile
- Tracks which symbols appear (Set<string>) to build legend
- Center point still shows `+` (overrides any entity/terrain)
- X-axis header uses modular column numbers (existing behavior)

**Size presets**:

| Preset | Radius | Grid size |
|--------|--------|-----------|
| `sm` | 5 | 11×11 |
| `md` | 15 | 31×31 |
| `lg` | 30 | 61×61 |
| `xl` | 50 | 101×101 |

### 3. Command Wiring (modify `queries.ts`)

**Files**: `src/game/cli/commands/queries.ts` (modify)

**Key decisions**:
- Updated usage: `map <x> <y> [radius|sm|md|lg|xl] [--layer terrain,buildings,units,objects,piles]`
- Default size: `sm` (same as current radius=5)
- Default layers: all enabled
- `--layer` accepts comma-separated list to enable only those layers
- Remove inline `terrainChar`, `groundEntityChar`, `renderTileChar` — replaced by imports from map-symbols

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/cli/map-symbols.ts` | 1 | Symbol mapping, legend builder, viewport resolver |
| `src/game/cli/map-renderer.ts` | 2 | Grid rendering engine |

### Modified Files
| File | Change |
|------|--------|
| `src/game/cli/commands/queries.ts` | Replace inline map helpers with imports; update `mapCommand()` to use new renderer and parse new flags |

## Verification
- `map 128 128` — renders 11×11 grid with rich symbols matching terrain and entities
- `map 128 128 lg` — renders 61×61 grid
- `map 128 128 20` — renders custom radius=20 grid
- `map 128 128 --layer terrain,buildings` — shows only terrain and building symbols, units/objects/piles hidden
- Legend line at bottom only shows symbols present in the viewport
