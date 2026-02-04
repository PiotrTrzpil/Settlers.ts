export interface TileCoord {
    x: number;
    y: number;
}

/** Convert tile coordinates to a string key for Map lookups */
export function tileKey(x: number, y: number): string {
    return x + ',' + y;
}

/** 4-directional neighbor offsets (right, left, down, up) */
export const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1]
];

/** 6-directional neighbor offsets (cardinal + two diagonals) */
export const EXTENDED_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]
];

export enum EntityType {
    None = 0,
    Unit = 1,
    Building = 2,
}

export enum BuildingType {
    Guardhouse = 0,
    Woodcutter = 1,
    Warehouse = 2,
}

export enum UnitType {
    Settler = 0,
    Soldier = 1,
}

/** Territory radius for each building type (in tiles) */
export const BUILDING_TERRITORY_RADIUS: Record<number, number> = {
    [BuildingType.Guardhouse]: 8,
    [BuildingType.Woodcutter]: 4,
    [BuildingType.Warehouse]: 6
};

/** Which unit type each building produces (undefined = no auto-spawn) */
export const BUILDING_UNIT_TYPE: Record<number, UnitType | undefined> = {
    [BuildingType.Guardhouse]: UnitType.Soldier,
    [BuildingType.Woodcutter]: UnitType.Settler,
    [BuildingType.Warehouse]: undefined
};

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number;
}

export interface UnitState {
    entityId: number;
    path: TileCoord[];
    pathIndex: number;
    moveProgress: number;
    speed: number;
    /** Previous tile position for visual interpolation */
    prevX: number;
    prevY: number;
}
