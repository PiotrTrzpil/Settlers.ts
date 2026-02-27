/**
 * Carrier job executor (high-level).
 *
 * Handles job execution, completion, and interruption for carrier units
 * running externally-assigned CarrierJobState (transport jobs).
 * Low-level carrier task dispatch is handled by carrier-task-executors.ts.
 */

import type { Entity } from '../../entity';
import { clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult, SettlerState, type CarrierJobState, type JobState } from './types';
import { executeTask, type TaskContext } from './task-executors';
import type { JobDefinitions } from './loader';
import type { IdleAnimationController } from './idle-animation-controller';

const log = new LogHandler('CarrierTaskExecutor');

/** Per-unit state needed by the carrier executor (subset of UnitRuntime). */
export interface CarrierRuntimeState {
    state: SettlerState;
    job: JobState | null;
}

export class CarrierTaskExecutor {
    constructor(
        private readonly jobDefinitions: JobDefinitions,
        private readonly animController: IdleAnimationController,
        private readonly taskContext: TaskContext
    ) {}

    /**
     * Handle a carrier in WORKING state: advance the current transport task.
     */
    handleWorking(settler: Entity, runtime: CarrierRuntimeState, dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job! as CarrierJobState;

        const tasks = this.jobDefinitions.get(job.jobId);
        if (!tasks || job.taskIndex >= tasks.length) {
            this.completeJob(settler, runtime);
            return;
        }

        const task = tasks[job.taskIndex]!;

        // Apply animation for current task (on first tick of task)
        if (job.progress === 0) {
            this.animController.applyTaskAnimation(settler, task);
        }

        const result = executeTask(settler, job, task, dt, this.taskContext);

        switch (result) {
        case TaskResult.DONE:
            job.taskIndex++;
            job.progress = 0;
            // Apply animation for next task if there is one
            if (job.taskIndex < tasks.length) {
                this.animController.applyTaskAnimation(settler, tasks[job.taskIndex]!);
            }
            break;

        case TaskResult.FAILED:
            this.interruptJob(settler, runtime);
            break;

        case TaskResult.CONTINUE:
            // Keep going next tick
            break;
        }
    }

    /**
     * Complete a carrier job and return to idle state.
     */
    completeJob(settler: Entity, runtime: CarrierRuntimeState): void {
        log.debug(`Carrier ${settler.id} completed job ${runtime.job!.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.animController.setIdleAnimation(settler);
    }

    /**
     * Interrupt a carrier job (source gone, destination full, etc.).
     * Carrier reservations are handled by LogisticsDispatcher via InventoryReservationManager.
     * LogisticsDispatcher listens for carrier:removed and carrier:pickupFailed events to release reservations.
     */
    interruptJob(settler: Entity, runtime: CarrierRuntimeState): void {
        const job = runtime.job!;

        // Clear carrying state if unit was carrying material
        if (settler.carrying) {
            clearCarrying(settler);
        }

        log.debug(`Carrier ${settler.id} interrupted job ${job.jobId}`);
        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);
    }
}
