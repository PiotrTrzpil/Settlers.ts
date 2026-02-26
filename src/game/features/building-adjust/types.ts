/**
 * Building Adjust — shared types for the building property adjustment system.
 *
 * Three categories of adjustable properties:
 * - Entrance (door) — tile offset from building anchor
 * - Sprite layers — pixel offset from building sprite anchor
 * - Stacks (input/output) — tile offset from building anchor
 *
 * All positions are stored as offsets relative to the building anchor and
 * persisted per (BuildingType, Race) in YAML files.
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../race';
import type { TileHighlight } from '../../input/render-state';

// ============================================================================
// Adjustable Item
// ============================================================================

/** Category of adjustable property. */
export type AdjustCategory = 'entrance' | 'sprite-layer' | 'stack';

/** Precision mode for placement. */
export type AdjustPrecision = 'tile' | 'pixel';

/**
 * A single adjustable property on a building, displayed as a row in the UI.
 *
 * Each item represents one thing the user can click to highlight and reposition:
 * a door location, a sprite layer offset, or an input/output stack position.
 */
export interface AdjustableItem {
    /** Unique key within the handler (e.g. 'door', 'smoke', 'output:LOG') */
    readonly key: string;
    /** Display label for the UI list */
    readonly label: string;
    /** Category for grouping in the UI */
    readonly category: AdjustCategory;
    /** Placement precision — determines click handling */
    readonly precision: AdjustPrecision;
}

// ============================================================================
// Position types
// ============================================================================

/** Tile offset relative to building anchor. */
export interface TileOffset {
    dx: number;
    dy: number;
}

/** Pixel offset relative to building sprite anchor. */
export interface PixelOffset {
    px: number;
    py: number;
}

/** A resolved world-space position for highlighting. */
export interface HighlightPosition {
    /** Tile X (for tile-precision items) */
    tileX: number;
    /** Tile Y (for tile-precision items) */
    tileY: number;
    /** Pixel X offset from tile anchor (for pixel-precision items, 0 for tile) */
    pixelOffsetX: number;
    /** Pixel Y offset from tile anchor (for pixel-precision items, 0 for tile) */
    pixelOffsetY: number;
}

// ============================================================================
// Handler interface
// ============================================================================

/**
 * Handler for one category of adjustable building properties.
 *
 * Each handler knows how to:
 * - Enumerate items available for a building type + race
 * - Read the current position of each item
 * - Write a new position (persisted to YAML)
 * - Produce visual highlights for the renderer
 */
export interface BuildingAdjustHandler {
    /** Handler category identifier */
    readonly category: AdjustCategory;

    /** Display name for the category group header in the UI. */
    readonly categoryLabel: string;

    /**
     * Get all adjustable items for a building type + race.
     * Returns an empty array if there are no adjustable items.
     */
    getItems(buildingType: BuildingType, race: Race): readonly AdjustableItem[];

    /**
     * Get the current position offset for an item.
     * Returns null if no position is configured (will use default).
     */
    getOffset(buildingType: BuildingType, race: Race, itemKey: string): TileOffset | PixelOffset | null;

    /**
     * Set the position for an item relative to building anchor.
     * Persists to the backing YAML file.
     *
     * For tile-precision items: dx/dy are tile offsets.
     * For pixel-precision items: px/py are pixel offsets from building sprite anchor.
     */
    setOffset(buildingType: BuildingType, race: Race, itemKey: string, offset: TileOffset | PixelOffset): void;

    /**
     * Build tile highlights for all items of this category on a specific building.
     * Used by the input mode to show visual feedback.
     *
     * @param buildingId Entity ID of the building
     * @param buildingX Building anchor tile X
     * @param buildingY Building anchor tile Y
     * @param buildingType Building type enum
     * @param race Building race
     * @param activeItemKey Currently selected item key, or null
     */
    getHighlights(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race,
        activeItemKey: string | null
    ): TileHighlight[];

    /** Save all pending changes to disk. */
    save(): void;
}
