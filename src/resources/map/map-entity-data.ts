/**
 * Map Entity Data Types
 * Interfaces for parsed entity data from map file chunks
 */

import { S4Tribe, S4BuildingType, S4SettlerType, S4GoodType } from './s4-types';

/** Player information from MapPlayerInformation chunk (type 2) */
export interface MapPlayerInfo {
    playerIndex: number;
    tribe: S4Tribe;
    /** Starting X position (if available in map data) */
    startX?: number;
    /** Starting Y position (if available in map data) */
    startY?: number;
}

/** Building data from MapBuildings chunk (type 8) */
export interface MapBuildingData {
    x: number;
    y: number;
    buildingType: S4BuildingType;
    player: number;
}

/** Settler data from MapSettlers chunk (type 7) */
export interface MapSettlerData {
    x: number;
    y: number;
    settlerType: S4SettlerType;
    player: number;
}

/** Stack/pile data from MapStacks chunk (type 9) */
export interface MapStackData {
    x: number;
    y: number;
    materialType: S4GoodType;
    amount: number;
}

/** Aggregated entity data from all entity chunks */
export interface MapEntityData {
    players: MapPlayerInfo[];
    buildings: MapBuildingData[];
    settlers: MapSettlerData[];
    stacks: MapStackData[];
}

/** Create an empty MapEntityData object */
export function createEmptyEntityData(): MapEntityData {
    return {
        players: [],
        buildings: [],
        settlers: [],
        stacks: [],
    };
}
