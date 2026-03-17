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
    /** Fractional tile offset toward own territory (0 when facing unclaimed, ~0.35 at player borders). */
    readonly offsetX: number;
    readonly offsetY: number;
}

/**
 * Territory influence radius for each building type.
 * Values are the `radius` parameter to fillCircle (isometric ellipse units).
 * Derived empirically from 374 original maps — P95 of the required radius
 * to cover all same-player buildings nearest to each tower type.
 */
export const TERRITORY_RADIUS: Partial<Record<BuildingType, number>> = {
    [BuildingType.GuardTowerSmall]: 55,
    [BuildingType.GuardTowerBig]: 60,
    [BuildingType.Castle]: 65,
};

/** Set of building types that generate territory */
export const TERRITORY_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.GuardTowerSmall,
    BuildingType.GuardTowerBig,
    BuildingType.Castle,
]);
