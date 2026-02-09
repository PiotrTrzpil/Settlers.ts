/**
 * Economy Module — Public API
 *
 * All external code should import from this barrel file.
 */

// Material types and utilities
export {
    EMaterialType,
    DROPPABLE_MATERIALS,
    MATERIAL_CONFIGS,
    isMaterialDroppable,
    getMaterialPriority,
} from './material-type';

export type { MaterialTypeConfig } from './material-type';

// Production chains and construction costs
export {
    BUILDING_PRODUCTIONS,
    CONSTRUCTION_COSTS,
    getBuildingTypesRequestingMaterial,
} from './building-production';

export type { ProductionChain, ConstructionCost } from './building-production';
