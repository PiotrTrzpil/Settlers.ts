/**
 * Tint utilities for entity rendering.
 * Centralizes tint computation for consistency across entity types.
 */

// Player colors (RGBA, 0-1 range)
export const PLAYER_COLORS: readonly number[][] = [
    [0.2, 0.6, 1.0, 0.9], // Player 0: Blue
    [1.0, 0.3, 0.3, 0.9], // Player 1: Red
    [0.3, 1.0, 0.3, 0.9], // Player 2: Green
    [1.0, 1.0, 0.3, 0.9], // Player 3: Yellow
];

// Sprite tint presets (multiplicative, so 1.0 = no change)
export const TINT_NEUTRAL: readonly number[] = [1.0, 1.0, 1.0, 1.0];
export const TINT_SELECTED: readonly number[] = [1.3, 1.3, 1.3, 1.0];
export const TINT_PREVIEW_VALID: readonly number[] = [1.0, 1.0, 1.0, 0.8];
export const TINT_PREVIEW_INVALID: readonly number[] = [0.3, 0.3, 0.3, 0.5];
