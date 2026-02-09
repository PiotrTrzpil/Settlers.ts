/**
 * Unit type definitions and configuration.
 * Centralized unit-related types, enums, and configuration.
 */

import { BuildingType } from './buildings';

export enum UnitType {
    Carrier = 0,
    Builder = 1,
    Swordsman = 2,
    Bowman = 3,
    // Removed: Pikeman = 4 (doesn't exist in S4, race-specific variants are Axewarrior/Blowgunwarrior)
    Priest = 5,
    Pioneer = 6,
    Thief = 7,
    Geologist = 8,
    Woodcutter = 9,
}

/**
 * Upper-level unit categories.
 * Determines selectability and general behavior grouping.
 */
export enum UnitCategory {
    /** Worker units - not selectable, perform automated tasks (Carrier, Builder, Woodcutter) */
    Worker = 'worker',
    /** Military units - selectable, can fight (Swordsman, Bowman) */
    Military = 'military',
    /** Religious units - selectable, special abilities (Priest) */
    Religious = 'religious',
    /** Specialist units - not selectable, perform specific jobs (Pioneer, Thief, Geologist) */
    Specialist = 'specialist',
}

/**
 * Configuration for each unit type.
 * Centralizes all unit properties so adding new types is a single-entry change.
 */
export interface UnitTypeConfig {
    /** Display name for UI */
    name: string;
    /** Upper-level category determining selectability and behavior grouping */
    category: UnitCategory;
    /** Default movement speed in tiles/second */
    speed: number;
}

/**
 * Central registry of unit type configurations.
 * To add a new unit type:
 * 1. Add an entry to the UnitType enum
 * 2. Add its config here
 * 3. Optionally add it to BUILDING_SPAWN_ON_COMPLETE if a building produces it
 */
export const UNIT_TYPE_CONFIG: Record<UnitType, UnitTypeConfig> = {
    [UnitType.Carrier]: { name: 'Carrier', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Builder]: { name: 'Builder', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Swordsman]: { name: 'Swordsman', category: UnitCategory.Military, speed: 2 },
    [UnitType.Bowman]: { name: 'Bowman', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Priest]: { name: 'Priest', category: UnitCategory.Religious, speed: 1.5 },
    [UnitType.Pioneer]: { name: 'Pioneer', category: UnitCategory.Specialist, speed: 2 },
    [UnitType.Thief]: { name: 'Thief', category: UnitCategory.Specialist, speed: 3 },
    [UnitType.Geologist]: { name: 'Geologist', category: UnitCategory.Specialist, speed: 1.5 },
    [UnitType.Woodcutter]: { name: 'Woodcutter', category: UnitCategory.Worker, speed: 2 },
};

/** Categories that allow player selection */
const SELECTABLE_CATEGORIES: ReadonlySet<UnitCategory> = new Set([
    UnitCategory.Military,
    UnitCategory.Religious,
]);

/** Get the category for a unit type. */
export function getUnitCategory(unitType: UnitType): UnitCategory {
    return UNIT_TYPE_CONFIG[unitType]?.category ?? UnitCategory.Worker;
}

/** Check if a unit type is selectable (Military and Religious categories). */
export function isUnitTypeSelectable(unitType: UnitType): boolean {
    const category = getUnitCategory(unitType);
    return SELECTABLE_CATEGORIES.has(category);
}

/** Check if a unit type is military (can fight). */
export function isUnitTypeMilitary(unitType: UnitType): boolean {
    return getUnitCategory(unitType) === UnitCategory.Military;
}

/** Get the default speed for a unit type. */
export function getUnitTypeSpeed(unitType: UnitType): number {
    return UNIT_TYPE_CONFIG[unitType]?.speed ?? 2;
}

/** Get all unit types in a specific category. */
export function getUnitTypesInCategory(category: UnitCategory): UnitType[] {
    return Object.entries(UNIT_TYPE_CONFIG)
        .filter(([, config]) => config.category === category)
        .map(([type]) => Number(type) as UnitType);
}

/** Which unit type each building auto-spawns at placement time (undefined = no auto-spawn) */
export const BUILDING_UNIT_TYPE: Record<number, UnitType | undefined> = {
    [BuildingType.WoodcutterHut]: UnitType.Builder,
    [BuildingType.StorageArea]: undefined,
};
