/**
 * Shared garrison dispatch utility — sends a unit to a building door and enters.
 *
 * Used by both garrison commands (player-initiated) and the siege system (capture).
 * Handles the common pattern: reserve → assignWorker → choreo → at-door fallback.
 */

import type { GameState } from '@/game/game-state';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { SettlerTaskSystem } from '@/game/features/settler-tasks';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import { createLogger } from '@/utilities/logger';

const log = createLogger('GarrisonDispatch');

export interface GarrisonDispatchDeps {
    gameState: GameState;
    unitReservation: UnitReservationRegistry;
    settlerTaskSystem: SettlerTaskSystem;
}

/**
 * Reserve a unit, assign it to a building, and dispatch it to walk to the door and enter.
 *
 * Returns true if the unit was successfully dispatched (walking or already at door).
 * On failure, all partial state is rolled back (reservation, worker assignment).
 */
export function dispatchUnitToGarrison(unitId: number, buildingId: number, deps: GarrisonDispatchDeps): boolean {
    const { gameState, unitReservation, settlerTaskSystem } = deps;

    unitReservation.reserve(unitId, {
        purpose: 'garrison-en-route',
        onForcedRelease: () => {},
    });

    try {
        settlerTaskSystem.assignWorkerToBuilding(unitId, buildingId);
        const job = choreo('WORKER_DISPATCH').goToDoorAndEnter(buildingId).build();
        const assigned = settlerTaskSystem.assignJob(unitId, job, job.targetPos ?? undefined);

        if (assigned) {
            return true;
        }

        // Path not found — check if unit is already at the door
        const unit = gameState.getEntityOrThrow(unitId, 'garrison dispatch');
        if (job.targetPos && unit.x === job.targetPos.x && unit.y === job.targetPos.y) {
            settlerTaskSystem.assignJob(unitId, job);
            return true;
        }

        // Genuinely unreachable — roll back
        settlerTaskSystem.releaseWorkerAssignment(unitId);
        unitReservation.release(unitId);
        log.warn(`Dispatch failed: unit ${unitId} cannot reach building ${buildingId}`);
        return false;
    } catch (e) {
        settlerTaskSystem.releaseWorkerAssignment(unitId);
        unitReservation.release(unitId);
        log.error(`Dispatch error: unit ${unitId} to building ${buildingId}`, e);
        return false;
    }
}
