/**
 * Building type definitions and configuration.
 * Centralized building-related types, enums, and size configurations.
 */

import { type TileCoord, tileKey } from '../core/coordinates';
import { Race } from '../core/race';
import { getBuildingFootprintAt } from '@/resources/game-data';
import { getBuildingInfo } from '../data/game-data-access';
import { getAllNeighbors, hexDistance } from '../systems/hex-directions';
import { BuildingType } from './building-type';

export { BuildingType } from './building-type';

// ── Building occupancy limits ──

/** Override max worker occupants for specific building types. Default is 1. */
const BUILDING_MAX_OCCUPANTS: Partial<Record<BuildingType, number>> = {
    // Military buildings can garrison multiple units (future use)
    // [BuildingType.GuardTowerSmall]: 3,
    // [BuildingType.GuardTowerBig]: 6,
    // [BuildingType.Castle]: 10,
};

const DEFAULT_MAX_OCCUPANTS = 1;

/** Get the maximum number of workers that can be assigned to a building type. */
export function getBuildingMaxOccupants(buildingType: BuildingType): number {
    return BUILDING_MAX_OCCUPANTS[buildingType] ?? DEFAULT_MAX_OCCUPANTS;
}

/** All mine building types — must be placed on mountain/rock terrain. */
const MINE_BUILDING_TYPES: ReadonlySet<BuildingType> = new Set([
    BuildingType.CoalMine,
    BuildingType.IronMine,
    BuildingType.GoldMine,
    BuildingType.StoneMine,
    BuildingType.SulfurMine,
]);

/** Check if a building type is a mine (requires mountain terrain). */
export function isMineBuilding(buildingType: BuildingType): boolean {
    return MINE_BUILDING_TYPES.has(buildingType);
}

/**
 * Get the hotspot (anchor point) offset for a building type.
 * The hotspot is used to align the building sprite with its placement position.
 *
 * Returns {x, y} offset in tile coordinates from the top-left of the footprint bitmask
 * to the building's anchor/placement point.
 *
 * @param buildingType Type of building
 * @param race Race of the owning player (required — throws for wrong race/building combo)
 * @returns Hotspot offset {x, y} in tile units
 */
export function getBuildingHotspot(buildingType: BuildingType, race: Race): { x: number; y: number } {
    const info = getBuildingInfo(race, buildingType);
    if (!info) throw new Error(`No BuildingInfo for ${BuildingType[buildingType]} / race ${Race[race]}`);
    return { x: info.hotSpotX, y: info.hotSpotY };
}

/**
 * Get all tile coordinates that a building occupies.
 * The input (x, y) is the building's placement/anchor position.
 * Uses the XML bitmask footprint when available, otherwise falls back to simple rectangular.
 *
 * @param x Building placement X coordinate
 * @param y Building placement Y coordinate
 * @param buildingType Type of building
 * @param race Race of the owning player (required — throws for wrong race/building combo)
 */
export function getBuildingFootprint(x: number, y: number, buildingType: BuildingType, race: Race): TileCoord[] {
    const info = getBuildingInfo(race, buildingType);
    if (!info) throw new Error(`No BuildingInfo for ${BuildingType[buildingType]} / race ${Race[race]}`);
    if (info.buildingPosLines.length === 0) {
        throw new Error(
            `No footprint bitmask data for ${BuildingType[buildingType]} / race ${Race[race]}. ` +
                `All buildings must have buildingPosLines in their XML definition.`
        );
    }
    return getBuildingFootprintAt(info, x, y);
}

/**
 * Compute the set of footprint tiles that must remain passable for pathfinding.
 *
 * Building footprints in Settlers 4 are large bitmask areas (30–200+ tiles) that
 * include exclusion zones around the visible structure. The door tile and resource
 * pile tiles are inside this footprint but must be reachable by settlers.
 *
 * For each functional tile (door, input piles, output piles) that falls inside the
 * footprint, we "carve" a corridor of passable tiles leading outward from the tile
 * to the footprint boundary. This ensures pathfinding can reach every functional
 * tile without opening up the entire footprint.
 *
 * Both door and pile offsets in the XML are **anchor-relative** — they represent
 * tile offsets from the building's anchor (hotspot) position.
 *
 * Returns an empty set when game data is not loaded (e.g. lightweight tests).
 */
export function getBuildingDoorCorridor(
    x: number,
    y: number,
    buildingType: BuildingType,
    race: Race,
    footprint: TileCoord[]
): Set<string> {
    const passable = new Set<string>();
    let info: ReturnType<typeof getBuildingInfo>;
    try {
        info = getBuildingInfo(race, buildingType);
    } catch {
        return passable; // game data not loaded
    }
    if (!info) return passable;

    const footprintKeys = new Set(footprint.map(t => tileKey(t.x, t.y)));

    // Door: anchor-relative offset from XML <door><xOffset>/<yOffset>
    const door = resolveAnchorRelativePos(x, y, info.door.xOffset, info.door.yOffset);
    carvePassableCorridor(door, x, y, footprintKeys, passable);

    // Piles: anchor-relative offsets from XML <pile><xOffset>/<yOffset>
    // Only carve corridors for piles that actually land inside the footprint.
    for (const pile of info.piles) {
        const pilePos = resolveAnchorRelativePos(x, y, pile.xOffset, pile.yOffset);
        if (footprintKeys.has(tileKey(pilePos.x, pilePos.y))) {
            carvePassableCorridor(pilePos, x, y, footprintKeys, passable);
        }
    }

    return passable;
}

/**
 * Convert an anchor-relative offset to a world tile position.
 *
 * In buildingInfo.xml, door offsets and pile offsets are both stored as
 * tile deltas from the building anchor (the hotspot). This helper applies
 * the offset to the building's world position.
 */
function resolveAnchorRelativePos(anchorX: number, anchorY: number, dx: number, dy: number): { x: number; y: number } {
    return { x: anchorX + dx, y: anchorY + dy };
}

/**
 * Carve a passable corridor from `start` outward through the footprint.
 *
 * Starting from `start`, walks one tile at a time in the direction away from the
 * building anchor. Each step picks the neighbor that maximizes hex distance from
 * the anchor. Stops when reaching a tile outside the footprint (the edge).
 *
 * All tiles along the path (including `start`) are added to `passable`.
 * Maximum 20 steps — more than enough for any building footprint radius.
 */
function carvePassableCorridor(
    start: { x: number; y: number },
    anchorX: number,
    anchorY: number,
    footprintKeys: Set<string>,
    passable: Set<string>
): void {
    passable.add(tileKey(start.x, start.y));

    let current = start;
    for (let step = 0; step < 20; step++) {
        const neighbors = getAllNeighbors(current);
        let bestDist = -1;
        let bestNeighbor: { x: number; y: number } | null = null;
        for (const n of neighbors) {
            const dist = hexDistance(n.x, n.y, anchorX, anchorY);
            if (dist > bestDist) {
                bestDist = dist;
                bestNeighbor = n;
            }
        }
        if (!bestNeighbor) break;
        const key = tileKey(bestNeighbor.x, bestNeighbor.y);
        if (!footprintKeys.has(key)) break; // reached outside the footprint
        passable.add(key);
        current = bestNeighbor;
    }
}

// ── Race-specific display names for buildings with different visuals per race ──

interface BuildingDisplayInfo {
    name: string;
    icon: string;
}

/**
 * Race-specific display names and icons for eyecatchers and other race-variant buildings.
 * Eyecatchers look different per race; this maps (BuildingType, Race) → label + icon for UI.
 */
export const BUILDING_DISPLAY_NAMES: Partial<Record<BuildingType, Record<Race, BuildingDisplayInfo>>> = {
    [BuildingType.Eyecatcher01]: {
        [Race.Roman]: { name: 'Candelabra', icon: '🕯️' },
        [Race.Viking]: { name: 'Torch Post', icon: '🔥' },
        [Race.Mayan]: { name: 'Stone Lamp', icon: '🪔' },
        [Race.Trojan]: { name: 'Oil Lamp', icon: '🏺' },
        [Race.DarkTribe]: { name: 'Candelabra', icon: '🕯️' },
    },
    [BuildingType.Eyecatcher02]: {
        [Race.Roman]: { name: 'Column Statue', icon: '🏛️' },
        [Race.Viking]: { name: 'Runestone', icon: '🪨' },
        [Race.Mayan]: { name: 'Totem Pole', icon: '🗿' },
        [Race.Trojan]: { name: 'Pillar', icon: '🏛️' },
        [Race.DarkTribe]: { name: 'Column Statue', icon: '🏛️' },
    },
    [BuildingType.Eyecatcher03]: {
        [Race.Roman]: { name: 'Eagle Standard', icon: '🦅' },
        [Race.Viking]: { name: 'Banner Pole', icon: '🏴' },
        [Race.Mayan]: { name: 'War Totem', icon: '🗿' },
        [Race.Trojan]: { name: 'War Standard', icon: '⚔️' },
        [Race.DarkTribe]: { name: 'Eagle Standard', icon: '🦅' },
    },
    [BuildingType.Eyecatcher04]: {
        [Race.Roman]: { name: 'Obelisk', icon: '🗼' },
        [Race.Viking]: { name: 'Stone Marker', icon: '🪨' },
        [Race.Mayan]: { name: 'Sun Pillar', icon: '☀️' },
        [Race.Trojan]: { name: 'Monument', icon: '🏛️' },
        [Race.DarkTribe]: { name: 'Obelisk', icon: '🗼' },
    },
    [BuildingType.Eyecatcher05]: {
        [Race.Roman]: { name: 'Garden Bench', icon: '🪑' },
        [Race.Viking]: { name: 'Log Bench', icon: '🪵' },
        [Race.Mayan]: { name: 'Stone Seat', icon: '🪨' },
        [Race.Trojan]: { name: 'Rest Bench', icon: '🪑' },
        [Race.DarkTribe]: { name: 'Garden Bench', icon: '🪑' },
    },
    [BuildingType.Eyecatcher06]: {
        [Race.Roman]: { name: 'Green Arch', icon: '🌿' },
        [Race.Viking]: { name: 'Vine Arch', icon: '🌿' },
        [Race.Mayan]: { name: 'Jungle Arch', icon: '🌴' },
        [Race.Trojan]: { name: 'Garden Arch', icon: '🌿' },
        [Race.DarkTribe]: { name: 'Green Arch', icon: '🌿' },
    },
    [BuildingType.Eyecatcher07]: {
        [Race.Roman]: { name: 'Birdhouse', icon: '🐦' },
        [Race.Viking]: { name: 'Bird Perch', icon: '🐦' },
        [Race.Mayan]: { name: 'Parrot Stand', icon: '🦜' },
        [Race.Trojan]: { name: 'Dovecote', icon: '🕊️' },
        [Race.DarkTribe]: { name: 'Birdhouse', icon: '🐦' },
    },
    [BuildingType.Eyecatcher08]: {
        [Race.Roman]: { name: 'Ivy Gate', icon: '🌿' },
        [Race.Viking]: { name: 'Stone Gate', icon: '⛩️' },
        [Race.Mayan]: { name: 'Temple Gate', icon: '🏛️' },
        [Race.Trojan]: { name: 'City Gate', icon: '🚪' },
        [Race.DarkTribe]: { name: 'Ivy Gate', icon: '🌿' },
    },
    [BuildingType.Eyecatcher09]: {
        [Race.Roman]: { name: 'Ornate Arch', icon: '🏛️' },
        [Race.Viking]: { name: 'Carved Arch', icon: '🪓' },
        [Race.Mayan]: { name: 'Serpent Arch', icon: '🐍' },
        [Race.Trojan]: { name: 'Grand Arch', icon: '🏛️' },
        [Race.DarkTribe]: { name: 'Ornate Arch', icon: '🏛️' },
    },
    [BuildingType.Eyecatcher10]: {
        [Race.Roman]: { name: 'Fire Basket', icon: '🔥' },
        [Race.Viking]: { name: 'Bonfire', icon: '🔥' },
        [Race.Mayan]: { name: 'Flame Bowl', icon: '🔥' },
        [Race.Trojan]: { name: 'Brazier', icon: '🔥' },
        [Race.DarkTribe]: { name: 'Fire Basket', icon: '🔥' },
    },
    [BuildingType.Eyecatcher11]: {
        [Race.Roman]: { name: 'Rider Statue', icon: '🐴' },
        [Race.Viking]: { name: 'Hero Statue', icon: '⚔️' },
        [Race.Mayan]: { name: 'Jaguar Statue', icon: '🐆' },
        [Race.Trojan]: { name: 'Horse Statue', icon: '🐴' },
        [Race.DarkTribe]: { name: 'Rider Statue', icon: '🐴' },
    },
    [BuildingType.Eyecatcher12]: {
        [Race.Roman]: { name: 'Exotic Plant', icon: '🌺' },
        [Race.Viking]: { name: 'Herb Garden', icon: '🌿' },
        [Race.Mayan]: { name: 'Jungle Flower', icon: '🌸' },
        [Race.Trojan]: { name: 'Palm Planter', icon: '🌴' },
        [Race.DarkTribe]: { name: 'Exotic Plant', icon: '🌺' },
    },
};
