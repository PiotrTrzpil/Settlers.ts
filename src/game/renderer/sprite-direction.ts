/**
 * Sprite direction mapping for the isometric diamond grid.
 *
 * JIL/DIL sprite files use 6 direction indices numbered clockwise from right.
 * The game's movement system uses EDirection (hex-directions.ts) with a different ordering.
 * This module provides the conversion between the two.
 */

import { EDirection } from '../systems/hex-directions';

/** Sprite direction indices as stored in JIL/DIL files (clockwise from right). */
export enum SpriteDirection {
    RIGHT = 0,
    RIGHT_BOTTOM = 1,
    LEFT_BOTTOM = 2,
    LEFT = 3,
    LEFT_TOP = 4,
    RIGHT_TOP = 5,
}

/** EDirection → SpriteDirection mapping. Names match so this is straightforward. */
const EDIRECTION_TO_SPRITE: Record<EDirection, SpriteDirection> = {
    [EDirection.SOUTH_EAST]: SpriteDirection.RIGHT_BOTTOM,
    [EDirection.EAST]: SpriteDirection.RIGHT,
    [EDirection.SOUTH_WEST]: SpriteDirection.LEFT_BOTTOM,
    [EDirection.NORTH_WEST]: SpriteDirection.LEFT_TOP,
    [EDirection.WEST]: SpriteDirection.LEFT,
    [EDirection.NORTH_EAST]: SpriteDirection.RIGHT_TOP,
};

/** Convert EDirection value to sprite direction index. */
export function toSpriteDirection(eDirection: number): number {
    return EDIRECTION_TO_SPRITE[eDirection as EDirection];
}
