/**
 * Garrison dispatch — sends a unit to a tower door to enter it, as an owned `Garrison` job.
 *
 * Used by garrison commands (player-initiated / auto-garrison) and, through
 * `TowerGarrisonManager.dispatchUnitToGarrison`, by the siege system (capture).
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { JobService, WorkerAssignments } from '@/game/features/settler-tasks';
import { JobKind, type JobSpec } from '@/game/systems/choreo';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { createLogger } from '@/utilities/logger';
import type { GarrisonJobParams } from './garrison-job-kind';

const log = createLogger('GarrisonDispatch');

export interface GarrisonDispatchDeps {
    gameState: GameState;
    terrain: TerrainData;
    jobs: JobService;
    workerAssignments: WorkerAssignments;
}

/** The Garrison job of a unit walking into `towerId` (reserved: player moves are rejected). */
export function garrisonJobSpec(towerId: number): JobSpec<GarrisonJobParams> {
    return { kind: JobKind.Garrison, ref: towerId, params: { towerId }, reserved: true };
}

/**
 * Assign the unit a Garrison job (walk to the door, enter) and mark it approaching the tower.
 *
 * Returns true if the unit was dispatched (walking, or already at the door). False when the door
 * is unreachable — nothing is assigned then.
 */
export function dispatchUnitToGarrison(unitId: number, towerId: number, deps: GarrisonDispatchDeps): boolean {
    const { gameState, terrain, jobs, workerAssignments } = deps;
    const tower = gameState.getEntityOrThrow(towerId, 'garrison dispatch target');
    const unit = gameState.getEntityOrThrow(unitId, 'garrison dispatch');
    const door = findBuildingApproachTile(tower, terrain, gameState);
    const atDoor = unit.x === door.x && unit.y === door.y;

    if (!jobs.assign(unitId, garrisonJobSpec(towerId), atDoor ? undefined : { moveTo: door })) {
        log.warn(`Dispatch failed: unit ${unitId} cannot reach building ${towerId}`);
        return false;
    }
    workerAssignments.assignWorker(unitId, towerId);
    return true;
}
