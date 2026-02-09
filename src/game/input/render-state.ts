import type { BuildingType } from '../entity';

/**
 * Cursor types for different interaction states.
 */
export enum CursorType {
    Default = 'default',
    Pointer = 'pointer',
    Crosshair = 'crosshair',
    Move = 'move',
    NotAllowed = 'not-allowed',
    Grab = 'grab',
    Grabbing = 'grabbing',
}

/**
 * Building placement preview data.
 */
export interface BuildingPreview {
    type: 'building';
    /** Building type being placed */
    buildingType: BuildingType;
    /** Anchor X position (top-left of footprint) */
    x: number;
    /** Anchor Y position (top-left of footprint) */
    y: number;
    /** Whether placement is valid at this position */
    valid: boolean;
}

/**
 * Resource placement preview data.
 */
export interface ResourcePreview {
    type: 'resource';
    /** Material type being placed */
    materialType: import('../economy/material-type').EMaterialType;
    /** X position */
    x: number;
    /** Y position */
    y: number;
    /** Whether placement is valid */
    valid: boolean;
    /** Quantity of resources to preview (1-8) */
    amount?: number;
}

/**
 * Selection box during drag selection.
 */
export interface SelectionBox {
    type: 'selection_box';
    /** Start X in tile coordinates */
    startTileX: number;
    /** Start Y in tile coordinates */
    startTileY: number;
    /** Current end X in tile coordinates */
    endTileX: number;
    /** Current end Y in tile coordinates */
    endTileY: number;
    /** Start X in screen coordinates (for rendering) */
    startScreenX: number;
    /** Start Y in screen coordinates (for rendering) */
    startScreenY: number;
    /** End X in screen coordinates (for rendering) */
    endScreenX: number;
    /** End Y in screen coordinates (for rendering) */
    endScreenY: number;
}

/**
 * Tile highlight for hover, selection, or other visual feedback.
 */
export interface TileHighlight {
    /** Tile X coordinate */
    x: number;
    /** Tile Y coordinate */
    y: number;
    /** Highlight color (CSS color string or hex) */
    color: string;
    /** Opacity (0-1) */
    alpha?: number;
    /** Optional highlight style */
    style?: 'solid' | 'outline' | 'dashed';
}

/**
 * Path preview for unit movement.
 */
export interface PathPreview {
    type: 'path';
    /** Path waypoints */
    waypoints: Array<{ x: number; y: number }>;
    /** Color of the path line */
    color: string;
}

/**
 * Union type for all preview types.
 */
export type ModePreview = BuildingPreview | SelectionBox | PathPreview | ResourcePreview;

/**
 * Complete render state returned by a mode.
 * Describes everything the mode needs rendered as overlays.
 */
export interface ModeRenderState {
    /** Cursor to display */
    cursor: CursorType;

    /** Current preview (building, selection box, path, etc.) */
    preview?: ModePreview | null;

    /** Tiles to highlight */
    highlights?: TileHighlight[];

    /** Hover tile indicator */
    hoverTile?: { x: number; y: number } | null;

    /** Custom status text to display */
    statusText?: string;
}

/**
 * Create a default render state.
 */
export function createDefaultRenderState(): ModeRenderState {
    return {
        cursor: CursorType.Default,
        preview: null,
        highlights: [],
        hoverTile: null,
    };
}
