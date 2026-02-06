/**
 * Unit type definitions and configuration.
 * Centralized unit-related types, enums, and configuration.
 */

import { BuildingType } from './buildings';

export enum UnitType {
    Bearer = 0,
    Builder = 1,
    Swordsman = 2,
    Bowman = 3,
    Pikeman = 4,
    Priest = 5,
    Pioneer = 6,
    Thief = 7,
    Geologist = 8,
}

/**
 * Configuration for each unit type.
 * Centralizes all unit properties so adding new types is a single-entry change.
 */
export interface UnitTypeConfig {
    /** Display name for UI */
    name: string;
    /** Default movement speed in tiles/second */
    speed: number;
    /** Whether units of this type are selectable by the player */
    selectable: boolean;
    /** Whether this is a military unit (can fight) */
    military: boolean;
}

/**
 * Central registry of unit type configurations.
 * To add a new unit type:
 * 1. Add an entry to the UnitType enum
 * 2. Add its config here
 * 3. Optionally add it to BUILDING_SPAWN_ON_COMPLETE if a building produces it
 */
export const UNIT_TYPE_CONFIG: Record<UnitType, UnitTypeConfig> = {
    [UnitType.Bearer]: { name: 'Bearer', speed: 2, selectable: false, military: false },
    [UnitType.Builder]: { name: 'Builder', speed: 2, selectable: true, military: false },
    [UnitType.Swordsman]: { name: 'Swordsman', speed: 2, selectable: true, military: true },
    [UnitType.Bowman]: { name: 'Bowman', speed: 2.2, selectable: true, military: true },
    [UnitType.Pikeman]: { name: 'Pikeman', speed: 1.8, selectable: true, military: true },
    [UnitType.Priest]: { name: 'Priest', speed: 1.5, selectable: true, military: false },
    [UnitType.Pioneer]: { name: 'Pioneer', speed: 2, selectable: true, military: false },
    [UnitType.Thief]: { name: 'Thief', speed: 3, selectable: true, military: false },
    [UnitType.Geologist]: { name: 'Geologist', speed: 1.5, selectable: true, military: false },
};

/** Get the default selectable state for a unit type. */
export function isUnitTypeSelectable(unitType: UnitType): boolean {
    return UNIT_TYPE_CONFIG[unitType]?.selectable ?? true;
}

/** Get the default speed for a unit type. */
export function getUnitTypeSpeed(unitType: UnitType): number {
    return UNIT_TYPE_CONFIG[unitType]?.speed ?? 2;
}

/** Which unit type each building auto-spawns at placement time (undefined = no auto-spawn) */
export const BUILDING_UNIT_TYPE: Record<number, UnitType | undefined> = {
    [BuildingType.Lumberjack]: UnitType.Builder,
    [BuildingType.Warehouse]: undefined,
};
