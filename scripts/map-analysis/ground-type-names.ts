/**
 * Ground type display names and terrain group classification.
 * Maps S4GroundType numeric values to human-readable names and groups.
 */
import { S4GroundType } from '../../src/resources/map/s4-types';

/** High-level terrain group for aggregated statistics. */
export type TerrainGroup =
    | 'Water'
    | 'Grass'
    | 'DarkGrass'
    | 'Rock'
    | 'Beach'
    | 'Desert'
    | 'Swamp'
    | 'River'
    | 'Snow'
    | 'Mud'
    | 'Road';

interface GroundTypeInfo {
    name: string;
    group: TerrainGroup;
}

const GROUND_TYPE_INFO: Record<number, GroundTypeInfo> = {
    [S4GroundType.WATER1]: { name: 'Water1', group: 'Water' },
    [S4GroundType.WATER2]: { name: 'Water2', group: 'Water' },
    [S4GroundType.WATER3]: { name: 'Water3', group: 'Water' },
    [S4GroundType.WATER4]: { name: 'Water4', group: 'Water' },
    [S4GroundType.WATER5]: { name: 'Water5', group: 'Water' },
    [S4GroundType.WATER6]: { name: 'Water6', group: 'Water' },
    [S4GroundType.WATER7]: { name: 'Water7', group: 'Water' },
    [S4GroundType.WATER8]: { name: 'Water8', group: 'Water' },
    [S4GroundType.GRASS]: { name: 'Grass', group: 'Grass' },
    [S4GroundType.GRASS_ROCK]: { name: 'Grass/Rock', group: 'Grass' },
    [S4GroundType.GRASS_ISLE]: { name: 'Grass/Isle', group: 'Grass' },
    [S4GroundType.GRASS_DESERT]: { name: 'Grass/Desert', group: 'Grass' },
    [S4GroundType.GRASS_SWAMP]: { name: 'Grass/Swamp', group: 'Grass' },
    [S4GroundType.GRASS_MUD]: { name: 'Grass/Mud', group: 'Grass' },
    [S4GroundType.DARKGRASS]: { name: 'DarkGrass', group: 'DarkGrass' },
    [S4GroundType.DARKGRASS_GRASS]: { name: 'DarkGrass/Grass', group: 'DarkGrass' },
    [S4GroundType.SANDYROAD]: { name: 'SandyRoad', group: 'Road' },
    [S4GroundType.COBBLEDROAD]: { name: 'CobbledRoad', group: 'Road' },
    [S4GroundType.ROCK]: { name: 'Rock', group: 'Rock' },
    [S4GroundType.ROCK_GRASS]: { name: 'Rock/Grass', group: 'Rock' },
    [S4GroundType.ROCK_SNOW]: { name: 'Rock/Snow', group: 'Rock' },
    [S4GroundType.BEACH]: { name: 'Beach', group: 'Beach' },
    [S4GroundType.DESERT]: { name: 'Desert', group: 'Desert' },
    [S4GroundType.DESERT_GRASS]: { name: 'Desert/Grass', group: 'Desert' },
    [S4GroundType.SWAMP]: { name: 'Swamp', group: 'Swamp' },
    [S4GroundType.SWAMP_GRASS]: { name: 'Swamp/Grass', group: 'Swamp' },
    [S4GroundType.RIVER1]: { name: 'River1', group: 'River' },
    [S4GroundType.RIVER2]: { name: 'River2', group: 'River' },
    [S4GroundType.RIVER3]: { name: 'River3', group: 'River' },
    [S4GroundType.RIVER4]: { name: 'River4', group: 'River' },
    [S4GroundType.SNOW]: { name: 'Snow', group: 'Snow' },
    [S4GroundType.SNOW_ROCK]: { name: 'Snow/Rock', group: 'Snow' },
    [S4GroundType.MUD]: { name: 'Mud', group: 'Mud' },
    [S4GroundType.MUD_GRASS]: { name: 'Mud/Grass', group: 'Mud' },
};

/** Get human-readable name for a ground type value. */
export function getGroundTypeName(gt: number): string {
    return GROUND_TYPE_INFO[gt]?.name ?? `Unknown(${gt})`;
}

/** Get the terrain group for a ground type value. */
export function getTerrainGroup(gt: number): TerrainGroup {
    return GROUND_TYPE_INFO[gt]?.group ?? 'Grass';
}

/** All terrain groups in display order. */
export const TERRAIN_GROUPS: readonly TerrainGroup[] = [
    'Grass',
    'DarkGrass',
    'Rock',
    'Desert',
    'Beach',
    'River',
    'Water',
    'Snow',
    'Swamp',
    'Mud',
    'Road',
];
