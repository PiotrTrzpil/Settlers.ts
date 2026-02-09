/**
 * Building system module.
 * Exports building types and sizes only.
 * Construction logic lives in features/building-construction/.
 */

export type { BuildingSize } from './types';
export {
    BuildingType,
    BUILDING_SIZE,
    BUILDING_TYPE_TO_XML_ID,
    getBuildingSize,
    getBuildingFootprint,
    getBuildingHotspot,
    getBuildingXmlId,
} from './types';
