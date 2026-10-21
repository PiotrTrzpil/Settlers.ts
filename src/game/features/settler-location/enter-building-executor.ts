/**
 * ENTER_BUILDING choreography executor — finalizes a unit entering a building
 * (worker dispatch to its workplace, garrison entry, …).
 *
 * Instant (single-tick) executor registered on the kernel ChoreoSystem by the
 * settler-location feature, which owns "who is inside which building".
 */

import { TaskResult, type ChoreoExecutor, type ChoreoNode, type ChoreoNodeHooks } from '../../systems/choreo';
import type { ISettlerBuildingLocationManager } from './types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('EnterBuildingExecutor');

/** Entering is irreversible: a restored job never snaps back across a completed ENTER_BUILDING. */
export const ENTER_BUILDING_HOOKS: ChoreoNodeHooks = { irreversible: true };

/** The building a node enters: `node.args.enterBuilding`. */
function enteredBuildingId(node: ChoreoNode): number {
    if (!node.args || node.args.task !== 'enterBuilding') {
        throw new Error(`ENTER_BUILDING node has no enterBuilding args`);
    }
    return node.args.buildingId;
}

/**
 * Create an ENTER_BUILDING executor.
 *
 * Reads the building id from the node args, calls locationManager.enterBuilding,
 * and returns DONE. The settler is now inside the building.
 */
export function createEnterBuildingExecutor(locationManager: ISettlerBuildingLocationManager): ChoreoExecutor {
    return (settler, _job, node) => {
        const buildingId = enteredBuildingId(node);
        log.debug(`ENTER_BUILDING: settler ${settler.id}` + ` entering building ${buildingId}`);
        locationManager.enterBuilding(settler.id, buildingId);
        return TaskResult.DONE;
    };
}
