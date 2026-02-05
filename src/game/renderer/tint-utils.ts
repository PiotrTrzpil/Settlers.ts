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
export const TINT_PREVIEW_VALID: readonly number[] = [0.5, 1.0, 0.5, 0.5];
export const TINT_PREVIEW_INVALID: readonly number[] = [1.0, 0.5, 0.5, 0.5];

// Player tint strength (0 = no tint, 1 = full player color)
const PLAYER_TINT_STRENGTH = 0.4;

/**
 * Get the base player color for a player index.
 */
export function getPlayerColor(playerIndex: number): readonly number[] {
    return PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
}

/**
 * Compute sprite tint with player color influence.
 * Used for buildings and units that should show player ownership.
 */
export function computePlayerTint(playerIndex: number, isSelected: boolean): number[] {
    if (isSelected) {
        return [...TINT_SELECTED];
    }

    const playerColor = getPlayerColor(playerIndex);
    const r = 1.0 + (playerColor[0] - 1.0) * PLAYER_TINT_STRENGTH;
    const g = 1.0 + (playerColor[1] - 1.0) * PLAYER_TINT_STRENGTH;
    const b = 1.0 + (playerColor[2] - 1.0) * PLAYER_TINT_STRENGTH;
    return [r, g, b, 1.0];
}

/**
 * Compute sprite tint for entities without player ownership (map objects, resources).
 */
export function computeNeutralTint(isSelected: boolean): number[] {
    return isSelected ? [...TINT_SELECTED] : [...TINT_NEUTRAL];
}

/**
 * Compute tint for building preview ghost.
 */
export function computePreviewTint(isValid: boolean): readonly number[] {
    return isValid ? TINT_PREVIEW_VALID : TINT_PREVIEW_INVALID;
}
