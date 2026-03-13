/** Which slot role a unit fills. Only Swordsman and Bowman unit types are valid. */
export type GarrisonRole = 'swordsman' | 'bowman';

export interface GarrisonSlotSet {
    max: number;
    unitIds: number[]; // ordered by garrison time (earliest first)
}

export interface BuildingGarrisonState {
    buildingId: number;
    swordsmanSlots: GarrisonSlotSet;
    bowmanSlots: GarrisonSlotSet;
}
