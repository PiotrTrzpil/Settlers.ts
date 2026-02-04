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
    path: { x: number; y: number }[];
    pathIndex: number;
    moveProgress: number;
    speed: number;
}
