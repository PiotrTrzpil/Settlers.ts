/**
 * Core entity types and coordinates.
 * This is a barrel file that re-exports from specialized modules.
 */


// === Entity State Types (imported for Entity interface) ===
// These are imported as types to avoid circular dependencies.
// The actual implementations live in their respective systems/features.

/** Tree growth/cutting state - see TreeSystem */
export type { TreeState, TreeStage } from './systems/tree-system';

/** Production cycle state - see ProductionSystem */
export type { ProductionState } from './systems/production-system';

/** Building construction state - see BuildingStateManager */
export type { BuildingState } from './features/building-construction/types';

/** Carrier job/status state - see CarrierManager */
export type { CarrierState, CarrierStatus, CarrierJob } from './features/carriers/carrier-state';

// === Re-export coordinates (base types with no dependencies) ===
export type { TileCoord } from './coordinates';
export { tileKey, CARDINAL_OFFSETS, EXTENDED_OFFSETS } from './coordinates';

// === Core Types (defined here) ===

export enum EntityType {
    None = 0,
    Unit = 1,
    Building = 2,
    /** Map objects like trees, stones, resources */
    MapObject = 3,
    /** Stacked resources on the ground (logs, planks, etc.) */
    StackedResource = 4,
}

// === Re-exports from specialized modules ===

// Map object types
export { MapObjectType } from './map-object-types';

// Building types and sizes
export type { BuildingSize } from './buildings';
export {
    BuildingType,
    BUILDING_SIZE,
    BUILDING_TYPE_TO_XML_ID,
    getBuildingSize,
    getBuildingFootprint,
    getBuildingHotspot,
    getBuildingXmlId,
} from './buildings';

// Unit types and configuration
export type { UnitTypeConfig } from './unit-types';
export {
    UnitType,
    UnitCategory,
    UNIT_TYPE_CONFIG,
    getUnitCategory,
    isUnitTypeSelectable,
    isUnitTypeMilitary,
    getUnitTypeSpeed,
    getUnitTypesInCategory,
    BUILDING_UNIT_TYPE,
} from './unit-types';

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number;
    /** Whether this entity can be selected by the player. Defaults to true if not specified. */
    selectable?: boolean;
    /**
     * Optional variation index for entities that support visual variants (e.g. trees).
     * Default is 0.
     */
    variation?: number;
    // === Per-Entity State (RFC: Entity-Owned State) ===
    // State that lives on the entity rather than in system Maps.
    // See docs/rfcs/entity-component-architecture.md

    /**
     * Tree growth/cutting state.
     * Only present for MapObject entities that are trees.
     */
    tree?: import('./systems/tree-system').TreeState;

    /**
     * Production cycle state.
     * Only present for buildings that produce goods.
     */
    production?: import('./systems/production-system').ProductionState;

    /**
     * Building construction state.
     * Present for all buildings - tracks construction phase (including Completed).
     */
    construction?: import('./features/building-construction/types').BuildingState;

    /**
     * Carrier job and status state.
     * Only present for carrier units.
     */
    carrier?: import('./features/carriers/carrier-state').CarrierState;
}

/**
 * Interface for accessing entities without circular dependencies.
 * Used by managers that need entity access but are owned by GameState.
 */
export interface EntityProvider {
    getEntity(id: number): Entity | undefined;
    getEntityOrThrow(id: number, context?: string): Entity;
    get entities(): Entity[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component helpers - throw with context when accessing required components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get carrier state from an entity, throwing if not present.
 * Use when the entity MUST be a carrier.
 */
export function getCarrierState(entity: Entity): NonNullable<Entity['carrier']> {
    if (!entity.carrier) {
        throw new Error(`Entity ${entity.id} is not a carrier (has no carrier state)`);
    }
    return entity.carrier;
}

/**
 * Get tree state from an entity, throwing if not present.
 * Use when the entity MUST be a tree.
 */
export function getTreeState(entity: Entity): NonNullable<Entity['tree']> {
    if (!entity.tree) {
        throw new Error(`Entity ${entity.id} is not a tree (has no tree state)`);
    }
    return entity.tree;
}

/**
 * Get construction state from an entity, throwing if not present.
 * Use when the entity MUST have construction state.
 */
export function getConstructionState(entity: Entity): NonNullable<Entity['construction']> {
    if (!entity.construction) {
        throw new Error(`Entity ${entity.id} has no construction state`);
    }
    return entity.construction;
}

/**
 * Maximum items that can be stacked in a single resource pile.
 * This matches Settlers 4 behavior where carriers drop resources in stacks.
 */
export const MAX_RESOURCE_STACK_SIZE = 8;

/**
 * State tracking for stacked resources on the ground.
 * These are mutable - carriers can add to or take from stacks.
 */
export interface StackedResourceState {
    entityId: number;
    /** Number of items in the stack (1 to MAX_RESOURCE_STACK_SIZE) */
    quantity: number;
    /**
     * If set, this resource pile is a visual representation of a building's inventory.
     * Resources with a buildingId are reserved for that building and should not be
     * picked up by carriers or used by other systems.
     */
    buildingId?: number;
}
