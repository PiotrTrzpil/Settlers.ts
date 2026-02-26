/**
 * Territory Types
 *
 * Types and constants for the territory system.
 * Towers and castles define territory zones. Boundary dots visualize the edges.
 */

import { BuildingType } from '../../buildings/types';

/** A single territory boundary dot for rendering */
export interface TerritoryDot {
    readonly x: number;
    readonly y: number;
    readonly player: number;
}

/**
 * Territory influence radius for each building type (in hex tiles).
 * Only buildings listed here generate territory.
 */
export const TERRITORY_RADIUS: Partial<Record<BuildingType, number>> = {
    [BuildingType.GuardTowerSmall]: 48,
    [BuildingType.GuardTowerBig]: 76,
    [BuildingType.Castle]: 100,
};

/** Set of building types that generate territory */
export const TERRITORY_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.GuardTowerSmall,
    BuildingType.GuardTowerBig,
    BuildingType.Castle,
]);
