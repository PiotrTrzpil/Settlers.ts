/**
 * Building type definitions and configuration.
 * Centralized building-related types, enums, and size configurations.
 */

import type { TileCoord } from '../coordinates';
import { Race } from '../race';
import { getBuildingFootprintAt } from '@/resources/game-data';
import { getBuildingInfo } from '../game-data-access';
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
 * Building footprint size in tiles (width x height).
 * Most buildings are 2x2, some are 3x3, decorations are 1x1.
 */
export interface BuildingSize {
    width: number;
    height: number;
}

/** Building footprint sizes for each building type */
export const BUILDING_SIZE: Record<number, BuildingSize> = {
    // Small buildings (1x1)
    [BuildingType.Eyecatcher01]: { width: 1, height: 1 },

    // Medium buildings (2x2) - most production buildings
    [BuildingType.WoodcutterHut]: { width: 2, height: 2 },
    [BuildingType.Sawmill]: { width: 2, height: 2 },
    [BuildingType.StonecutterHut]: { width: 2, height: 2 },
    [BuildingType.GrainFarm]: { width: 2, height: 2 },
    [BuildingType.Mill]: { width: 2, height: 2 },
    [BuildingType.Bakery]: { width: 2, height: 2 },
    [BuildingType.FisherHut]: { width: 2, height: 2 },
    [BuildingType.AnimalRanch]: { width: 2, height: 2 },
    [BuildingType.Slaughterhouse]: { width: 2, height: 2 },
    [BuildingType.WaterworkHut]: { width: 2, height: 2 },
    [BuildingType.CoalMine]: { width: 2, height: 2 },
    [BuildingType.IronMine]: { width: 2, height: 2 },
    [BuildingType.GoldMine]: { width: 2, height: 2 },
    [BuildingType.IronSmelter]: { width: 2, height: 2 },
    [BuildingType.SmeltGold]: { width: 2, height: 2 },
    [BuildingType.WeaponSmith]: { width: 2, height: 2 },
    [BuildingType.ToolSmith]: { width: 2, height: 2 },
    [BuildingType.ForesterHut]: { width: 2, height: 2 },
    [BuildingType.LivingHouse]: { width: 2, height: 2 },
    [BuildingType.HunterHut]: { width: 2, height: 2 },
    [BuildingType.DonkeyRanch]: { width: 2, height: 2 },
    [BuildingType.StoneMine]: { width: 2, height: 2 },
    [BuildingType.SulfurMine]: { width: 2, height: 2 },
    [BuildingType.HealerHut]: { width: 2, height: 2 },
    [BuildingType.ResidenceSmall]: { width: 2, height: 2 },
    [BuildingType.ResidenceMedium]: { width: 2, height: 2 },
    [BuildingType.AmmunitionMaker]: { width: 2, height: 2 },
    [BuildingType.SmallTemple]: { width: 2, height: 2 },
    [BuildingType.Vinyard]: { width: 2, height: 2 },
    [BuildingType.AgaveFarmerHut]: { width: 2, height: 2 },
    [BuildingType.TequilaMakerHut]: { width: 2, height: 2 },
    [BuildingType.BeekeeperHut]: { width: 2, height: 2 },
    [BuildingType.MeadMakerHut]: { width: 2, height: 2 },
    [BuildingType.SunflowerFarmerHut]: { width: 2, height: 2 },
    [BuildingType.SunflowerOilMakerHut]: { width: 2, height: 2 },
    [BuildingType.MushroomFarm]: { width: 2, height: 2 },

    // Military buildings (2x2)
    [BuildingType.GuardTowerSmall]: { width: 2, height: 2 },
    [BuildingType.Barrack]: { width: 2, height: 2 },
    [BuildingType.LookoutTower]: { width: 2, height: 2 },

    // Large buildings (3x3)
    [BuildingType.StorageArea]: { width: 3, height: 3 },
    [BuildingType.ResidenceBig]: { width: 3, height: 3 },
    [BuildingType.GuardTowerBig]: { width: 3, height: 3 },
    [BuildingType.Castle]: { width: 3, height: 3 },
    [BuildingType.LargeTemple]: { width: 3, height: 3 },
    [BuildingType.Shipyard]: { width: 3, height: 3 },
    [BuildingType.SiegeWorkshop]: { width: 3, height: 3 },
    [BuildingType.Eyecatcher02]: { width: 3, height: 3 },
    // Dark Tribe large buildings
    [BuildingType.DarkTemple]: { width: 3, height: 3 },
    [BuildingType.Fortress]: { width: 3, height: 3 },
    [BuildingType.ManaCopterHall]: { width: 3, height: 3 },
};

/** Get building size, defaults to 2x2 if not specified */
export function getBuildingSize(buildingType: BuildingType): BuildingSize {
    return BUILDING_SIZE[buildingType] ?? { width: 2, height: 2 };
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
    if (info.buildingPosLines.length > 0) {
        return getBuildingFootprintAt(info, x, y);
    }

    // Fallback to simple rectangular footprint for buildings with no bitmask data
    const size = getBuildingSize(buildingType);
    const tiles: TileCoord[] = [];
    for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
            tiles.push({ x: x + dx, y: y + dy });
        }
    }
    return tiles;
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
