/**
 * SettlerLifecycleCoordinator — how settler-task state reacts when the world changes
 * under a unit: its workplace is removed, its (legacy) transport is cancelled, its approach
 * to the workplace is interrupted, it is dismissed to carrier, a worker is spawned inside a
 * building, and the periodic orphan-runtime sweep.
 *
 * Unit removal itself is internal/unit-removal.ts (COMMITMENTS cleanup priority).
 * Ends jobs through JobOutcomes and changes assignments through WorkerAssignments.
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { sortedEntries } from '@/utilities/collections';
import { seconds } from '../../core/tick-rate';
import { SettlerState } from './types';
import type { WorkerAssignments } from './worker-assignments';
import type { UnitRuntimeStore } from './unit-runtime';
import { type TickScheduler, type ScheduleHandle, NO_HANDLE } from '../../systems/tick-scheduler';
import type { IdleSearchCooldowns } from './idle-search-cooldowns';
import type { JobOutcomes } from './internal/job-outcomes';
import type { MoveTaskRunner } from './internal/move-tasks';

const ORPHAN_CHECK_INTERVAL = seconds(2);

export interface SettlerLifecycleConfig {
    gameState: GameState;
    eventBus: EventBus;
    tickScheduler: TickScheduler;
    runtimes: UnitRuntimeStore;
    outcomes: JobOutcomes;
    moveTasks: MoveTaskRunner;
    assignments: WorkerAssignments;
    idleCooldowns: IdleSearchCooldowns;
}

export class SettlerLifecycleCoordinator {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly tickScheduler: TickScheduler;
    private readonly runtimes: UnitRuntimeStore;
    private readonly outcomes: JobOutcomes;
    private readonly moveTasks: MoveTaskRunner;
    private readonly assignments: WorkerAssignments;
    private readonly idleCooldowns: IdleSearchCooldowns;
    private readonly subscriptions = new EventSubscriptionManager();
    private orphanHandle: ScheduleHandle = NO_HANDLE;

    constructor(config: SettlerLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.tickScheduler = config.tickScheduler;
        this.runtimes = config.runtimes;
        this.outcomes = config.outcomes;
        this.moveTasks = config.moveTasks;
        this.assignments = config.assignments;
        this.idleCooldowns = config.idleCooldowns;
    }

    /** Subscribe to all lifecycle events and start the orphan sweep. Call once during feature init. */
    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'carrier:transportCancelled', ({ unitId: carrierId }) => {
            this.handleTransportCancelled(carrierId);
        });

        this.subscriptions.subscribe(
            this.eventBus,
            'settler-location:approachInterrupted',
            ({ unitId: settlerId, buildingId }) => {
                this.handleApproachInterrupted(settlerId, buildingId);
            }
        );

        this.subscriptions.subscribe(this.eventBus, 'building:workerSpawned', ({ buildingId, unitId: settlerId }) => {
            this.assignments.assignWorkerInside(settlerId, buildingId);
        });

        this.subscriptions.subscribe(this.eventBus, 'unit:dismissed', ({ unitId }) => {
            this.handleUnitDismissed(unitId);
        });

        this.orphanHandle = this.tickScheduler.schedule(ORPHAN_CHECK_INTERVAL, () => this.orphanCheckAndReschedule());
    }

    /**
     * TickSystem removal hook (after every cleanup-registry handler): a removed workplace releases
     * its workers. Removed units were already handled at COMMITMENTS priority (unit-removal.ts).
     */
    onEntityRemoved(entityId: number): void {
        if (this.assignments.hasOccupants(entityId)) {
            this.onBuildingRemoved(entityId);
        }
    }

    /** Unsubscribe from all events and cancel the scheduled orphan check. */
    destroy(): void {
        this.subscriptions.unsubscribeAll();
        this.tickScheduler.cancel(this.orphanHandle);
        this.orphanHandle = NO_HANDLE;
    }

    // ─────────────────────────────────────────────────────────────
    // Private event handlers
    // ─────────────────────────────────────────────────────────────

    /** TRANSITIONAL (deleted in Cleanup): a legacy transport job ends when its record is cancelled. */
    private handleTransportCancelled(carrierId: number): void {
        const runtime = this.runtimes.get(carrierId);
        if (!runtime?.job || !runtime.job.synthetic) {
            return;
        }
        const entity = this.gameState.getEntityOrThrow(carrierId, 'carrier whose transport was cancelled');
        this.outcomes.endJob(entity, runtime, 'failed');
    }

    private handleApproachInterrupted(settlerId: number, buildingId: number): void {
        if (!this.runtimes.has(settlerId)) {
            return;
        }
        // OK: has() check above guarantees entry exists
        const runtime = this.runtimes.get(settlerId)!;
        if (runtime.homeAssignment?.buildingId !== buildingId) {
            return;
        }

        this.assignments.forgetHome(settlerId, runtime);

        if (runtime.job) {
            const entity = this.gameState.getEntityOrThrow(settlerId, 'settler whose approach was interrupted');
            this.outcomes.endJob(entity, runtime, 'failed');
        }

        this.moveTasks.end(settlerId, runtime);
        this.gameState.movement.getController(settlerId)?.clearPath();
    }

    private handleUnitDismissed(unitId: number): void {
        const runtime = this.runtimes.get(unitId);
        if (!runtime) {
            return;
        }

        const entity = this.gameState.getEntityOrThrow(unitId, 'unit being dismissed to Carrier');
        if (runtime.job) {
            this.outcomes.endJob(entity, runtime, 'failed');
        }
        this.assignments.release(unitId, runtime);
        runtime.state = SettlerState.IDLE;
        this.moveTasks.end(unitId, runtime);
    }

    private onBuildingRemoved(buildingId: number): void {
        this.assignments.clearBuilding(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) {
                continue;
            }

            this.assignments.forgetHome(settlerId, runtime);

            if (runtime.job) {
                const entity = this.gameState.getEntityOrThrow(settlerId, 'worker of a removed building');
                this.outcomes.endJob(entity, runtime, 'failed');
            }

            this.moveTasks.end(settlerId, runtime);
            this.gameState.movement.getController(settlerId)?.clearPath();
        }
    }

    /** Runtimes created for ids that are no entity (any more) — drop them. */
    private orphanCheckAndReschedule(): void {
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.dropOrphanRuntime(id);
            }
        }
        this.orphanHandle = this.tickScheduler.schedule(ORPHAN_CHECK_INTERVAL, () => this.orphanCheckAndReschedule());
    }

    private dropOrphanRuntime(id: number): void {
        const runtime = this.runtimes.get(id)!;
        this.idleCooldowns.cancelAll(id);
        this.assignments.releaseRemovedUnit(id, runtime);
        this.runtimes.delete(id);
    }
}
