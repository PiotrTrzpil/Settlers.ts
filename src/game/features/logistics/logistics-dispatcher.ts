/**
 * LogisticsDispatcher - Orchestrates resource requests and carrier assignments.
 *
 * This is the integration layer between the logistics system and the carrier system.
 * Each tick, it:
 * 1. Finds pending resource requests
 * 2. Matches them to available supplies (via RequestMatcher)
 * 3. Creates a TransportJob (which reserves inventory + marks request InProgress)
 * 4. Assigns idle carriers to fulfill the job (via CarrierAssigner)
 *
 * TransportJob owns the full lifecycle: reservation, request status, and cleanup.
 * The dispatcher's role is limited to: coordinating the sub-systems, creating jobs,
 * and cancelling jobs when external events require it (carrier removed, building destroyed).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { EMaterialType } from '../../economy/material-type';
import { sortedEntries } from '@/utilities/collections';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { CarrierRegistry, IdleCarrierPool } from '../carriers';
import type { RequestManager } from './request-manager';
import { RequestStatus, type ResourceRequest } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import { getNextJobId, setNextJobId } from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import { PersistentMap, PersistentValue } from '../../persistence/persistent-store';
import type { TransportJobOps } from '../settler-tasks/choreo-types';
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
import { InFlightTrackerImpl } from './in-flight-tracker';
import type { InFlightTracker } from './in-flight-tracker';

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
    requestManager: RequestManager;
    inventoryManager: BuildingInventoryManager;
    storageFilterManager?: StorageFilterManager;
    matchFilter?: LogisticsMatchFilter;
    carrierFilter?: CarrierFilter;
}

/**
 * Orchestrates resource requests, supply matching, and carrier assignments.
 *
 * Composes RequestMatcher, CarrierAssigner, StallDetector, and MatchDiagnostics
 * to coordinate the full logistics dispatch loop each tick.
 */
export class LogisticsDispatcher implements TickSystem {
    private readonly requestManager: RequestManager;
    private readonly reservationManager: InventoryReservationManager;

    private readonly requestMatcher: RequestMatcher;
    private readonly carrierAssigner: CarrierAssigner;
    private readonly stallDetector: StallDetector;
    private readonly matchDiagnostics: MatchDiagnostics;

    private readonly eventBus: EventBus;

    /** Destination-side in-flight material tracking. */
    readonly inFlightTracker: InFlightTracker;

    /** Active transport jobs indexed by carrier ID. Exposed read-only for testing/diagnostics. */
    readonly activeJobs = new PersistentMap<TransportJobRecord>('transportJobs');

    /** Persisted next job ID counter — syncs with TransportJobService's module-level counter. */
    readonly nextJobIdStore = new PersistentValue<number>('transportNextJobId', 1, {
        serialize: () => getNextJobId(),
        deserialize: (raw: unknown) => {
            const id = raw as number;
            setNextJobId(id);
            return id;
        },
    });

    /** Dependencies for TransportJobService lifecycle operations. */
    private readonly transportJobDeps: TransportJobDeps;

    private readonly noMatchEmitter: ThrottledEmitter<'logistics:noMatch'>;
    private readonly noCarrierEmitter: ThrottledEmitter<'logistics:noCarrier'>;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    /** Pre-assignment queue for busy carriers that will get a job when their current delivery completes. */
    private readonly preAssignmentQueue: PreAssignmentQueue;

    /** Job assigner reference needed for flushing queued assignments. */
    private readonly jobAssigner: JobAssigner;

    /** Pending pile redirects from building destruction (set at DEFAULT, consumed at LOGISTICS priority). */
    private readonly pendingPileRedirects = new Map<number, Map<EMaterialType, number>>();

    constructor(config: LogisticsDispatcherConfig) {
        this.eventBus = config.eventBus;
        this.requestManager = config.requestManager;
        this.reservationManager = new InventoryReservationManager(config.inventoryManager);
        this.inFlightTracker = new InFlightTrackerImpl();
        this.jobAssigner = config.jobAssigner;

        this.transportJobDeps = {
            reservationManager: this.reservationManager,
            requestManager: this.requestManager,
            eventBus: this.eventBus,
            inFlightTracker: this.inFlightTracker,
        };

        this.preAssignmentQueue = new PreAssignmentQueue(this.transportJobDeps);

        this.requestMatcher = new RequestMatcher({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
            reservationManager: this.reservationManager,
            storageFilterManager: config.storageFilterManager,
            matchFilter: config.matchFilter,
        });

        const transportJobBuilder = new TransportJobBuilder({
            gameState: config.gameState,
            positionResolver: config.positionResolver,
        });

        this.carrierAssigner = new CarrierAssigner({
            gameState: config.gameState,
            eventBus: config.eventBus,
            idleCarrierPool: config.idleCarrierPool,
            jobAssigner: config.jobAssigner,
            transportJobBuilder,
            reservationManager: this.reservationManager,
            requestManager: config.requestManager,
            inFlightTracker: this.inFlightTracker,
            preAssignmentQueue: this.preAssignmentQueue,
            activeJobs: this.activeJobs.raw,
            carrierFilter: config.carrierFilter,
        });

        this.stallDetector = new StallDetector({
            requestManager: config.requestManager,
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
     * but we still listen to clean up our activeJobs map.
     *
     * Uses CLEANUP_PRIORITY.LOGISTICS to ensure building destruction handling fires
     * before inventory removal (inventory data must exist when releasing reservations).
     */
    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        this.subscriptions.subscribe(eventBus, 'carrier:deliveryComplete', ({ entityId }) => {
            this.activeJobs.delete(entityId);
            this.flushQueuedAssignment(entityId);
        });

        this.subscriptions.subscribe(eventBus, 'carrier:pickupFailed', ({ entityId }) => {
            this.activeJobs.delete(entityId);
            this.preAssignmentQueue.cancel(entityId);
        });

        // Unified cleanup: TransportJob.cancel() emits this event regardless of which path cancelled.
        // This ensures activeJobs is always cleaned up — even when cancellation comes from
        // WorkerTaskExecutor.interruptJob() (the "dual path" that previously left stale entries).
        this.subscriptions.subscribe(eventBus, 'carrier:transportCancelled', ({ carrierId }) => {
            this.activeJobs.delete(carrierId);
            this.preAssignmentQueue.cancel(carrierId);
        });

        // When a construction site completes, cancel all in-flight jobs and pending requests
        // targeting it. The inventory is swapped from construction → production, so carriers
        // can no longer deposit construction materials there.
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ entityId }) =>
            this.handleConstructionCompleted(entityId)
        );

        // Store pile redirect info when building piles are converted to free piles.
        // This fires at DEFAULT priority (before LOGISTICS), so data is ready for handleBuildingDestroyed.
        this.subscriptions.subscribe(eventBus, 'pile:buildingPilesConverted', ({ buildingId, piles }) =>
            this.pendingPileRedirects.set(buildingId, piles)
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
     * Main tick — assign pending requests to available carriers and check for stalls.
     */
    tick(dt: number): void {
        this.noMatchEmitter.advance(dt);
        this.noCarrierEmitter.advance(dt);
        this.requestManager.advanceTime(dt);
        this.matchDiagnostics.tick(dt);
        this.assignPendingRequests();
        this.matchDiagnostics.markConsumed();
        this.stallDetector.tick(dt, this.activeJobs.raw);
    }

    /**
     * Assign pending requests to available carriers.
     * Limits assignments per tick to prevent frame drops.
     */
    private assignPendingRequests(): void {
        const pendingRequests = this.requestManager.getPendingRequests();
        let assignmentCount = 0;

        for (const request of pendingRequests) {
            if (assignmentCount >= MAX_ASSIGNMENTS_PER_TICK) {
                break; // Continue next tick
            }

            // Skip if request is no longer pending (may have been cancelled)
            if (request.status !== RequestStatus.Pending) {
                continue;
            }

            const candidates = this.requestMatcher.matchRequestCandidates(request, 5);
            if (candidates.length === 0) {
                if (this.matchDiagnostics.isDue()) {
                    this.matchDiagnostics.logFailure(request);
                }
                this.emitNoMatchThrottled(request);
                continue; // No supply available for this request
            }

            const result = this.carrierAssigner.tryAssignBest(request, candidates);
            if (result === 'no_carrier') {
                this.emitNoCarrierThrottled(request, candidates[0]!.sourceBuilding);
                continue;
            }
            if (result) {
                this.trackAssignmentResult(result);
                assignmentCount++;
            }
        }
    }

    /** Track a successful assignment result — queued assignments skip activeJobs until flushed. */
    private trackAssignmentResult(result: AssignmentSuccess | { queued: true }): void {
        if ('queued' in result) return;
        this.activeJobs.set(result.carrierId, result.record);
    }

    /** Emit `logistics:noMatch` at most once per cooldown per (building, material) pair. */
    private emitNoMatchThrottled(request: ResourceRequest): void {
        const key = `${request.buildingId}:${request.materialType}`;
        this.noMatchEmitter.tryEmit(key, {
            requestId: request.id,
            buildingId: request.buildingId,
            materialType: request.materialType,
        });
    }

    /** Emit `logistics:noCarrier` at most once per cooldown per (building, material) pair. */
    private emitNoCarrierThrottled(request: ResourceRequest, sourceBuilding: number): void {
        const key = `${request.buildingId}:${request.materialType}`;
        this.noCarrierEmitter.tryEmit(key, {
            requestId: request.id,
            buildingId: request.buildingId,
            materialType: request.materialType,
            sourceBuilding,
        });
    }

    /**
     * Get the reservation manager for testing/debugging.
     */
    getReservationManager(): InventoryReservationManager {
        return this.reservationManager;
    }

    /**
     * Create a TransportJobOps implementation for the settler task system.
     * Resolves job IDs against activeJobs and delegates lifecycle to TransportJobService.
     */
    createTransportJobOps(): TransportJobOps {
        const activeJobs = this.activeJobs;
        const deps = this.transportJobDeps;
        return {
            getJob: jobId => {
                for (const record of activeJobs.values()) {
                    if (record.id === jobId) return record;
                }
                return undefined;
            },
            pickUp: jobId => {
                const record = findJobById(activeJobs, jobId);
                if (!record) return false;
                TransportJobService.pickUp(record, deps);
                return true;
            },
            deliver: jobId => {
                const record = findJobById(activeJobs, jobId);
                if (!record) return false;
                TransportJobService.deliver(record, deps);
                return true;
            },
            cancel: jobId => {
                const record = findJobById(activeJobs, jobId);
                if (record) {
                    TransportJobService.cancel(record, 'cancelled', deps);
                }
            },
        };
    }

    /**
     * Flush a queued assignment for a carrier that just finished its delivery.
     * If the carrier has a pre-assigned job, assign it immediately.
     */
    private flushQueuedAssignment(carrierId: number): void {
        const queued = this.preAssignmentQueue.flush(carrierId);
        if (!queued) return;

        const success = this.jobAssigner.assignJob(queued.carrierId, queued.job, queued.moveTo);
        if (success) {
            this.activeJobs.set(queued.carrierId, queued.record);
        } else {
            // Assignment failed (e.g. movement blocked) — cancel the reserved job
            TransportJobService.cancel(queued.record, 'assignment_failed', this.transportJobDeps);
        }
    }

    /**
     * Cancel all logistics targeting a building that just finished construction.
     *
     * When a construction site completes, its inventory is swapped from construction
     * (input slots for BOARD/STONE) to production (output slots). Any in-flight
     * carriers or pending requests targeting the old construction inventory must be
     * cancelled to prevent deposit failures.
     */
    private handleConstructionCompleted(buildingId: number): void {
        let jobsCancelled = 0;
        for (const [carrierId, job] of sortedEntries(this.activeJobs.raw)) {
            if (job.destBuilding === buildingId) {
                TransportJobService.cancel(job, 'construction_completed', this.transportJobDeps);
                this.activeJobs.delete(carrierId);
                jobsCancelled++;
            }
        }

        this.preAssignmentQueue.cancelForBuilding(buildingId);

        const requestsCancelled = this.requestManager.cancelRequestsForBuilding(buildingId);

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
     * Also cancels requests TO the building (destination gone).
     */
    handleBuildingDestroyed(buildingId: number): BuildingCleanupResult {
        const result: BuildingCleanupResult = {
            buildingId,
            requestsCancelled: 0,
            jobsCancelled: 0,
        };

        // Check if building piles were converted to free piles (set by pile:buildingPilesConverted at DEFAULT priority)
        const pileRedirects = this.pendingPileRedirects.get(buildingId);
        this.pendingPileRedirects.delete(buildingId);

        // Handle active TransportJobs referencing this building
        for (const [carrierId, job] of sortedEntries(this.activeJobs.raw)) {
            if (job.destBuilding === buildingId) {
                // Destination destroyed — must cancel, carrier has nowhere to deliver
                TransportJobService.cancel(job, 'building_destroyed', this.transportJobDeps);
                this.activeJobs.delete(carrierId);
                result.jobsCancelled++;
            } else if (job.sourceBuilding === buildingId) {
                // Already picked up — source doesn't matter, let carrier deliver
                if (job.phase === TransportPhase.PickedUp) {
                    continue;
                }
                // Source destroyed — redirect to free pile if it exists
                const pileEntityId = pileRedirects?.get(job.material);
                if (
                    pileEntityId !== undefined &&
                    TransportJobService.redirectSource(job, pileEntityId, this.transportJobDeps)
                ) {
                    // sourceBuilding already updated by redirectSource
                } else {
                    TransportJobService.cancel(job, 'building_destroyed', this.transportJobDeps);
                    this.activeJobs.delete(carrierId);
                    result.jobsCancelled++;
                }
            }
        }

        // Cancel queued assignments referencing the destroyed building
        this.preAssignmentQueue.cancelForBuilding(buildingId);

        // Cancel pending requests TO this building (no carrier assigned yet)
        result.requestsCancelled = this.requestManager.cancelRequestsForBuilding(buildingId);

        // Release any remaining reservations at this building (defensive — jobs should have handled this)
        this.reservationManager.releaseReservationsForBuilding(buildingId);

        this.eventBus.emit('logistics:buildingCleanedUp', result);

        if (result.requestsCancelled + result.jobsCancelled > 0) {
            console.debug(
                `[Logistics] Building ${buildingId} cleanup: ` +
                    `${result.requestsCancelled} requests cancelled, ${result.jobsCancelled} jobs cancelled`
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

/** Find a job record by ID across all active jobs, or return undefined. */
function findJobById(
    activeJobs: { values(): Iterable<TransportJobRecord> },
    jobId: number
): TransportJobRecord | undefined {
    for (const record of activeJobs.values()) {
        if (record.id === jobId) return record;
    }
    return undefined;
}
