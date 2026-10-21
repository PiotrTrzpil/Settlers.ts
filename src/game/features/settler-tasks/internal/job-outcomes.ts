/**
 * JobOutcomes — how a live unit's job ends: completion, failure, preemption (takeover) and
 * owner-initiated cancel. Clears the commitment and calls the job's owner directly
 * (JobKindHandler), then emits the `settler:task*` / `settler:jobAborted` notification.
 *
 * Event ordering (docs/designs/job-ownership.md, "Event ordering"):
 * - completed: clear job + commitment → owner.onCompleted (may assign again) → taskCompleted →
 *   post-processing (exit if home, idle animation, re-enter home);
 * - failed: teardown + node onAbort → clear commitment, INTERRUPTED → owner.onFailed (may assign
 *   again) → taskFailed;
 * - cancel: teardown + node onAbort → clear commitment, INTERRUPTED → jobAborted (owner NOT called).
 *
 * Unit removal lives in unit-removal.ts.
 */

import { BuildingType, type Entity } from '../../../entity';
import type { GameState } from '../../../game-state';
import type { EventBus } from '../../../event-bus';
import { createLogger } from '@/utilities/logger';
import { hexDistance } from '../../../systems/hex-directions';
import { getBuildingDoorPos } from '../../../data/game-data-access';
import type { JobFailureReason } from '../../../systems/choreo';
import type { CommitmentOwner, UnitCommitmentQuery, UnitCommitmentWriter } from '../../../systems/unit-commitment';
import type { MaterialTransfer } from '../../material-transfer';
import type { ISettlerBuildingLocationManager } from '../../settler-location';
import { SettlerState, type JobState } from '../types';
import type { IdleAnimationController } from '../idle-animation-controller';
import type { UnitRuntime, UnitRuntimeStore } from '../unit-runtime';
import type { JobOwnerRegistry } from './job-owners';
import { interruptTargetWork, runAbortHooks, stopActiveTrigger, type JobTeardownDeps } from './job-teardown';
import { currentStepName, emitJobAborted, emitTaskCompleted, emitTaskFailed } from './job-events';

const log = createLogger('JobOutcomes');

export interface JobOutcomesConfig {
    gameState: GameState;
    eventBus: EventBus;
    runtimes: UnitRuntimeStore;
    owners: JobOwnerRegistry;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
    teardown: JobTeardownDeps;
    animController: IdleAnimationController;
    locationManager: ISettlerBuildingLocationManager;
    materialTransfer: MaterialTransfer;
}

export class JobOutcomes {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly runtimes: UnitRuntimeStore;
    private readonly owners: JobOwnerRegistry;
    private readonly commitments: UnitCommitmentQuery;
    private readonly writer: UnitCommitmentWriter;
    private readonly teardown: JobTeardownDeps;
    private readonly animController: IdleAnimationController;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly materialTransfer: MaterialTransfer;

    constructor(cfg: JobOutcomesConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.runtimes = cfg.runtimes;
        this.owners = cfg.owners;
        this.commitments = cfg.commitments;
        this.writer = cfg.commitmentWriter;
        this.teardown = cfg.teardown;
        this.animController = cfg.animController;
        this.locationManager = cfg.locationManager;
        this.materialTransfer = cfg.materialTransfer;
    }

    /** End the current job: complete it when all nodes ran, otherwise fail it with `reason`. */
    endJob(settler: Entity, runtime: UnitRuntime, reason: JobFailureReason): void {
        const job = runtime.job!;
        if (job.nodeIndex >= job.nodes.length) {
            this.complete(settler, runtime);
        } else {
            this.fail(settler, runtime, reason);
        }
    }

    /**
     * Free the unit for `newOwner`: end its job as 'preempted', or tell a hold / move owner of another
     * owner that it lost the unit. A commitment of `newOwner` itself is just dropped (the caller reads
     * it first when it wants to keep its ref / reserved flag).
     */
    takeOver(unit: Entity, runtime: UnitRuntime, newOwner: CommitmentOwner): void {
        if (runtime.job) {
            this.endJob(unit, runtime, 'preempted');
            this.preemptFollowUpJob(unit, runtime, newOwner);
        }
        const commitment = this.commitments.get(unit.id);
        if (!commitment) {
            return;
        }
        if (commitment.hasJob) {
            throw new Error(
                `Unit ${unit.id} has a restored '${commitment.owner}' job that is not resumed yet — ` +
                    `owners must not assign units before onRestoreResume`
            );
        }
        this.writer.clear(unit.id);
        if (commitment.owner !== newOwner) {
            this.owners.holdOwner(commitment.owner).onPreempted(unit.id, commitment.ref);
        }
    }

    /** A completion handler (called by endJob) may have assigned a follow-up job — preempt that one too. */
    private preemptFollowUpJob(unit: Entity, runtime: UnitRuntime, newOwner: CommitmentOwner): void {
        if (!runtime.job) {
            return;
        }
        this.fail(unit, runtime, 'preempted');
        const again = runtime.job as JobState | null;
        if (again) {
            throw new Error(
                `Unit ${unit.id}: owner '${again.kind}' re-assigned job '${again.jobId}' while preempted by '${newOwner}'`
            );
        }
    }

    /** All nodes ran: clear job + commitment, call the owner, notify, then idle post-processing. */
    complete(settler: Entity, runtime: UnitRuntime): void {
        const job = runtime.job!;
        stopActiveTrigger(this.teardown, runtime, job);
        this.releaseController(settler.id);

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);

        // Clear job, state and commitment BEFORE calling the owner / listeners, so a handler
        // that assigns the next job sees a clean runtime (construction chaining, logistics flush).
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.clearJobCommitment(settler.id, job);

        this.owners.kind(job.kind).onCompleted(settler.id, job.ref, job.params);
        emitTaskCompleted(this.eventBus, settler, job);
        this.afterCompletion(settler, runtime);
    }

    /** A node failed or the unit was taken over: tear down, INTERRUPTED, call the owner, notify. */
    fail(settler: Entity, runtime: UnitRuntime, reason: JobFailureReason): void {
        const job = runtime.job!;
        runtime.job = null;
        this.tearDownLive(settler, runtime, job);
        this.clearJobCommitment(settler.id, job);
        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId} (${reason})`);

        this.owners.kind(job.kind).onFailed(settler.id, job.ref, job.params, {
            reason,
            nodeIndex: job.nodeIndex,
            failedStep: currentStepName(job),
        });
        emitTaskFailed(this.eventBus, settler, job, reason);
    }

    /**
     * Owner-initiated stop (Invariant 8: the owner is NOT called back). Ends the unit's job, move
     * or hold when `owner` owns it; a no-op otherwise (the job already ended), so it is safe to call
     * for every unit an owner believes it has.
     */
    cancel(unitId: number, owner: CommitmentOwner): void {
        const commitment = this.commitments.get(unitId);
        if (!commitment || commitment.owner !== owner) {
            return;
        }
        const runtime = this.runtimes.get(unitId)!;
        const job = runtime.job;
        if (!job) {
            this.writer.clear(unitId);
            if (runtime.moveTask) {
                runtime.moveTask = null;
                runtime.state = SettlerState.IDLE;
                this.gameState.movement.getController(unitId)?.clearPath();
            }
            return;
        }
        const unit = this.gameState.getEntityOrThrow(unitId, 'unit whose job is cancelled');
        runtime.job = null;
        this.tearDownLive(unit, runtime, job);
        this.writer.clear(unitId);
        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(unit);
        log.debug(`Settler ${unitId} job ${job.jobId} cancelled by owner '${owner}'`);
        emitJobAborted(this.eventBus, unitId, job, 'cancelled');
    }

    /** Clear the commitment of the job that just ended (Invariant 2: it is the job's own). */
    private clearJobCommitment(unitId: number, job: JobState): void {
        const commitment = this.commitments.get(unitId);
        if (!commitment || commitment.owner !== job.kind || !commitment.hasJob) {
            const found = commitment ? `'${commitment.owner}' hasJob=${commitment.hasJob}` : 'missing';
            throw new Error(`Unit ${unitId}: job '${job.jobId}' (${job.kind}) ended but its commitment is ${found}`);
        }
        this.writer.clear(unitId);
    }

    /** Teardown of a live unit's job (entity exists): work interrupt, drop goods, trigger, exit home, hooks. */
    private tearDownLive(settler: Entity, runtime: UnitRuntime, job: JobState): void {
        interruptTargetWork(this.teardown, settler, job);
        this.materialTransfer.drop(settler.id);
        stopActiveTrigger(this.teardown, runtime, job);
        // Only workers with a home assignment exit — garrisoned / dispatched units stay inside.
        if (this.locationManager.isInside(settler.id) && runtime.homeAssignment) {
            this.locationManager.exitBuilding(settler.id);
        }
        this.releaseController(settler.id);
        runAbortHooks(this.teardown.choreoSystem, settler.id, job);
    }

    private releaseController(unitId: number): void {
        const controller = this.gameState.movement.getController(unitId);
        if (controller) {
            controller.busy = false;
        }
    }

    /** Workers exit to search again, show idle, and step back into their home when at its door. */
    private afterCompletion(settler: Entity, runtime: UnitRuntime): void {
        if (this.locationManager.isInside(settler.id) && runtime.homeAssignment) {
            // Units placed inside by dispatch jobs (garrison, worker dispatch) stay inside —
            // the job intentionally placed them there.
            this.locationManager.exitBuilding(settler.id);
        }
        // Location manager is the sole owner of entity.hidden.
        this.animController.setIdleAnimation(settler);

        if (runtime.homeAssignment) {
            const home = this.gameState.getEntity(runtime.homeAssignment.buildingId);
            if (home) {
                const door = getBuildingDoorPos(home, home.race, home.subType as BuildingType);
                if (hexDistance(settler.x, settler.y, door.x, door.y) <= 1) {
                    this.locationManager.enterBuilding(settler.id, home.id);
                }
            }
        }
    }
}
