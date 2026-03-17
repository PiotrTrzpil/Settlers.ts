/**
 * Building system module.
 * Exports building types only.
 * Construction logic lives in features/building-construction/.
 */

export { BuildingType, getBuildingFootprint, getBuildingHotspot, isMineBuilding, isStorageBuilding } from './types';
