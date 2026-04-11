/** Which slot role a unit fills. Only Swordsman and Bowman unit types are valid. */
export type GarrisonRole = 'swordsman' | 'bowman';

/** Links a garrisoned unit to its tower via a proper job ID. */
export interface GarrisonJobRecord {
    readonly jobId: number;
    readonly unitId: number;
    readonly buildingId: number;
}

export interface GarrisonSlotSet {
    max: number;
    unitIds: number[]; // ordered by garrison time (earliest first)
}

export interface BuildingGarrisonState {
    buildingId: number;
    swordsmanSlots: GarrisonSlotSet;
    bowmanSlots: GarrisonSlotSet;
}
