/**
 * Core entity types and coordinates.
 * This is a barrel file that re-exports from specialized modules.
 */

import type { TileCoord } from './coordinates';

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
    getBuildingSize,
    getBuildingFootprint,
} from './buildings';

// Unit types and configuration
export type { UnitTypeConfig } from './unit-types';
export {
    UnitType,
    UNIT_TYPE_CONFIG,
    isUnitTypeSelectable,
    getUnitTypeSpeed,
    BUILDING_UNIT_TYPE,
} from './unit-types';

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number;
    /** Optional animation state for animated entities */
    animationState?: import('./animation').AnimationState;
    /** Whether this entity can be selected by the player. Defaults to true if not specified. */
    selectable?: boolean;
    /**
     * Optional variation index for entities that support visual variants (e.g. trees).
     * Default is 0.
     */
    variation?: number;
    /**
     * Material type being carried by a bearer unit.
     * undefined means the bearer is empty (not carrying anything).
     * Only meaningful for UnitType.Bearer entities.
     */
    carriedMaterial?: import('./economy/material-type').EMaterialType;
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
    /** Time spent idle (no path) in seconds */
    idleTime: number;
    /** Random threshold for next idle direction change (seconds) */
    nextIdleTurnTime: number;
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
}
