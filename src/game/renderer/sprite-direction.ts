/**
 * Sprite direction mapping for the isometric diamond grid.
 *
 * JIL/DIL sprite files use 6 direction indices numbered clockwise from right.
 * The game's movement system uses EDirection (hex-directions.ts) with a different ordering.
 * This module provides the conversion between the two.
 */

import type { EDirection } from '../systems/hex-directions';

declare const SpriteDirBrand: unique symbol;

/**
 * Branded numeric type for sprite direction indices (JIL/DIL file ordering, clockwise from right).
 * Prevents accidental interchange with EDirection or plain number.
 */
export type SpriteDirection = number & { readonly [SpriteDirBrand]: true };

/** Sprite direction constants (companion object for SpriteDirection type). */
export const SpriteDirection = {
    RIGHT: 0 as SpriteDirection,
    RIGHT_BOTTOM: 1 as SpriteDirection,
    LEFT_BOTTOM: 2 as SpriteDirection,
    LEFT: 3 as SpriteDirection,
    LEFT_TOP: 4 as SpriteDirection,
    RIGHT_TOP: 5 as SpriteDirection,
} as const;

/** EDirection → SpriteDirection mapping. */
const EDIRECTION_TO_SPRITE: readonly SpriteDirection[] = [
    SpriteDirection.RIGHT_BOTTOM, // SOUTH_EAST = 0
    SpriteDirection.RIGHT, // EAST = 1
    SpriteDirection.LEFT_BOTTOM, // SOUTH_WEST = 2
    SpriteDirection.LEFT_TOP, // NORTH_WEST = 3
    SpriteDirection.LEFT, // WEST = 4
    SpriteDirection.RIGHT_TOP, // NORTH_EAST = 5
];

/** Convert EDirection to sprite direction index. */
export function toSpriteDirection(eDirection: EDirection): SpriteDirection {
    return EDIRECTION_TO_SPRITE[eDirection]!;
}
