/**
 * Constants and helper functions for entity rendering.
 * Extracted from entity-renderer.ts for cleaner organization.
 */

import type { Entity } from '../entity';
import { EntityType, MapObjectType } from '../entity';
import type { SpriteEntry } from './sprite-metadata';
import { Race } from './sprite-metadata';
import type { RaceId } from '@/resources/game-data';

// Color shader constants (for non-textured rendering)
export const SELECTED_COLOR = [1.0, 1.0, 1.0, 1.0]; // White highlight
export const FRAME_COLOR = [1.0, 1.0, 0.0, 0.85]; // Yellow selection frame
export const FRAME_CORNER_COLOR = [1.0, 1.0, 1.0, 0.95]; // White corner accents
export const PATH_COLOR = [0.3, 1.0, 0.6, 0.4]; // Green path indicator
export const PATH_TARGET_COLOR = [1.0, 0.3, 0.1, 0.9]; // Orange target marker
export const PATH_TARGET_RING_COLOR = [1.0, 0.6, 0.2, 0.5]; // Outer ring glow
export const PREVIEW_VALID_COLOR = [0.3, 1.0, 0.3, 0.5]; // Green ghost building
export const PREVIEW_INVALID_COLOR = [1.0, 0.3, 0.3, 0.5]; // Red ghost building

// Texture unit assignments (landscape uses 0-2)
export const TEXTURE_UNIT_SPRITE_ATLAS = 3;
export const TEXTURE_UNIT_PALETTE = 4;

// Maximum path dots to show per selected unit
export const MAX_PATH_DOTS = 30;

// Base quad vertices for instanced rendering
export const BASE_QUAD = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]);

// Global scale applied to all entity sprites (buildings, units, trees, resources)
export const ENTITY_SCALE = 1.5;

// Scale for decoration sprites (non-tree, non-stone map objects like bushes, flowers, rocks)
export const DECORATION_SCALE = 1.0;

// Entity scale factors (for procedural/fallback rendering)
export const BUILDING_SCALE = 1.5;
export const UNIT_SCALE = 0.6;
export const RESOURCE_SCALE = 0.5;
export const PATH_DOT_SCALE = 0.24;
export const PATH_TARGET_SCALE = 0.4;
export const PATH_TARGET_RING_SCALE = 0.7;

/**
 * Depth factors for different entity types.
 * These determine where the "depth point" is relative to sprite height:
 * 0.0 = top of sprite, 1.0 = bottom of sprite.
 * Higher values = depth point closer to ground = appears "more in front".
 */
export const DEPTH_FACTOR_BUILDING = 0.5; // Middle of building
export const DEPTH_FACTOR_MAP_OBJECT = 0.85; // Near bottom (trees, stones have base at bottom)
export const DEPTH_FACTOR_UNIT = 1.0; // At feet (units stand on ground)
export const DEPTH_FACTOR_RESOURCE = 1.0; // On ground

/**
 * Depth bias subtracted from seed trees (growing saplings) and fallen/cut tree stages
 * so they always render behind standing trees, units, and buildings at the same tile.
 * Must be less than tile row spacing (0.5 world units) to avoid cross-row mis-sorting.
 */
export const FLAT_TREE_DEPTH_BIAS = 0.2;

// Selection frame parameters
export const FRAME_PADDING = 1.3; // Frame size relative to entity scale
export const FRAME_THICKNESS = 0.025; // Thickness of frame border lines
export const FRAME_CORNER_LENGTH = 0.35; // Corner accent length (fraction of frame side)

// Selection dot parameters
export const SELECTION_DOT_SCALE = 0.15; // Larger dot on unit sprite
export const SELECTION_ORIGIN_DOT_SCALE = 0.1; // Smaller dot at logical origin
export const SELECTION_DOT_COLOR = [0.2, 0.9, 1.0, 1.0]; // Cyan dot on sprite
export const SELECTION_ORIGIN_DOT_COLOR = [1.0, 0.4, 0.2, 1.0]; // Orange dot at origin

// Footprint debug visualization
export const FOOTPRINT_TILE_COLOR = [0.2, 0.8, 1.0, 0.4]; // Semi-transparent cyan

// Service area overlay
export const SERVICE_AREA_CIRCLE_COLOR = [0.3, 0.7, 1.0, 0.6]; // Blue circle outline
export const SERVICE_AREA_CIRCLE_SEGMENTS = 64; // Number of segments for circle approximation

/**
 * Vertex scale factor applied by entity-vert.glsl shader.
 * The shader does: pos = a_position * SHADER_VERTEX_SCALE + a_entityPos
 *
 * When drawing with absolute world coordinates, you must compensate:
 * relativeCoord = (worldCoord - center) * (1 / SHADER_VERTEX_SCALE)
 *
 * Or use the helper methods in SelectionOverlayRenderer that handle this automatically.
 */
export const SHADER_VERTEX_SCALE = 0.4;

// Flag rendering constants
/** Scale factor for flag sprites */
export const FLAG_SCALE = ENTITY_SCALE;
/** Flag animation speed: frames per second */
export const FLAG_ANIM_FPS = 12;

// Maximum entities for batch buffer allocation
export const MAX_BATCH_ENTITIES = 500;
// 6 vertices per quad, 10 floats per vertex (posX, posY, texU, texV, texLayer, playerRow, r, g, b, a)
export const FLOATS_PER_ENTITY = 6 * 10;

/** Map decoration object type (19-255) to a hue in degrees (30=orange → 280=violet). */
export function decoTypeToHue(subType: number): number {
    const t = Math.max(0, Math.min(1, (subType - 19) / (100 - 19)));
    return 30 + t * 250; // 30° (orange) to 280° (violet)
}

/** Convert hue to an RGBA color array for WebGL (saturation=0.9, lightness=0.55). */
export function decoHueToRgb(subType: number): number[] {
    const h = decoTypeToHue(subType) / 360;
    const s = 0.9;
    const l = 0.55;
    // HSL → RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;
    let r: number, g: number, b: number;
    const sector = Math.floor(h * 6);
    if (sector === 0) {
        r = c;
        g = x;
        b = 0;
    } else if (sector === 1) {
        r = x;
        g = c;
        b = 0;
    } else if (sector === 2) {
        r = 0;
        g = c;
        b = x;
    } else if (sector === 3) {
        r = 0;
        g = x;
        b = c;
    } else if (sector === 4) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }
    return [r + m, g + m, b + m, 1.0];
}

/** Race enum → RaceId string for BuildingInfo lookup */
export const RACE_TO_RACE_ID: Record<Race, RaceId> = {
    [Race.Roman]: 'RACE_ROMAN',
    [Race.Viking]: 'RACE_VIKING',
    [Race.Mayan]: 'RACE_MAYA',
    [Race.DarkTribe]: 'RACE_DARK',
    [Race.Trojan]: 'RACE_TROJAN',
};

/** Apply a scale factor to a sprite's world dimensions and offsets. */
export function scaleSprite(sprite: SpriteEntry, scale: number = ENTITY_SCALE): SpriteEntry {
    return {
        ...sprite,
        widthWorld: sprite.widthWorld * scale,
        heightWorld: sprite.heightWorld * scale,
        offsetX: sprite.offsetX * scale,
        offsetY: sprite.offsetY * scale,
    };
}

/** Get sprite scale for an entity: decorations use FLAG_SCALE, trees/stones ENTITY_SCALE, other map objects DECORATION_SCALE. */
export function getSpriteScale(entity: Entity): number {
    if (entity.type === EntityType.Decoration) return FLAG_SCALE;
    if (entity.type !== EntityType.MapObject) return ENTITY_SCALE;
    if (entity.subType <= MapObjectType.TreeOliveSmall) return ENTITY_SCALE;
    if (entity.subType === MapObjectType.ResourceStone) return ENTITY_SCALE;
    return DECORATION_SCALE;
}
