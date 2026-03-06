/**
 * StallDetector
 *
 * Periodically checks for transport requests that have been in-progress
 * too long and logs them as warnings. Stalled requests indicate bugs in
 * the carrier or logistics system that should be investigated and fixed.
 *
 * Does NOT cancel or modify any jobs — purely diagnostic.
 */

import { createLogger } from '@/utilities/logger';
import type { RequestManager } from './request-manager';
import type { TransportJobRecord } from './transport-job-record';
import { PeriodicTimer } from './periodic-timer';

/** Request timeout in game-time seconds — requests older than this are considered stalled. */
const REQUEST_TIMEOUT_SEC = 30;

/** How often to check for stalled requests (in game-time seconds). */
const STALL_CHECK_INTERVAL_SEC = 10;

const log = createLogger('StallDetector');

export interface StallDetectorConfig {
    requestManager: RequestManager;
}

/**
 * Detects and warns about stalled transport requests.
 *
 * Call `tick(dt)` each game tick. Purely diagnostic — logs warnings
 * but never cancels jobs or modifies state.
 */
export class StallDetector {
    private readonly requestManager: RequestManager;
    private readonly timer = new PeriodicTimer(STALL_CHECK_INTERVAL_SEC);

    constructor(config: StallDetectorConfig) {
        this.requestManager = config.requestManager;
    }

    /**
     * Advance the stall-check timer. When the interval elapses, scans all
     * in-progress requests and warns about those that have exceeded the timeout.
     *
     * @param dt Delta time in seconds.
     * @param activeJobs Map of carrier ID -> TransportJob (read-only, not mutated).
     */
    tick(dt: number, activeJobs: ReadonlyMap<number, TransportJobRecord>): void {
        if (this.timer.advance(dt)) {
            this.checkNow(activeJobs);
        }
    }

    /**
     * Immediately scan for stalled requests and log warnings.
     *
     * @param activeJobs Map of carrier ID -> TransportJob (read-only).
     */
    checkNow(activeJobs: ReadonlyMap<number, TransportJobRecord>): void {
        const stalledRequests = this.requestManager.getStalledRequests(REQUEST_TIMEOUT_SEC);
        if (stalledRequests.length === 0) return;

        for (const request of stalledRequests) {
            const age = Math.round(this.requestManager.getGameTime() - request.assignedAt!);
            const job = request.assignedCarrier !== null ? activeJobs.get(request.assignedCarrier) : undefined;
            const jobStatus = job ? job.phase : 'no-job';

            log.warn(
                `Request #${request.id} stalled (${age}s): ` +
                    `material=${request.materialType}, dest=${request.buildingId}, ` +
                    `carrier=${request.assignedCarrier}, jobStatus=${jobStatus}`
            );
        }
    }
}
