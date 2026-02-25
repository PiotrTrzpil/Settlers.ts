/**
 * Core entity types and coordinates.
 * This is a barrel file that re-exports from specialized modules.
 */

/** Material carrying state - used by any unit that can carry materials */
import type { EMaterialType } from './economy';
import type { Race } from './race';

export interface CarryingState {
    material: EMaterialType;
    amount: number;
}

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
    isMineBuilding,
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

    /**
     * Race/civilization this entity belongs to (matches Race enum values: 10=Roman, 11=Viking, etc.).
     * Determines which sprite set is used for rendering.
     * Set from the owning player's tribe when loading from map, or from the UI selection when placing.
     * Required for buildings and units; unused for map objects and stacked resources.
     */
    race: Race;

    /**
     * Material being carried by this unit.
     * Present for any unit currently carrying materials (carriers, woodcutters, farmers, etc.)
     * Set on PICKUP, cleared on DROPOFF.
     */
    carrying?: CarryingState;
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
// Carrying helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get carrying state from an entity, throwing if not present.
 * Use when the entity MUST be carrying something.
 */
export function getCarryingState(entity: Entity): NonNullable<Entity['carrying']> {
    if (!entity.carrying) {
        throw new Error(`Entity ${entity.id} is not carrying anything`);
    }
    return entity.carrying;
}

/**
 * Set the carrying state on an entity.
 */
export function setCarrying(entity: Entity, material: EMaterialType, amount: number): void {
    entity.carrying = { material, amount };
}

/**
 * Clear the carrying state on an entity.
 */
export function clearCarrying(entity: Entity): void {
    entity.carrying = undefined;
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
