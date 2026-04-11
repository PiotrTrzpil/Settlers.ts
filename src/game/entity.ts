/**
 * Core entity types and coordinates.
 * This is a barrel file that re-exports from specialized modules.
 */

/** Material carrying state - used by any unit that can carry materials */
import type { EMaterialType } from './economy';
import type { Race } from './core/race';
import type { PileKind } from './core/pile-kind';

export interface CarryingState {
    material: EMaterialType;
    amount: number;
}

// === Re-export coordinates (base types with no dependencies) ===
export type { Tile, Coords, TileOffset, Offset, TileWithEntity } from './core/coordinates';
export { tileKey, CARDINAL_OFFSETS, EXTENDED_OFFSETS, isInMapBounds } from './core/coordinates';

// === Core Types (defined here) ===

export enum EntityType {
    None = 0,
    Unit = 1,
    Building = 2,
    /** Map objects like trees, stones, resources */
    MapObject = 3,
    /** Stacked piles on the ground (logs, planks, etc.) */
    StackedPile = 4,
    /** Visual-only decorations (flags, signs) — no tile occupancy */
    Decoration = 5,
}

// === Re-exports from specialized modules ===

// Building types
export {
    BuildingType,
    getBuildingFootprint,
    getBuildingBlockArea,
    getBuildingHotspot,
    isMineBuilding,
    isStorageBuilding,
} from './buildings';

// Unit types and configuration
export type { UnitTypeConfig } from './core/unit-types';
export {
    UnitType,
    UnitCategory,
    UNIT_TYPE_CONFIG,
    getUnitCategory,
    isUnitTypeSelectable,
    isUnitTypeMilitary,
    getUnitTypeSpeed,
    getUnitTypesInCategory,
    getUnitLevel,
    getBaseUnitType,
    getLevelVariants,
    getUnitTypeAtLevel,
} from './core/unit-types';

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number | string;
    /** Whether this entity can be selected by the player. Defaults to true if not specified. */
    selectable?: boolean;

    /**
     * Race/civilization this entity belongs to.
     * Determines which sprite set is used for rendering.
     * Set from the owning player's tribe when loading from map, or from the UI selection when placing.
     * Required for buildings and units; unused for map objects and stacked piles.
     */
    race: Race;

    /**
     * Material being carried by this unit.
     * Present for any unit currently carrying materials (carriers, woodcutters, farmers, etc.)
     * Set on PICKUP, cleared on DROPOFF.
     */
    carrying?: CarryingState;

    /**
     * Military unit level (1-3). Defaults to 1.
     * Affects combat stats, idle/walk sprites, and fight animations.
     */
    level?: number;

    /**
     * When true, the entity is not rendered (e.g., a settler inside a building).
     */
    hidden?: boolean;

    /**
     * Numeric job identifier. Set when a job is assigned, cleared when the job
     * completes or is interrupted. Undefined means the unit is idle.
     * Persisted with the entity.
     *
     * Allocated from GameState.allocateJobId(). All job types share one ID space.
     */
    jobId?: number;

    /**
     * Extra depth added during sort. Positive values push the entity in front of others.
     * Used by debug tools (e.g., stack-adjust preview sprites).
     */
    depthBias?: number;

    /**
     * Whether this entity is in its functional/operational state.
     * Buildings: false during construction, true when completed.
     * Trees: false while growing, true when mature and harvestable.
     * Defaults to true for entities that don't have a construction/growth phase.
     */
    operational: boolean;
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
// Typed entity access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get an entity by ID, throwing if it doesn't exist or isn't the expected type.
 * Use when the entity MUST exist and MUST be a specific EntityType.
 *
 * ```ts
 * const building = getEntityOfType(gameState, id, EntityType.Building, 'siege target');
 * ```
 */
export function getEntityOfType(
    provider: EntityProvider,
    id: number,
    expectedType: EntityType,
    context?: string
): Entity {
    const entity = provider.getEntityOrThrow(id, context);
    if (entity.type !== expectedType) {
        const ctx = context ? ` (${context})` : '';
        throw new Error(`Entity ${id}${ctx} is ${EntityType[entity.type]}, expected ${EntityType[expectedType]}`);
    }
    return entity;
}

/**
 * Get an entity by ID if it exists and matches the expected type. Returns undefined otherwise.
 * Use at API boundaries where the entity may not exist or may be a different type.
 *
 * ```ts
 * const unit = getEntityIfType(gameState, id, EntityType.Unit);
 * if (!unit) return;
 * ```
 */
export function getEntityIfType(provider: EntityProvider, id: number, expectedType: EntityType): Entity | undefined {
    const entity = provider.getEntity(id);
    if (!entity || entity.type !== expectedType) {
        return undefined;
    }
    return entity;
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
        throw new Error(`getCarryingState: entity ${entity.id} is not carrying anything`);
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
 * Clear the job ID on an entity (unit becomes idle).
 */
export function clearJobId(entity: Entity): void {
    entity.jobId = undefined;
}

/**
 * Maximum items that can be stacked in a single pile.
 * This matches Settlers 4 behavior where carriers drop resources in stacks.
 */
export const MAX_PILE_SIZE = 8;

/**
 * State tracking for stacked piles on the ground.
 * These are mutable - carriers can add to or take from stacks.
 */
export interface StackedPileState {
    entityId: number;
    /** Number of items in the stack (1 to MAX_RESOURCE_STACK_SIZE) */
    quantity: number;
    /**
     * Describes what kind of pile this is and which building it belongs to (if any).
     * Free piles can be picked up by carriers; linked piles are reserved for their building.
     */
    kind: PileKind;
}

export type { PileKind };
