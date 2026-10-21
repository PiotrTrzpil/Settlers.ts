/**
 * ENTER_BUILDING choreography executor — finalizes a unit entering a building
 * (worker dispatch to its workplace, garrison entry, …).
 *
 * Instant (single-tick) executor registered on the kernel ChoreoSystem by the
 * settler-location feature, which owns "who is inside which building".
 */

import { TaskResult, type ChoreoExecutor } from '../../systems/choreo';
import type { ISettlerBuildingLocationManager } from './types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('EnterBuildingExecutor');

/**
 * Create an ENTER_BUILDING executor.
 *
 * Reads `job.metadata.enterBuildingId`, calls locationManager.enterBuilding,
 * and returns DONE. The settler is now inside the building.
 */
export function createEnterBuildingExecutor(locationManager: ISettlerBuildingLocationManager): ChoreoExecutor {
    return (settler, job) => {
        const buildingId = job.metadata!['enterBuildingId'] as number;
        log.debug(`ENTER_BUILDING: settler ${settler.id}` + ` entering building ${buildingId}`);
        locationManager.enterBuilding(settler.id, buildingId);
        return TaskResult.DONE;
    };
}
