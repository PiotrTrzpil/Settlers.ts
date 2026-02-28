/**
 * Ore type definitions and mine-to-ore mappings.
 * Layer 0 (pure data): no imports from features or systems.
 */

import { BuildingType } from '../../buildings/building-type';

/** Types of ore that can exist on mountain tiles. */
export enum OreType {
    None = 0,
    Coal = 1,
    Iron = 2,
    Gold = 3,
    Sulfur = 4,
    Stone = 5,
}

/** Maximum ore level per tile (S4 uses 1-16 internally, 0 is empty). */
export const MAX_ORE_LEVEL = 16;

/** Radius (Chebyshev distance) around a mine's anchor to search for ore. */
export const MINE_SEARCH_RADIUS = 2;

/** Maps mine building types to the ore type they extract. */
export const MINE_ORE_TYPE: ReadonlyMap<BuildingType, OreType> = new Map([
    [BuildingType.CoalMine, OreType.Coal],
    [BuildingType.IronMine, OreType.Iron],
    [BuildingType.GoldMine, OreType.Gold],
    [BuildingType.SulfurMine, OreType.Sulfur],
    [BuildingType.StoneMine, OreType.Stone],
]);
