/**
 * Building system module.
 * Exports building types and sizes only.
 * Construction logic lives in features/building-construction/.
 */

export type { BuildingSize } from './types';
export {
    BuildingType,
    BUILDING_SIZE,
    getBuildingSize,
    getBuildingFootprint,
} from './types';
