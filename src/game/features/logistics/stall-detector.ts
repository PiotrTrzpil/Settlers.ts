/**
 * StallDetector
 *
 * Periodically checks for transport jobs that have been in the Reserved phase
 * too long and logs them as warnings. Stalled jobs indicate bugs in
 * the carrier or logistics system that should be investigated and fixed.
 *
 * Does NOT cancel or modify any jobs — purely diagnostic.
 */

import { createLogger } from '@/utilities/logger';
import type { TransportJobStore } from './transport-job-store';
import type { TransportJobRecord } from './transport-job-record';
import { TransportPhase } from './transport-job-record';
import { PeriodicTimer } from './periodic-timer';

/** Job timeout in game-time seconds — jobs in Reserved phase older than this are considered stalled. */
const REQUEST_TIMEOUT_SEC = 30;

/** How often to check for stalled jobs (in game-time seconds). */
const STALL_CHECK_INTERVAL_SEC = 10;

const log = createLogger('StallDetector');

export interface StallDetectorConfig {
    jobStore: TransportJobStore;
}

/**
 * Detects and warns about stalled transport jobs.
 *
 * Call `tick(dt, activeJobs)` each game tick. Purely diagnostic — logs warnings
 * but never cancels jobs or modifies state.
 */
export class StallDetector {
    private readonly jobStore: TransportJobStore;
    private readonly timer = new PeriodicTimer(STALL_CHECK_INTERVAL_SEC);
    private gameTime = 0;

    constructor(config: StallDetectorConfig) {
        this.jobStore = config.jobStore;
    }

    /**
     * Advance the stall-check timer. When the interval elapses, scans all
     * active jobs and warns about those in Reserved phase that have exceeded the timeout.
     *
     * @param dt Delta time in seconds.
     * @param activeJobs Map of carrier ID -> TransportJobRecord (read-only, not mutated).
     *                   Kept for compatibility — jobStore.jobs is the source of truth.
     */
    tick(dt: number, activeJobs: ReadonlyMap<number, TransportJobRecord>): void {
        this.gameTime += dt;
        if (this.timer.advance(dt)) {
            this.checkNow(activeJobs); // activeJobs passed for API compatibility
        }
    }

    /**
     * Immediately scan for stalled jobs and log warnings.
     *
     * @param activeJobs Map of carrier ID -> TransportJobRecord (read-only).
     */
    checkNow(_activeJobs: ReadonlyMap<number, TransportJobRecord>): void {
        for (const [carrierId, job] of this.jobStore.jobs.raw) {
            if (job.phase === TransportPhase.Reserved) {
                const age = this.gameTime - job.createdAt;
                if (age > REQUEST_TIMEOUT_SEC) {
                    log.warn(
                        `Job #${job.id} stalled (${Math.round(age)}s): ` +
                            `material=${job.material}, dest=${job.destBuilding}, ` +
                            `carrier=${carrierId}, phase=${job.phase}`
                    );
                }
            }
        }
    }
}
