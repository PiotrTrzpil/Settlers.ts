/**
 * StallDetector
 *
 * Periodically checks whether carriers with active transport jobs are making
 * movement progress. A carrier is considered stalled when it has not moved
 * to any new tile over a check window.
 *
 * This avoids false positives for carriers taking long detours around obstacles
 * — as long as the carrier is moving through new tiles, it's making progress.
 *
 * Does NOT cancel or modify any jobs — purely diagnostic.
 */

import { createLogger } from '@/utilities/logger';
import type { TransportJobStore } from './transport-job-store';
import { TransportPhase } from './transport-job-record';
import { PeriodicTimer } from './periodic-timer';
import type { GameState } from '../../game-state';

/** How often to sample carrier positions (game-time seconds). */
const CHECK_INTERVAL_SEC = 10;

/** How many consecutive checks with no movement before warning. */
const STALL_THRESHOLD_CHECKS = 3;

const log = createLogger('StallDetector');

export interface StallDetectorConfig {
    jobStore: TransportJobStore;
    gameState: GameState;
}

interface CarrierSnapshot {
    lastX: number;
    lastY: number;
    /** Consecutive checks where carrier hasn't moved. */
    stuckCount: number;
}

/**
 * Detects and warns about stalled transport jobs by tracking carrier movement.
 *
 * Call `tick(dt)` each game tick. Purely diagnostic — logs warnings
 * but never cancels jobs or modifies state.
 */
export class StallDetector {
    private readonly jobStore: TransportJobStore;
    private readonly gameState: GameState;
    private readonly timer = new PeriodicTimer(CHECK_INTERVAL_SEC);
    private readonly snapshots = new Map<number, CarrierSnapshot>();

    constructor(config: StallDetectorConfig) {
        this.jobStore = config.jobStore;
        this.gameState = config.gameState;
    }

    tick(dt: number): void {
        if (this.timer.advance(dt)) {
            this.checkProgress();
        }
    }

    private checkProgress(): void {
        const activeCarriers = new Set<number>();

        for (const [carrierId, job] of this.jobStore.jobs.raw) {
            if (job.phase !== TransportPhase.Reserved && job.phase !== TransportPhase.PickedUp) {
                continue;
            }
            activeCarriers.add(carrierId);
            this.checkCarrier(carrierId, job.id, job.material, job.destBuilding, job.phase);
        }

        for (const carrierId of this.snapshots.keys()) {
            if (!activeCarriers.has(carrierId)) {
                this.snapshots.delete(carrierId);
            }
        }
    }

    private checkCarrier(carrierId: number, jobId: number, material: string, dest: number, phase: string): void {
        const controller = this.gameState.movement.getController(carrierId);
        if (!controller) {
            return;
        }

        const x = controller.tileX;
        const y = controller.tileY;

        const snapshot = this.snapshots.get(carrierId);
        if (!snapshot) {
            this.snapshots.set(carrierId, { lastX: x, lastY: y, stuckCount: 0 });
            return;
        }

        if (x !== snapshot.lastX || y !== snapshot.lastY) {
            snapshot.lastX = x;
            snapshot.lastY = y;
            snapshot.stuckCount = 0;
            return;
        }

        snapshot.stuckCount++;
        if (snapshot.stuckCount >= STALL_THRESHOLD_CHECKS) {
            log.warn(
                `Job #${jobId} stalled (no movement for ${snapshot.stuckCount * CHECK_INTERVAL_SEC}s): ` +
                    `material=${material}, dest=${dest}, ` +
                    `carrier=${carrierId}, phase=${phase}`
            );
        }
    }
}
