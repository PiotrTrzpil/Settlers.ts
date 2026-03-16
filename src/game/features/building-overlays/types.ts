/**
 * Building Overlay Types
 *
 * Declarative definitions for visual attachments on buildings:
 * smoke, spinning wheels, working animations, status effects,
 * and construction backgrounds.
 *
 * Each overlay is a positioned, independently-animated sprite layer
 * drawn relative to its parent building. A building can have multiple
 * overlays, each on a different render layer and with its own animation.
 * Overlays support vertical clipping (verticalProgress) for construction-
 * style rising effects.
 */

// ============================================================================
// Enums
// ============================================================================

/** Render layer relative to the parent building sprite. */
export enum OverlayLayer {
    /** Behind the building sprite (ground effects, shadows) */
    BehindBuilding = 0,
    /** On top of the building but below the flag */
    AboveBuilding = 1,
    /** Player flag layer — between AboveBuilding and AboveFlag */
    Flag = 2,
    /** On top of everything including the flag (status icons) */
    AboveFlag = 3,
}

/**
 * Condition under which an overlay is visible.
 * Evaluated per-tick by the overlay manager.
 */
export enum OverlayCondition {
    /** Always visible on a completed building */
    Always = 'always',
    /** Only when the building is actively producing */
    Working = 'working',
    /** Only when the building is idle (not producing) */
    Idle = 'idle',
}

// ============================================================================
// Definitions (static, declarative — registered once per building type)
// ============================================================================

/**
 * Reference to a sprite sequence in the GFX file system.
 * Resolved at load time into actual SpriteEntry frames.
 */
export interface OverlaySpriteRef {
    /** GFX file number (e.g., 10 for Roman buildings, 5 for shared objects) */
    readonly gfxFile: number;
    /** JIL job index within the file */
    readonly jobIndex: number;
    /** DIL direction index (default: 0) */
    readonly directionIndex?: number;
}

/**
 * Static definition of a single overlay attached to a building type.
 *
 * Pure data — describes WHAT to render and HOW. One BuildingOverlayDef
 * produces one sprite layer on every building of the matching type.
 *
 * @example
 * ```ts
 * const sawmillWheel: BuildingOverlayDef = {
 *     key: 'wheel',
 *     layer: OverlayLayer.AboveBuilding,
 *     pixelOffsetX: 12,
 *     pixelOffsetY: -40,
 *     spriteRef: { gfxFile: 10, jobIndex: 42 },
 *     frameDurationMs: 80,
 *     loop: true,
 *     condition: OverlayCondition.Working,
 * };
 * ```
 */
export interface BuildingOverlayDef {
    /** Unique key within the building type (e.g., 'smoke', 'wheel', 'flame') */
    readonly key: string;
    /** Render layer relative to the building */
    readonly layer: OverlayLayer;
    /** Pixel offset from building sprite anchor (GFX pixels, pre-conversion to world units) */
    readonly pixelOffsetX: number;
    readonly pixelOffsetY: number;
    /** GFX sprite reference — resolved to atlas entries at load time */
    readonly spriteRef: OverlaySpriteRef;
    /** Animation frame duration in ms. 0 = static (single frame, no animation) */
    readonly frameDurationMs: number;
    /** Whether the animation loops. Ignored if frameDurationMs is 0. Default: true */
    readonly loop: boolean;
    /** Condition for when this overlay is visible */
    readonly condition: OverlayCondition;
    /** Whether the sprite uses player team coloring. Default: false */
    readonly teamColored?: boolean;
    /** Original XML job name (e.g. BUILDING_BAKERY_FIRE) for deferred sprite resolution */
    readonly jobName?: string;
    /**
     * When true, this overlay renders the player's team flag instead of a JIL sprite.
     * Sprite is resolved at render time via spriteManager.registry.getFlag(player, frame).
     * The spriteRef and pixelOffset fields are unused for flag overlays —
     * position comes from tileOffsetX/Y instead (tile-space, from XML flag element).
     */
    readonly isFlag?: boolean;
    /** Tile-space offset from building anchor (XML flag position). Only used when isFlag=true. */
    readonly tileOffsetX?: number;
    /** Tile-space offset from building anchor (XML flag position). Only used when isFlag=true. */
    readonly tileOffsetY?: number;
}

// ============================================================================
// Runtime state (managed by BuildingOverlayManager)
// ============================================================================

/**
 * Runtime state for a single overlay instance attached to a specific building.
 *
 * Created by the overlay manager when a building is registered. Tracks
 * independent animation timing per overlay. The manager updates these
 * each tick; the glue layer reads them to produce render data.
 */
export interface BuildingOverlayInstance {
    /** The static definition this instance was created from */
    readonly def: Readonly<BuildingOverlayDef>;
    /** Parent building entity ID */
    readonly entityId: number;
    /** Animation elapsed time in milliseconds */
    elapsedMs: number;
    /** Whether this overlay is currently visible (based on condition evaluation) */
    active: boolean;
    /** Number of sprite frames available (set after sprite loading) */
    frameCount: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the current animation frame for an overlay instance.
 * Returns 0 for static overlays or when frameCount ≤ 1.
 */
export function getOverlayFrame(instance: Readonly<BuildingOverlayInstance>): number {
    const { def, elapsedMs, frameCount } = instance;
    if (def.frameDurationMs <= 0 || frameCount <= 1) {
        return 0;
    }

    const rawFrame = Math.floor(elapsedMs / def.frameDurationMs);
    return def.loop ? rawFrame % frameCount : Math.min(rawFrame, frameCount - 1);
}
