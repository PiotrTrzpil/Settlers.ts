/**
 * Placement validation types.
 * Defines statuses, contexts, and validator interfaces for entity placement.
 */

import type { MapSize } from '@/utilities/map-size';
import type { Race } from '../../race';

/**
 * Placement status indicating why/how placement can or cannot occur.
 * Used for both validation and visual feedback.
 */
export enum PlacementStatus {
    /** Cannot place - invalid terrain (water, rock, etc.) */
    InvalidTerrain = 0,
    /** Cannot place - tile is occupied */
    Occupied = 1,
    /** Cannot place - slope too steep */
    TooSteep = 2,
    /** Can place - difficult (high slope) */
    Difficult = 3,
    /** Can place - medium difficulty */
    Medium = 4,
    /** Can place - easy (flat terrain) */
    Easy = 5,
}

/**
 * Entity types that can be placed on the map.
 */
export type PlacementEntityType = 'building' | 'resource' | 'unit';

/**
 * Game context required for placement validation.
 */
export interface PlacementContext {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    tileOccupancy: Map<string, number>;
    /**
     * Race of the player placing the building.
     * Required for building placement — validateBuildingPlacement throws if absent.
     * Optional for resource/unit validators which don't use race.
     */
    race?: Race;
}

/**
 * Result of placement validation with detailed status.
 */
export interface PlacementResult {
    /** Whether placement is allowed */
    canPlace: boolean;
    /** Detailed status for visual feedback */
    status: PlacementStatus;
}

/**
 * Validator function signature for placement modes.
 */
export type PlacementValidator = (x: number, y: number, subType: number) => boolean;

/**
 * Detailed validator that returns status information.
 */
export type DetailedPlacementValidator = (x: number, y: number, subType: number) => PlacementResult;
