/**
 * Choreo executors for building-unit dispatch.
 *
 * ENTER_BUILDING — finalizes a worker entering their workplace.
 *
 * Instant (single-tick) executor registered on ChoreoSystem
 * by the feature's create() function.
 */

import type { ChoreoExecutor } from '../../../systems/choreo';
import { TaskResult } from '../../../systems/choreo';
import type { ISettlerBuildingLocationManager } from '../../settler-location';
import { createLogger } from '@/utilities/logger';

const log = createLogger('DispatchExecutors');

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
