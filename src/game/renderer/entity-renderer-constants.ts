/**
 * Constants for entity rendering.
 * Extracted from entity-renderer.ts for cleaner organization.
 */

// Color shader constants (for non-textured rendering)
export const SELECTED_COLOR = [1.0, 1.0, 1.0, 1.0]; // White highlight
export const FRAME_COLOR = [1.0, 1.0, 0.0, 0.85]; // Yellow selection frame
export const FRAME_CORNER_COLOR = [1.0, 1.0, 1.0, 0.95]; // White corner accents
export const PATH_COLOR = [0.3, 1.0, 0.6, 0.4]; // Green path indicator
export const PREVIEW_VALID_COLOR = [0.3, 1.0, 0.3, 0.5]; // Green ghost building
export const PREVIEW_INVALID_COLOR = [1.0, 0.3, 0.3, 0.5]; // Red ghost building

// Texture unit assignments (landscape uses 0-2)
export const TEXTURE_UNIT_SPRITE_ATLAS = 3;

// Maximum path dots to show per selected unit
export const MAX_PATH_DOTS = 30;

// Base quad vertices for instanced rendering
export const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

// Entity scale factors
export const BUILDING_SCALE = 0.5;
export const UNIT_SCALE = 0.3;
export const RESOURCE_SCALE = 0.25;
export const PATH_DOT_SCALE = 0.12;

/**
 * Depth factors for different entity types.
 * These determine where the "depth point" is relative to sprite height:
 * 0.0 = top of sprite, 1.0 = bottom of sprite.
 * Higher values = depth point closer to ground = appears "more in front".
 */
export const DEPTH_FACTOR_BUILDING = 0.5;   // Middle of building
export const DEPTH_FACTOR_MAP_OBJECT = 0.85; // Near bottom (trees, stones have base at bottom)
export const DEPTH_FACTOR_UNIT = 1.0;       // At feet (units stand on ground)
export const DEPTH_FACTOR_RESOURCE = 1.0;   // On ground

// Selection frame parameters
export const FRAME_PADDING = 1.3; // Frame size relative to entity scale
export const FRAME_THICKNESS = 0.025; // Thickness of frame border lines
export const FRAME_CORNER_LENGTH = 0.35; // Corner accent length (fraction of frame side)

// Selection dot parameters
export const SELECTION_DOT_SCALE = 0.15; // Larger dot on unit sprite
export const SELECTION_ORIGIN_DOT_SCALE = 0.10; // Smaller dot at logical origin
export const SELECTION_DOT_COLOR = [0.2, 0.9, 1.0, 1.0]; // Cyan dot on sprite
export const SELECTION_ORIGIN_DOT_COLOR = [1.0, 0.4, 0.2, 1.0]; // Orange dot at origin

// Maximum entities for batch buffer allocation
export const MAX_BATCH_ENTITIES = 500;
// 6 vertices per quad, 8 floats per vertex (posX, posY, texU, texV, r, g, b, a)
export const FLOATS_PER_ENTITY = 6 * 8;
