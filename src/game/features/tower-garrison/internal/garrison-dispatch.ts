/**
 * Shared garrison dispatch utility — sends a unit to a building door and enters.
 *
 * Used by both garrison commands (player-initiated) and the siege system (capture).
 * Handles the common pattern: reserve → assignWorker → choreo → at-door fallback.
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { TaskDispatcher, WorkerAssignments } from '@/game/features/settler-tasks';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import { JobKind } from '@/game/systems/choreo/types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('GarrisonDispatch');

export interface GarrisonDispatchDeps {
    gameState: GameState;
    terrain: TerrainData;
    unitReservation: UnitReservationRegistry;
    taskDispatcher: TaskDispatcher;
    workerAssignments: WorkerAssignments;
}

/**
 * Reserve a unit, assign it to a building, and dispatch it to walk to the door and enter.
 *
 * Returns true if the unit was successfully dispatched (walking or already at door).
 * On failure, all partial state is rolled back (reservation, worker assignment).
 */
export function dispatchUnitToGarrison(unitId: number, buildingId: number, deps: GarrisonDispatchDeps): boolean {
    const { gameState, terrain, unitReservation, taskDispatcher, workerAssignments } = deps;

    unitReservation.reserve(unitId, {
        purpose: 'garrison-en-route',
        onForcedRelease: () => {},
    });

    try {
        const job = choreo('WORKER_DISPATCH', JobKind.Garrison)
            .goToDoorAndEnter(buildingId, { gameState, terrain })
            .build();
        const assigned = taskDispatcher.assignJob(unitId, job, job.targetPos ?? undefined);

        if (assigned) {
            workerAssignments.assignWorker(unitId, buildingId);
            return true;
        }

        // Path not found — check if unit is already at the door
        const unit = gameState.getEntityOrThrow(unitId, 'garrison dispatch');
        if (job.targetPos && unit.x === job.targetPos.x && unit.y === job.targetPos.y) {
            taskDispatcher.assignJob(unitId, job);
            workerAssignments.assignWorker(unitId, buildingId);
            return true;
        }

        // Genuinely unreachable — roll back
        unitReservation.release(unitId);
        log.warn(`Dispatch failed: unit ${unitId} cannot reach building ${buildingId}`);
        return false;
    } catch (e) {
        unitReservation.release(unitId);
        log.error(`Dispatch error: unit ${unitId} to building ${buildingId}`, e);
        return false;
    }
}
