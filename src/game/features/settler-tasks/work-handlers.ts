/**
 * Work handler factories for built-in settler types.
 *
 * Each factory creates a WorkHandler that plugs into SettlerTaskSystem.
 * Handlers are stateless closures over their dependencies (game state, domain systems).
 *
 * Built-in handlers: GOOD (carrier dummy), WATER (waterworker).
 * Domain handlers (WORKPLACE production, TREE, STONE, crops, geologist) are registered by their own features.
 */

import { WorkHandlerType, type NullWorkHandler, type PositionWorkHandler } from './types';
import { asBounded } from './choreo-types';
import { findNearestTile } from '../../systems/spatial-search';
import type { TerrainData } from '../../terrain';

// ─────────────────────────────────────────────────────────────
// Built-in handlers (no external domain system dependency)
// ─────────────────────────────────────────────────────────────

/**
 * Create a handler for GOOD search type (carriers).
 *
 * Carriers don't find work themselves — they get jobs assigned externally
 * as Transport jobs (`JobService.assign`). This null handler exists to
 * suppress "no handler registered" warnings while keeping idle carriers silent.
 */
export function createCarrierHandler(): NullWorkHandler {
    return {
        type: WorkHandlerType.NULL,
        shouldWaitForWork: true,
    };
}

// ─────────────────────────────────────────────────────────────
// Water handler (waterworker — draws water from river tiles)
// ─────────────────────────────────────────────────────────────

/** River ground types (S4GroundType.RIVER1–RIVER4) */
const RIVER_TYPE_MIN = 96;
const RIVER_TYPE_MAX = 99;
function isRiverTile(groundType: number): boolean {
    return groundType >= RIVER_TYPE_MIN && groundType <= RIVER_TYPE_MAX;
}

/**
 * Create a position handler for WATER search type (waterworkers).
 * Worker walks to a nearby river tile within the work area to draw water.
 * Output deposit is handled by the choreography PUT_GOOD node (entity=GOOD_WATER),
 * not by this handler — keeping a single deposit code path through the inventory executors.
 */
export function createWaterHandler(terrain: TerrainData): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,

        findPosition: area => {
            const { center, radius } = asBounded(area);
            return findNearestTile(
                center,
                radius,
                tile => terrain.isInBounds(tile) && isRiverTile(terrain.groundType[terrain.toIndex(tile)]!)
            );
        },

        onWorkAtPositionComplete: () => {
            // No-op: deposit handled by PUT_GOOD choreography node
        },
    };
}
