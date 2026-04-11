/**
 * LogisticsDispatcher - Orchestrates demand fulfillment and carrier assignments.
 *
 * This is the integration layer between the logistics system and the carrier system.
 * Each tick, it:
 * 1. Finds pending demands from the DemandQueue
 * 2. Matches them to available supplies (via RequestMatcher)
 * 3. Creates a TransportJob (which reserves inventory + marks demand consumed)
 * 4. Assigns idle carriers to fulfill the job (via CarrierAssigner)
 *
 * TransportJobStore owns the full lifecycle: reservation, demand status, and cleanup.
 * The dispatcher's role is limited to: coordinating the sub-systems, creating jobs,
 * and cancelling jobs when external events require it (carrier removed, building destroyed).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { CarrierRegistry, IdleCarrierPool } from '../carriers';
import type { DemandEntry } from './demand-queue';
import type { DemandQueue } from './demand-queue';
import { TransportPhase, createDeliveryOnlyRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { TransportJobStore } from './transport-job-store';
import type { BuildingInventoryManager } from '../inventory';
import { RequestMatcher } from './request-matcher';
import type { LogisticsMatchFilter, CarrierFilter } from './logistics-filter';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import { CarrierAssigner, type AssignmentSuccess, type JobAssigner } from './carrier-assigner';
import { PreAssignmentQueue } from './pre-assignment-queue';
import { StallDetector } from './stall-detector';
import { MatchDiagnostics } from './match-diagnostics';
import { ThrottledEmitter } from './throttled-emitter';
import { TransportJobBuilder, type TransportPositionResolver } from './transport-job-builder';
import { clearCarrying, clearJobId } from '../../entity';
import { createLogger } from '@/utilities/logger';

const log = createLogger('LogisticsDispatcher');

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/** Cooldown in seconds for throttled logistics events per (building, material) pair. */
const EVENT_COOLDOWN_SEC = 5;

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
    idleCarrierPool: IdleCarrierPool;
    jobAssigner: JobAssigner;
    positionResolver: TransportPositionResolver;
    demandQueue: DemandQueue;
    jobStore: TransportJobStore;
    inventoryManager: BuildingInventoryManager;
    storageFilterManager?: StorageFilterManager;
    matchFilter?: LogisticsMatchFilter;
    carrierFilter?: CarrierFilter;
}

/**
 * Orchestrates demand fulfillment, supply matching, and carrier assignments.
 *
 * Composes RequestMatcher, CarrierAssigner, StallDetector, and MatchDiagnostics
 * to coordinate the full logistics dispatch loop each tick.
 */
export class LogisticsDispatcher implements TickSystem {
    /** Single source of truth for all active transport jobs. Public for feature wiring. */
    readonly jobStore: TransportJobStore;

    private readonly demandQueue: DemandQueue;
    private readonly requestMatcher: RequestMatcher;
    private readonly carrierAssigner: CarrierAssigner;
    private readonly stallDetector: StallDetector;
    private readonly matchDiagnostics: MatchDiagnostics;
    private readonly eventBus: EventBus;

    /** Dependencies for TransportJobService lifecycle operations. */
    private readonly transportJobDeps: TransportJobDeps;

    private readonly noMatchEmitter: ThrottledEmitter<'logistics:noMatch'>;
    private readonly noCarrierEmitter: ThrottledEmitter<'logistics:noCarrier'>;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    /** Pre-assignment queue for busy carriers that will get a job when their current delivery completes. */
    private readonly preAssignmentQueue: PreAssignmentQueue;

    /** Job assigner reference needed for flushing queued assignments and resuming orphaned jobs. */
    private readonly jobAssigner: JobAssigner;

    /** Builder for creating transport choreographies (needed for resuming PickedUp jobs after restore). */
    private readonly transportJobBuilder: TransportJobBuilder;

    /** Carrier registry for scanning all carrier entities during restore reconstruction. */
    private readonly carrierRegistry: CarrierRegistry;

    constructor(config: LogisticsDispatcherConfig) {
        this.eventBus = config.eventBus;
        this.demandQueue = config.demandQueue;
        this.jobStore = config.jobStore;
        this.jobAssigner = config.jobAssigner;
        this.carrierRegistry = config.carrierRegistry;

        this.transportJobDeps = {
            jobStore: config.jobStore,
            demandQueue: config.demandQueue,
            eventBus: config.eventBus,
            inventoryManager: config.inventoryManager,
            gameState: config.gameState,
        };

        this.preAssignmentQueue = new PreAssignmentQueue(this.transportJobDeps);

        this.requestMatcher = new RequestMatcher({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
            jobStore: config.jobStore,
            storageFilterManager: config.storageFilterManager,
            matchFilter: config.matchFilter,
        });

        this.transportJobBuilder = new TransportJobBuilder({
            gameState: config.gameState,
            positionResolver: config.positionResolver,
            inventoryManager: config.inventoryManager,
            jobStore: config.jobStore,
            transportJobDeps: this.transportJobDeps,
        });

        this.carrierAssigner = new CarrierAssigner({
            gameState: config.gameState,
            eventBus: config.eventBus,
            idleCarrierPool: config.idleCarrierPool,
            jobAssigner: config.jobAssigner,
            transportJobBuilder: this.transportJobBuilder,
            jobStore: config.jobStore,
            demandQueue: config.demandQueue,
            inventoryManager: config.inventoryManager,
            preAssignmentQueue: this.preAssignmentQueue,
            activeJobs: config.jobStore.jobs.raw,
            byPhase: config.jobStore.byPhase,
            carrierFilter: config.carrierFilter,
        });

        this.stallDetector = new StallDetector({
            jobStore: config.jobStore,
            gameState: config.gameState,
        });

        this.matchDiagnostics = new MatchDiagnostics({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
        });

        this.noMatchEmitter = new ThrottledEmitter(config.eventBus, 'logistics:noMatch', EVENT_COOLDOWN_SEC);
        this.noCarrierEmitter = new ThrottledEmitter(config.eventBus, 'logistics:noCarrier', EVENT_COOLDOWN_SEC);
    }

    /** Set the match filter for supply matching (territory, diplomacy, etc.). */
    setMatchFilter(filter: LogisticsMatchFilter | null): void {
        this.requestMatcher.matchFilter = filter;
    }

    /** Set the carrier eligibility filter (territory, etc.). */
    setCarrierFilter(filter: CarrierFilter | null): void {
        this.carrierAssigner.carrierFilter = filter;
    }

    /**
     * Register for carrier and entity events.
     * deliveryComplete and pickupFailed are handled by TransportJob internally,
     * but we still listen to clean up our job store.
     *
     * Uses CLEANUP_PRIORITY.LOGISTICS to ensure building destruction handling fires
     * before inventory removal (inventory data must exist when releasing reservations).
     */
    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        // Don't delete jobs or flush pre-assignments on deliveryComplete — the
        // carrier's choreography is still running its delivery animation. Cleaning up here
        // makes the carrier appear idle to the carrier-assigner tick, which would reassign
        // it immediately, interrupting the active job and emitting a false settler:taskFailed.
        // Instead, both cleanup and flush happen on settler:taskCompleted when the job ends naturally.
        this.subscriptions.subscribe(eventBus, 'settler:taskCompleted', ({ unitId }) => {
            this.jobStore.jobs.delete(unitId);
            const entity = this.transportJobDeps.gameState.getEntity(unitId);
            if (entity) {
                clearJobId(entity);
            }
            this.flushQueuedAssignment(unitId);
        });

        this.subscriptions.subscribe(eventBus, 'carrier:pickupFailed', ({ unitId }) => {
            this.jobStore.jobs.delete(unitId);
            this.preAssignmentQueue.cancel(unitId);
        });

        // Unified cleanup: TransportJob.cancel() emits this event regardless of which path cancelled.
        // This ensures jobStore is always cleaned up — even when cancellation comes from
        // WorkerTaskExecutor.interruptJob() (the "dual path" that previously left stale entries).
        this.subscriptions.subscribe(eventBus, 'carrier:transportCancelled', ({ unitId }) => {
            this.jobStore.jobs.delete(unitId);
            this.preAssignmentQueue.cancel(unitId);
        });

        // When a construction site completes, cancel all in-flight jobs and pending demands
        // targeting it. The inventory is swapped from construction → production, so carriers
        // can no longer deposit construction materials there.
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ buildingId }) =>
            this.handleConstructionCompleted(buildingId)
        );

        // Clean up logistics state when buildings are destroyed.
        // LOGISTICS priority ensures this runs before inventory removal (LATE priority).
        cleanupRegistry.onEntityRemoved(this.handleBuildingDestroyed.bind(this), CLEANUP_PRIORITY.LOGISTICS);
    }

    /** Unregister event handlers. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Cleanup for HMR and game exit. */
    destroy(): void {
        this.unregisterEvents();
    }

    /**
     * Rebuild transport jobs from entity state after keyframe restore / hot reload.
     *
     * Transport jobs are now transient — not persisted. On restore, we reconstruct them
     * from entity state (entity.jobId, entity.carrying) combined with slot reservations
     * (keyed by carrierId). Only carriers (UnitType.Carrier) are scanned.
     *
     * - Carriers with entity.carrying: slot reservation exists → reconstruct delivery-only job
     * - Carriers without entity.carrying but jobId set: Reserved-phase job never picked up →
     *   clear jobId and release the slot reservation; demand will be re-created by scanners
     */
    rebuildFromEntities(): void {
        const gameState = this.transportJobDeps.gameState;
        const inventoryManager = this.transportJobDeps.inventoryManager;

        for (const carrierId of this.carrierRegistry) {
            const entity = gameState.getEntityOrThrow(carrierId, 'rebuildFromEntities carrier scan');

            if (entity.jobId == null) {
                continue;
            }

            if (!entity.carrying) {
                // Reserved phase that never picked up: clear jobId and release reservation
                const reservation = inventoryManager.findReservationByCarrier(carrierId);
                // Reservation may not exist if save happened between jobId assignment and reserveSlot
                if (reservation) {
                    const resJobId = reservation.slot.reservations.find(r => r.carrierId === carrierId)!.jobId;
                    inventoryManager.unreserveSlot(reservation.slotId, resJobId);
                }
                clearJobId(entity);
                continue;
            }

            // PickedUp phase: carrier holds material — find slot reservation and reconstruct job
            const reservation = inventoryManager.findReservationByCarrier(carrierId);
            if (!reservation) {
                // Reservation lost between save cycles — drop the material, carrier becomes idle
                log.warn(
                    `Carrier ${carrierId} carrying ${entity.carrying.material} but no slot reservation — dropping`
                );
                clearCarrying(entity);
                clearJobId(entity);
                continue;
            }
            const destBuilding = reservation.slot.buildingId!;

            // Reconstruct a PickedUp-phase record with a fresh job ID.
            const record = createDeliveryOnlyRecord(
                gameState.allocateJobId(),
                carrierId,
                destBuilding,
                entity.carrying.material,
                entity.carrying.amount,
                reservation.slotId,
                this.transportJobDeps.demandQueue.getGameTime()
            );

            this.jobStore.jobs.set(carrierId, record);

            const choreoJob = this.transportJobBuilder.buildDeliveryOnly(record);
            const success = this.jobAssigner.assignJob(carrierId, choreoJob, choreoJob.targetPos!);

            if (success) {
                log.info(`Rebuilt delivery job for carrier ${carrierId} (job #${record.id}, ${record.material})`);
            } else {
                log.warn(`Failed to rebuild delivery for carrier ${carrierId} — cancelling and clearing state`);
                this.jobStore.jobs.delete(carrierId);
                inventoryManager.unreserveSlot(reservation.slotId, record.id);
                clearCarrying(entity);
                clearJobId(entity);
            }
        }

        // Clean up orphaned slot reservations — reservations from a previous save cycle
        // that don't match any rebuilt job.
        const activeJobIds = new Set<number>();
        for (const job of this.jobStore.jobs.values()) {
            activeJobIds.add(job.id);
        }
        inventoryManager.removeOrphanedReservations(jobId => activeJobIds.has(jobId));
    }

    /**
     * Main tick — assign pending demands to available carriers and check for stalls.
     */
    tick(dt: number): void {
        this.noMatchEmitter.advance(dt);
        this.noCarrierEmitter.advance(dt);
        this.demandQueue.advanceTime(dt);
        this.matchDiagnostics.tick(dt);
        this.assignPendingDemands();
        this.matchDiagnostics.markConsumed();
        this.stallDetector.tick(dt);
    }

    /**
     * Assign pending demands to available carriers.
     * Limits assignments per tick to prevent frame drops.
     */
    private assignPendingDemands(): void {
        const pendingDemands = this.demandQueue.getSortedDemands();
        let assignmentCount = 0;

        for (const demand of pendingDemands) {
            if (assignmentCount >= MAX_ASSIGNMENTS_PER_TICK) {
                break; // Continue next tick
            }

            // Skip if demand is already being fulfilled (assigned by a previous iteration this tick)
            if (this.jobStore.hasDemand(demand.id)) {
                continue;
            }

            const candidates = this.requestMatcher.matchRequestCandidates(demand, 5);
            if (candidates.length === 0) {
                if (this.matchDiagnostics.isDue()) {
                    this.matchDiagnostics.logFailure(demand);
                }
                this.emitNoMatchThrottled(demand);
                continue; // No supply available for this demand
            }

            const result = this.carrierAssigner.tryAssignBest(demand, candidates);
            if (result === 'no_carrier') {
                this.emitNoCarrierThrottled(demand, candidates[0]!.sourceBuilding);
                continue;
            }
            if (result) {
                this.trackAssignmentResult(result);
                assignmentCount++;
            }
        }
    }

    /** Track a successful assignment result — queued assignments skip jobStore until flushed. */
    private trackAssignmentResult(result: AssignmentSuccess | { queued: true }): void {
        if ('queued' in result) {
            return;
        }
        this.jobStore.jobs.set(result.carrierId, result.record);
    }

    /** Emit `logistics:noMatch` at most once per cooldown per material type. */
    private emitNoMatchThrottled(demand: DemandEntry): void {
        const key = `${demand.materialType}`;
        const s = this.requestMatcher.lastRejectionStats;
        this.noMatchEmitter.tryEmit(key, {
            requestId: demand.id,
            buildingId: demand.buildingId,
            materialType: demand.materialType,
            rejection: s
                ? {
                      supplies: s.suppliesFound,
                      sourceIds: s.sourceIds,
                      self: s.self,
                      storageBlocked: s.storageBlocked,
                      reserved: s.fullyReserved,
                      filter: s.filterRejected,
                  }
                : undefined,
        });
    }

    /** Emit `logistics:noCarrier` at most once per cooldown per material type. */
    private emitNoCarrierThrottled(demand: DemandEntry, sourceBuilding: number): void {
        const key = `${demand.materialType}`;
        this.noCarrierEmitter.tryEmit(key, {
            requestId: demand.id,
            buildingId: demand.buildingId,
            materialType: demand.materialType,
            sourceBuilding,
        });
    }

    /**
     * Flush a queued assignment for a carrier that just finished its delivery.
     * If the carrier has a pre-assigned job, assign it immediately.
     */
    private flushQueuedAssignment(carrierId: number): void {
        const queued = this.preAssignmentQueue.flush(carrierId);
        if (!queued) {
            return;
        }

        const success = this.jobAssigner.assignJob(queued.carrierId, queued.job, queued.moveTo);
        if (success) {
            // Promote from pending reservations to active jobs
            this.jobStore.promotePending(queued.record.id);
        } else {
            // Assignment failed (e.g. movement blocked) — cancel the reserved job
            this.jobStore.removePending(queued.record.id);
            TransportJobService.cancel(queued.record, 'assignment_failed', this.transportJobDeps);
        }
        this.eventBus.emit('logistics:preAssignFlushed', {
            carrierId: queued.carrierId,
            demandId: queued.record.demandId,
            jobId: queued.record.id,
            success,
            reason: success ? undefined : 'assignment_failed',
        });
    }

    /**
     * Cancel all logistics targeting a building that just finished construction.
     *
     * When a construction site completes, its inventory is swapped from construction
     * (input slots for BOARD/STONE) to production (output slots). Any in-flight
     * carriers or pending demands targeting the old construction inventory must be
     * cancelled to prevent deposit failures.
     */
    private handleConstructionCompleted(buildingId: number): void {
        let jobsCancelled = 0;
        const affectedCarriers = this.jobStore.byBuilding.get(buildingId);
        for (const carrierId of Array.from(affectedCarriers)) {
            const job = this.jobStore.jobs.get(carrierId);
            if (!job) {
                throw new Error(`No job for carrier ${carrierId} in LogisticsDispatcher.handleConstructionCompleted`);
            }
            if (job.destBuilding === buildingId) {
                TransportJobService.cancel(job, 'construction_completed', this.transportJobDeps);
                this.jobStore.jobs.delete(carrierId);
                jobsCancelled++;
            }
        }

        this.preAssignmentQueue.cancelForBuilding(buildingId);

        const requestsCancelled = this.demandQueue.cancelDemandsForBuilding(buildingId);

        if (requestsCancelled + jobsCancelled > 0) {
            this.eventBus.emit('logistics:buildingCleanedUp', {
                buildingId,
                requestsCancelled,
                jobsCancelled,
            });
        }
    }

    /**
     * Cleanup when a building is destroyed.
     *
     * Finds all active TransportJobs involving the building and cancels them.
     * Also cancels demands TO the building (destination gone).
     */
    handleBuildingDestroyed(buildingId: number): BuildingCleanupResult {
        const result: BuildingCleanupResult = {
            buildingId,
            requestsCancelled: 0,
            jobsCancelled: 0,
        };

        // Handle active TransportJobs referencing this building (via byBuilding index)
        const affectedCarriers = this.jobStore.byBuilding.get(buildingId);
        for (const carrierId of Array.from(affectedCarriers)) {
            const job = this.jobStore.jobs.get(carrierId);
            if (!job) {
                throw new Error(`No job for carrier ${carrierId} in LogisticsDispatcher.handleBuildingDestroyed`);
            }
            if (job.destBuilding === buildingId || job.sourceBuilding === buildingId) {
                // Already picked up from source — let carrier deliver
                if (job.sourceBuilding === buildingId && job.phase === TransportPhase.PickedUp) {
                    continue;
                }
                TransportJobService.cancel(job, 'building_destroyed', this.transportJobDeps);
                this.jobStore.jobs.delete(carrierId);
                result.jobsCancelled++;
            }
        }

        // Cancel queued assignments referencing the destroyed building
        this.preAssignmentQueue.cancelForBuilding(buildingId);

        // Cancel pending demands TO this building (no carrier assigned yet)
        result.requestsCancelled = this.demandQueue.cancelDemandsForBuilding(buildingId);

        this.eventBus.emit('logistics:buildingCleanedUp', result);

        if (result.requestsCancelled + result.jobsCancelled > 0) {
            console.debug(
                `[Logistics] Building ${buildingId} cleanup: ` +
                    `${result.requestsCancelled} demands cancelled, ${result.jobsCancelled} jobs cancelled`
            );
        }

        return result;
    }
}

/**
 * Result of building destruction cleanup.
 */
export interface BuildingCleanupResult {
    buildingId: number;
    requestsCancelled: number;
    jobsCancelled: number;
}
