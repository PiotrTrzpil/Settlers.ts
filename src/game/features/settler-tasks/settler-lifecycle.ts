/**
 * SettlerLifecycleCoordinator — how settler-task state reacts when the world changes
 * under a unit: the unit or its workplace is removed, its transport is cancelled, its
 * approach to the workplace is interrupted, it is dismissed to carrier, a worker is
 * spawned inside a building, and the periodic orphan-runtime sweep.
 *
 * Ends jobs through JobRunner and changes assignments through WorkerAssignments.
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { UnitType, type Entity } from '../../entity';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';
import { seconds } from '../../core/tick-rate';
import { SettlerState, type SettlerConfig } from './types';
import type { WorkerAssignments } from './worker-assignments';
import type { JobRunner } from './job-runner';
import type { UnitRuntime, UnitRuntimeStore } from './unit-runtime';
import { type TickScheduler, type ScheduleHandle, NO_HANDLE } from '../../systems/tick-scheduler';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleSearchCooldowns } from './idle-search-cooldowns';

const log = createLogger('SettlerLifecycleCoordinator');

const ORPHAN_CHECK_INTERVAL = seconds(2);

export interface SettlerLifecycleConfig {
    gameState: GameState;
    eventBus: EventBus;
    tickScheduler: TickScheduler;
    runtimes: UnitRuntimeStore;
    jobRunner: JobRunner;
    assignments: WorkerAssignments;
    idleCooldowns: IdleSearchCooldowns;
    handlerRegistry: WorkHandlerRegistry;
    settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
}

export class SettlerLifecycleCoordinator {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly tickScheduler: TickScheduler;
    private readonly runtimes: UnitRuntimeStore;
    private readonly jobRunner: JobRunner;
    private readonly assignments: WorkerAssignments;
    private readonly idleCooldowns: IdleSearchCooldowns;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    private readonly subscriptions = new EventSubscriptionManager();
    private orphanHandle: ScheduleHandle = NO_HANDLE;

    constructor(config: SettlerLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.tickScheduler = config.tickScheduler;
        this.runtimes = config.runtimes;
        this.jobRunner = config.jobRunner;
        this.assignments = config.assignments;
        this.idleCooldowns = config.idleCooldowns;
        this.handlerRegistry = config.handlerRegistry;
        this.settlerConfigs = config.settlerConfigs;
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
     * Handle entity removal — cleanup runtime, release worker assignments.
     * Called by the cleanup registry when any entity is removed.
     */
    onEntityRemoved(entityId: number): void {
        if (this.assignments.hasOccupants(entityId)) {
            this.onBuildingRemoved(entityId);
        }

        const runtime = this.runtimes.get(entityId);
        if (!runtime) {
            return;
        }

        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            this.cleanupSettlerHandlers(entity, entityId, runtime);
        } else if (runtime.job?.targetId && runtime.job.workStarted) {
            const entityHandler = this.handlerRegistry.findEntityHandlerForJob(runtime.job.jobId, this.settlerConfigs);
            if (entityHandler) {
                try {
                    entityHandler.onWorkInterrupt?.(runtime.job.targetId, entityId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.idleCooldowns.cancelAll(entityId);

        this.assignments.release(entityId, runtime);
        this.runtimes.delete(entityId);
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

    private handleTransportCancelled(carrierId: number): void {
        const runtime = this.runtimes.get(carrierId);
        if (!runtime?.job) {
            return;
        }

        const entity = this.gameState.getEntity(carrierId);
        if (!entity) {
            return;
        }

        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (!unitConfig) {
            return;
        }

        this.jobRunner.endJobForTakeover(entity, unitConfig, runtime);
        runtime.job = null;
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
            const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
            if (unitConfig) {
                this.jobRunner.endJobForTakeover(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }

        runtime.moveTask = null;
        this.gameState.movement.getController(settlerId)?.clearPath();
    }

    private handleUnitDismissed(unitId: number): void {
        const runtime = this.runtimes.get(unitId);
        if (!runtime) {
            return;
        }

        const entity = this.gameState.getEntityOrThrow(unitId, 'unit being dismissed to Carrier');
        if (runtime.job) {
            const unitConfig = this.settlerConfigs.get(UnitType.Carrier);
            if (unitConfig) {
                this.jobRunner.endJobForTakeover(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }
        this.assignments.release(unitId, runtime);
        runtime.state = SettlerState.IDLE;
        runtime.moveTask = null;
    }

    private onBuildingRemoved(buildingId: number): void {
        this.assignments.clearBuilding(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) {
                continue;
            }

            this.assignments.forgetHome(settlerId, runtime);

            if (runtime.job) {
                const entity = this.gameState.getEntity(settlerId);
                if (entity) {
                    const config = this.settlerConfigs.get(entity.subType as UnitType);
                    if (config) {
                        this.jobRunner.endJobForTakeover(entity, config, runtime);
                    }
                }
                runtime.job = null;
            }

            runtime.moveTask = null;
            this.gameState.movement.getController(settlerId)?.clearPath();
        }
    }

    private cleanupSettlerHandlers(entity: Entity, entityId: number, runtime: UnitRuntime): void {
        const config = this.settlerConfigs.get(entity.subType as UnitType);
        if (!config) {
            return;
        }
        if (runtime.job) {
            this.jobRunner.endJobForTakeover(entity, config, runtime);
        }
        const posHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        posHandler?.onSettlerRemoved?.(entityId);
    }

    private orphanCheckAndReschedule(): void {
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.onEntityRemoved(id);
            }
        }
        this.orphanHandle = this.tickScheduler.schedule(ORPHAN_CHECK_INTERVAL, () => this.orphanCheckAndReschedule());
    }
}
