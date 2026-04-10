/**
 * Settler Lifecycle Coordinator — handles entity creation/removal,
 * building completion/destruction, orphan detection, and idle cooldowns.
 *
 * Extracted from SettlerTaskSystem to separate "what happens when
 * entities come and go" from "how settlers pick and execute tasks."
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { UnitType, type Entity } from '../../entity';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';
import { SettlerState, type SettlerConfig } from './types';
import type { BuildingInventoryManager } from '../inventory';
import type { ISettlerBuildingLocationManager } from '../settler-location';
import { BuildingWorkerTracker } from './building-worker-tracker';
import type { UnitStateMachine, UnitRuntime } from './unit-state-machine';
import type { IndexedMap } from '@/game/utils/indexed-map';
import { type TickScheduler, type ScheduleHandle, NO_HANDLE } from '../../systems/tick-scheduler';
import type { WorkHandlerRegistry } from './work-handler-registry';
import { buildAllSettlerConfigs } from '../../data/settler-data-access';

const log = createLogger('SettlerLifecycleCoordinator');

import { seconds } from '../../core/tick-rate';

const ORPHAN_CHECK_INTERVAL = seconds(2);
const IDLE_SEARCH_COOLDOWN = 10;

/** Callback for interrupting or completing a settler job during cleanup. */
export type InterruptJobCallback = (entity: Entity, config: SettlerConfig, runtime: UnitRuntime) => void;

/** Create initial UnitRuntime for a newly registered settler. */
export type CreateRuntimeCallback = () => UnitRuntime;

export interface SettlerLifecycleConfig {
    gameState: GameState;
    eventBus: EventBus;
    tickScheduler: TickScheduler;
    workerTracker: BuildingWorkerTracker;
    stateMachine: UnitStateMachine;
    runtimes: IndexedMap<number, UnitRuntime>;
    locationManager: ISettlerBuildingLocationManager;
    inventoryManager: BuildingInventoryManager;
    handlerRegistry: WorkHandlerRegistry;
    /**
     * Callback to interrupt or complete a settler job during cleanup.
     * Called when a settler is removed while a job is in progress.
     */
    interruptJob: InterruptJobCallback;
    /** Factory for creating UnitRuntime for newly seen settler entities. */
    createRuntime: CreateRuntimeCallback;
}

type SettlerConfigs = Map<UnitType, SettlerConfig>;

/**
 * Handles settler lifecycle events — entity creation/removal,
 * building completion/destruction, orphan detection, idle cooldowns.
 *
 * Extracted from SettlerTaskSystem to separate "what happens when
 * entities come and go" from "how settlers pick and execute tasks."
 */
export class SettlerLifecycleCoordinator {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly tickScheduler: TickScheduler;
    private readonly workerTracker: BuildingWorkerTracker;
    private readonly runtimes: IndexedMap<number, UnitRuntime>;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly interruptJob: InterruptJobCallback;
    private readonly createRuntime: CreateRuntimeCallback;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly subscriptions = new EventSubscriptionManager();
    private orphanHandle: ScheduleHandle = NO_HANDLE;
    private readonly idleCooldownHandles = new Map<number, ScheduleHandle>();

    constructor(config: SettlerLifecycleConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.tickScheduler = config.tickScheduler;
        this.workerTracker = config.workerTracker;
        this.runtimes = config.runtimes;
        this.handlerRegistry = config.handlerRegistry;
        this.interruptJob = config.interruptJob;
        this.createRuntime = config.createRuntime;
        this.settlerConfigs = buildAllSettlerConfigs();
    }

    /** Subscribe to all lifecycle events. Call once during feature init. */
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
            this.workerTracker.assignWorkerInside(settlerId, buildingId);
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
        if (this.workerTracker.occupants.has(entityId)) {
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

        const idleHandle = this.idleCooldownHandles.get(entityId);
        if (idleHandle !== undefined) {
            this.tickScheduler.cancel(idleHandle);
            this.idleCooldownHandles.delete(entityId);
        }

        this.workerTracker.release(entityId, runtime);
        this.runtimes.delete(entityId);
    }

    /**
     * Mark an entity as ready for an idle work search.
     * Clears any pending idle cooldown handle.
     */
    markReadyForSearch(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime) {
            runtime.idleSearchReady = true;
        }
        this.idleCooldownHandles.delete(entityId);
    }

    /**
     * Schedule a deferred idle search cooldown for a settler.
     * Replaces any existing cooldown for the same entity.
     */
    scheduleIdleCooldown(entityId: number, delay: number): void {
        const existingHandle = this.idleCooldownHandles.get(entityId);
        if (existingHandle !== undefined) {
            this.tickScheduler.cancel(existingHandle);
        }
        const handle = this.tickScheduler.schedule(delay, () => this.markReadyForSearch(entityId));
        this.idleCooldownHandles.set(entityId, handle);
    }

    /**
     * Get or create a UnitRuntime for the given entity ID.
     * New runtimes are scheduled with a staggered idle cooldown.
     */
    getOrCreateRuntime(entityId: number): UnitRuntime {
        let runtime = this.runtimes.get(entityId);
        if (!runtime) {
            runtime = this.createRuntime();
            this.runtimes.set(entityId, runtime);
            const stagger = Math.max(1, entityId % IDLE_SEARCH_COOLDOWN);
            this.scheduleIdleCooldown(entityId, stagger);
        }
        return runtime;
    }

    /** Unsubscribe from all events and cancel the scheduled orphan check. */
    destroy(): void {
        this.subscriptions.unsubscribeAll();
        this.tickScheduler.cancel(this.orphanHandle);
        this.orphanHandle = NO_HANDLE;
        for (const handle of this.idleCooldownHandles.values()) {
            this.tickScheduler.cancel(handle);
        }
        this.idleCooldownHandles.clear();
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

        this.interruptJob(entity, unitConfig, runtime);
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

        runtime.homeAssignment = null;
        this.runtimes.reindex(settlerId);

        if (runtime.job) {
            const entity = this.gameState.getEntityOrThrow(settlerId, 'settler whose approach was interrupted');
            const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
            if (unitConfig) {
                this.interruptJob(entity, unitConfig, runtime);
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
                this.interruptJob(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }
        this.workerTracker.release(unitId, runtime);
        runtime.state = SettlerState.IDLE;
        runtime.moveTask = null;
    }

    private onBuildingRemoved(buildingId: number): void {
        this.workerTracker.clearBuilding(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes.raw as Map<number, UnitRuntime>)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) {
                continue;
            }

            runtime.homeAssignment = null;
            this.runtimes.reindex(settlerId);

            if (runtime.job) {
                const entity = this.gameState.getEntity(settlerId);
                if (entity) {
                    const config = this.settlerConfigs.get(entity.subType as UnitType);
                    if (config) {
                        this.interruptJob(entity, config, runtime);
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
            this.interruptJob(entity, config, runtime);
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
