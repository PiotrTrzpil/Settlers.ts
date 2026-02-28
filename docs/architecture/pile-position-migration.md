# Migration: Replace stack-positions.yaml with buildingInfo.xml pile data

## Problem

Pile (inventory stack) positions are maintained in two places:

1. **`buildingInfo.xml`** (709 pile entries) — the original S4 game data, fully parsed into
   `BuildingPileInfo[]` but **never used at runtime**. Contains material, type (input/output/storage),
   and tile positions for every building × race combination.

2. **`stack-positions.yaml`** (920 lines, ~40 buildings) — a hand-guessed subset of dx/dy tile
   offsets maintained via the debug "Adjust Stacks" tool. This is the **only** runtime source.

Buildings not in the YAML fall back to auto-calculated adjacent-tile positions
(`InventoryLayout.calculateAutoStackPositions`), which are generic and don't use the XML at all.

### Why migrate

- The YAML is a **partial, hand-guessed duplicate** of data that already exists in the XML.
- The XML covers **all** buildings × races × materials; the YAML covers ~40 buildings for Roman only.
- The XML's `type` field (0=output, 1=input, 4=storage) is authoritative — the YAML encodes the
  same information via `input:`/`output:` keys, but was typed by hand.
- Adding a new building currently requires manually adding YAML entries; the XML already has them.
- **The XML positions are the original game's actual pile positions.** We can use them directly.

### XML pile coordinate system

Pile `xOffset`/`yOffset` are tile coordinates in the building's footprint bitmask grid. The
building's hotspot (`iHotSpotX`, `iHotSpotY`) is the anchor tile — the tile stored as
`building.x`, `building.y` in our entity system.

**Conversion formula:**

```
dx = xOffset - iHotSpotX
dy = yOffset - iHotSpotY

worldX = building.x + dx
worldY = building.y + dy
```

Examples:

| Building (Roman) | hotSpot | Material | xOff,yOff | dx, dy | Spatial meaning |
|-------------------|---------|----------|-----------|--------|-----------------|
| WoodcutterHut | (3,5) | LOG out | (4,2) | (+1, -3) | 1 right, 3 above anchor |
| StonecutterHut | (4,4) | STONE out | (4,3) | (0, -1) | 1 above anchor |
| Sawmill | (4,5) | LOG in | (4,1) | (0, -4) | 4 above anchor |
| Sawmill | (4,5) | BOARD out | (5,6) | (+1, +1) | 1 right, 1 below anchor |
| Mill | (5,8) | GRAIN in | (2,3) | (-3, -5) | 3 left, 5 above anchor |
| Mill | (5,8) | FLOUR out | (3,0) | (-2, -8) | 2 left, 8 above anchor |
| Bakery | (6,8) | FLOUR in | (0,4) | (-6, -4) | 6 left, 4 above anchor |
| Bakery | (6,8) | BREAD out | (5,0) | (-1, -8) | 1 left, 8 above anchor |
| Barracks | (6,7) | SWORD in | (3,8) | (-3, +1) | 3 left, 1 below anchor |
| Barracks | (6,7) | ARMOR in | (7,8) | (+1, +1) | 1 right, 1 below anchor |

These are the original S4 pile positions — spatially sensible (outputs and inputs on different
sides of the building). We use them directly instead of guessing with auto-calculation.

### Fields NOT used

- **`xPixelOffset`/`yPixelOffset`** — screen-space pixel offsets for rendering the pile sprite
  relative to the building sprite anchor. Used by the original S4 renderer for sub-tile artwork
  positioning. Not applicable to our tile-based system.
- **`patch`** — animation patch slot flag. Unused.
- **`appearance`** — legacy editor field (only one non-zero entry in the entire XML). Unused.

---

## Migration plan

### Phase 1: `BuildingPileRegistry` — expose XML pile data at runtime

**Goal:** Make the parsed XML pile data available as a typed, queryable service that provides
both pile metadata (material, input/output) and tile positions.

#### 1.1 Add `PileSlotType` enum

**File:** `src/resources/game-data/types.ts`

```ts
/** Pile type from buildingInfo.xml <pile><type> field */
export enum PileSlotType {
    Output = 0,
    Input = 1,
    Storage = 4,
}
```

Update `BuildingPileInfo.type` from `number` to `PileSlotType`.

#### 1.2 Create `BuildingPileRegistry`

**File:** `src/game/features/inventory/building-pile-registry.ts`

A read-only service wrapping `BuildingInfo.piles` with hotspot-adjusted positions:

```ts
interface PileSlot {
    material: EMaterialType;
    slotType: 'input' | 'output';
    /** Tile offset from building anchor (already hotspot-adjusted) */
    dx: number;
    dy: number;
}

interface BuildingPileRegistry {
    /** Get all pile slots for a building type + race */
    getPileSlots(buildingType: BuildingType, race: Race): PileSlot[];

    /** Get pile slots filtered by input/output */
    getInputSlots(buildingType: BuildingType, race: Race): PileSlot[];
    getOutputSlots(buildingType: BuildingType, race: Race): PileSlot[];

    /** Get position for a specific material at a building */
    getPilePosition(
        buildingType: BuildingType,
        race: Race,
        material: EMaterialType,
        buildingX: number,
        buildingY: number
    ): TileCoord | null;
}
```

**Construction:** Built at startup from `BuildingInfo[]`. For each pile entry:
1. Map `GOOD_*` string → `EMaterialType`
2. Map `type` 0/1 → `'output'`/`'input'` (skip `type=4` storage entries)
3. Compute `dx = xOffset - iHotSpotX`, `dy = yOffset - iHotSpotY`
4. Store keyed by `(BuildingType, Race)`

#### 1.3 Wire into the inventory feature

**File:** `src/game/features/inventory/index.ts`

Construct `BuildingPileRegistry` from `gameData.buildingInfos` during feature init.
Expose as a service for `InventoryLayout` and other consumers.

### Phase 2: `InventoryLayout` uses XML positions instead of YAML

**Goal:** Replace the YAML lookup + auto-calc fallback with direct XML pile positions.

#### 2.1 Rework `InventoryLayout.resolveStackPosition`

Current flow:
```
YAML lookup → generic auto-calc pool (first available adjacent tile)
```

New flow:
```
BuildingPileRegistry.getPilePosition() → auto-calc fallback (only for buildings missing from XML)
```

The registry provides the exact tile position from the XML. The auto-calc fallback only
activates for edge cases where a building has no pile entries in the XML (should be rare —
the XML covers all standard buildings).

#### 2.2 Simplify `resolveStackPosition` signature

```ts
resolveStackPosition(
    buildingId: number,
    materialType: EMaterialType,
    slotType: 'input' | 'output'
): TileCoord | null
```

No more `visualState` parameter — positions come from the XML, not from which entities exist.

### Phase 3: Delete YAML and related code

#### 3.1 Delete files

- `src/game/features/inventory/data/stack-positions.yaml`
- `src/game/features/inventory/stack-positions.ts` (the `StackPositions` class)

#### 3.2 Remove YAML references

- `InventoryLayout`: remove `setStackPositions()`, remove `StackPositions` import
- `inventory/index.ts`: remove `StackPositions` construction and injection

#### 3.3 Update debug "Adjust Stacks" tool

**Remove it.** Pile positions now come from the original game data — no hand-tuning needed.
If a position looks wrong, it's a parsing bug, not a calibration issue.

Remove:
- `src/game/features/building-adjust/stack-handler.ts` (or the stack-adjust parts of it)
- `src/game/input/modes/stack-adjust-mode.ts` (if solely for stack adjustment)
- Related debug panel UI entry

---

## Files affected

| File | Change |
|------|--------|
| `src/resources/game-data/types.ts` | Add `PileSlotType` enum, type `BuildingPileInfo.type` |
| `src/game/features/inventory/building-pile-registry.ts` | **New** — XML pile data with positions |
| `src/game/features/inventory/index.ts` | Wire `BuildingPileRegistry`, remove `StackPositions` |
| `src/game/features/inventory/inventory-layout.ts` | Use registry positions, remove YAML path |
| `src/game/features/inventory/stack-positions.ts` | **Delete** |
| `src/game/features/inventory/data/stack-positions.yaml` | **Delete** |
| `src/game/features/building-adjust/stack-handler.ts` | Remove stack-adjust functionality |
| `src/game/input/modes/stack-adjust-mode.ts` | **Delete** (if stack-only) |
| `tests/unit/building-pile-registry.spec.ts` | **New** — test XML pile parsing + position calc |
| `tests/unit/inventory-layout.spec.ts` | Update for XML-based positioning |

## Validation

After each phase:
1. `pnpm test:unit` — all existing inventory/layout tests pass.
2. Visual spot-check: place buildings of different types/races, verify pile positions look correct.
3. Carrier logistics: verify carriers still pick up and deliver to the right tiles.
4. Choreography: verify settlers walk to correct pile positions during active jobs.
