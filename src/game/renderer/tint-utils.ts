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

// Player tint strength (0 = no tint, 1 = full player color)
const PLAYER_TINT_STRENGTH = 0.4;

// Pre-computed player tints for palette row generation
export const PLAYER_TINTS: readonly (readonly number[])[] = PLAYER_COLORS.map(playerColor => {
    const r = 1.0 + (playerColor[0] - 1.0) * PLAYER_TINT_STRENGTH;
    const g = 1.0 + (playerColor[1] - 1.0) * PLAYER_TINT_STRENGTH;
    const b = 1.0 + (playerColor[2] - 1.0) * PLAYER_TINT_STRENGTH;
    return [r, g, b, 1.0] as const;
});

