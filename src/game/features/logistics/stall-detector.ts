/**
 * StallDetector
 *
 * Periodically checks for transport requests that have been in-progress
 * too long and cancels them so they can be reassigned.
 *
 * A stalled request is one that has been assigned to a carrier but not
 * completed within the timeout window. This guards against carriers that
 * get stuck, die, or are otherwise unable to complete their assignment.
 */

import { LogHandler } from '@/utilities/log-handler';
import type { RequestManager } from './request-manager';
import type { InventoryReservationManager } from './inventory-reservation';
import type { TransportJob } from './transport-job';

/** Request timeout in game-time seconds — requests older than this are considered stalled. */
const REQUEST_TIMEOUT_SEC = 30;

/** How often to check for stalled requests (in game-time seconds). */
const STALL_CHECK_INTERVAL_SEC = 5;

const log = new LogHandler('StallDetector');

export interface StallDetectorConfig {
    requestManager: RequestManager;
    reservationManager: InventoryReservationManager;
}

/**
 * Detects and resolves stalled transport requests.
 *
 * Call `tick(dt)` each game tick. When a stall check is due, `checkNow(activeJobs)`
 * is called internally. The caller is responsible for removing cancelled jobs
 * from its own `activeJobs` map after each tick.
 */
export class StallDetector {
    private readonly requestManager: RequestManager;
    private readonly reservationManager: InventoryReservationManager;

    /** Accumulated game time since last stall check (in seconds). */
    private timeSinceCheck = 0;

    constructor(config: StallDetectorConfig) {
        this.requestManager = config.requestManager;
        this.reservationManager = config.reservationManager;
    }

    /**
     * Advance the stall-check timer. When the interval elapses, scans all
     * in-progress requests and cancels those that have exceeded the timeout.
     *
     * Uses game-time seconds (deterministic) rather than wall-clock time.
     *
     * @param dt Delta time in seconds.
     * @param activeJobs Map of carrier ID → TransportJob (mutated: stalled jobs are deleted).
     */
    tick(dt: number, activeJobs: Map<number, TransportJob>): void {
        this.timeSinceCheck += dt;
        if (this.timeSinceCheck >= STALL_CHECK_INTERVAL_SEC) {
            this.timeSinceCheck = 0;
            this.checkNow(activeJobs);
        }
    }

    /**
     * Immediately scan for stalled requests and cancel them.
     *
     * @param activeJobs Map of carrier ID → TransportJob (mutated: stalled jobs are deleted).
     */
    checkNow(activeJobs: Map<number, TransportJob>): void {
        const stalledRequests = this.requestManager.getStalledRequests(REQUEST_TIMEOUT_SEC);

        for (const request of stalledRequests) {
            log.warn(
                `Request #${request.id} stalled after ${REQUEST_TIMEOUT_SEC}s: ` +
                    `material=${request.materialType}, building=${request.buildingId}, carrier=${request.assignedCarrier}. ` +
                    'Cancelling transport job.'
            );

            // Find and cancel the TransportJob for this carrier
            if (request.assignedCarrier !== null) {
                const job = activeJobs.get(request.assignedCarrier);
                if (job) {
                    job.cancel('timeout');
                    activeJobs.delete(request.assignedCarrier);
                    continue;
                }
            }

            // Fallback: no active job found, clean up manually
            this.reservationManager.releaseReservationForRequest(request.id);
            this.requestManager.resetRequest(request.id, 'timeout');
        }
    }
}
