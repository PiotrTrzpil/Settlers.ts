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

import type { TickSystem } from '../../tick-system';
import type { CoreDeps } from '../feature';
import type { EMaterialType } from '../../economy/material-type';
import { sortedEntries } from '@/utilities/collections';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { CarrierRegistry } from '../carriers';
import type { RequestManager } from './request-manager';
import { RequestStatus, type ResourceRequest } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import type { TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { TransportJobOps } from '../settler-tasks/choreo-types';
import type { BuildingInventoryManager } from '../inventory';
import { RequestMatcher } from './request-matcher';
import type { LogisticsMatchFilter, CarrierFilter } from './logistics-filter';
import { CarrierAssigner, type JobAssigner } from './carrier-assigner';
import { StallDetector } from './stall-detector';
import { MatchDiagnostics } from './match-diagnostics';
import { ThrottledEmitter } from './throttled-emitter';
import { TransportJobBuilder, type TransportPositionResolver, type ChoreographyLookup } from './transport-job-builder';

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/** Cooldown in seconds for throttled logistics events per (building, material) pair. */
const EVENT_COOLDOWN_SEC = 5;

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
    jobAssigner: JobAssigner;
    positionResolver: TransportPositionResolver;
    choreographyLookup: ChoreographyLookup;
    requestManager: RequestManager;
    inventoryManager: BuildingInventoryManager;
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

    /** Active transport jobs indexed by carrier ID. Exposed read-only for testing/diagnostics. */
    readonly activeJobs: Map<number, TransportJobRecord> = new Map();

    /** Dependencies for TransportJobService lifecycle operations. */
    private readonly transportJobDeps: TransportJobDeps;

    private readonly noMatchEmitter: ThrottledEmitter<'logistics:noMatch'>;
    private readonly noCarrierEmitter: ThrottledEmitter<'logistics:noCarrier'>;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    /** Pending pile redirects from building destruction (set at DEFAULT, consumed at LOGISTICS priority). */
    private readonly pendingPileRedirects = new Map<number, Map<EMaterialType, number>>();

    constructor(config: LogisticsDispatcherConfig) {
        this.eventBus = config.eventBus;
        this.requestManager = config.requestManager;
        this.reservationManager = new InventoryReservationManager(config.inventoryManager);

        this.transportJobDeps = {
            reservationManager: this.reservationManager,
            requestManager: this.requestManager,
            eventBus: this.eventBus,
        };

        this.requestMatcher = new RequestMatcher({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
            reservationManager: this.reservationManager,
            matchFilter: config.matchFilter,
        });

        const transportJobBuilder = new TransportJobBuilder({
            gameState: config.gameState,
            positionResolver: config.positionResolver,
            choreographyLookup: config.choreographyLookup,
        });

        this.carrierAssigner = new CarrierAssigner({
            gameState: config.gameState,
            eventBus: config.eventBus,
            carrierRegistry: config.carrierRegistry,
            jobAssigner: config.jobAssigner,
            transportJobBuilder,
            reservationManager: this.reservationManager,
            requestManager: config.requestManager,
            carrierFilter: config.carrierFilter,
            activeJobs: this.activeJobs,
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
        const onCarrierJobEnd = ({ entityId }: { entityId: number }) => this.activeJobs.delete(entityId);
        this.subscriptions.subscribe(eventBus, 'carrier:deliveryComplete', onCarrierJobEnd);
        this.subscriptions.subscribe(eventBus, 'carrier:pickupFailed', onCarrierJobEnd);

        // Unified cleanup: TransportJob.cancel() emits this event regardless of which path cancelled.
        // This ensures activeJobs is always cleaned up — even when cancellation comes from
        // WorkerTaskExecutor.interruptJob() (the "dual path" that previously left stale entries).
        this.subscriptions.subscribe(eventBus, 'carrier:transportCancelled', ({ carrierId }) =>
            this.activeJobs.delete(carrierId)
        );

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
        this.stallDetector.tick(dt, this.activeJobs);
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

            const match = this.requestMatcher.matchRequest(request);
            if (!match) {
                if (this.matchDiagnostics.isDue()) {
                    this.matchDiagnostics.logFailure(request);
                }
                this.emitNoMatchThrottled(request);
                continue; // No supply available for this request
            }

            const result = this.carrierAssigner.tryAssign(request, match);
            if (result === 'no_carrier') {
                this.emitNoCarrierThrottled(request, match.sourceBuilding);
                continue;
            }
            if (result) {
                this.activeJobs.set(result.carrierId, result.record);
                assignmentCount++;
            }
        }
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
     * Cancel all logistics targeting a building that just finished construction.
     *
     * When a construction site completes, its inventory is swapped from construction
     * (input slots for BOARD/STONE) to production (output slots). Any in-flight
     * carriers or pending requests targeting the old construction inventory must be
     * cancelled to prevent deposit failures.
     */
    private handleConstructionCompleted(buildingId: number): void {
        let jobsCancelled = 0;
        for (const [carrierId, job] of sortedEntries(this.activeJobs)) {
            if (job.destBuilding === buildingId) {
                TransportJobService.cancel(job, 'construction_completed', this.transportJobDeps);
                this.activeJobs.delete(carrierId);
                jobsCancelled++;
            }
        }

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
        for (const [carrierId, job] of sortedEntries(this.activeJobs)) {
            if (job.destBuilding === buildingId) {
                // Destination destroyed — must cancel, carrier has nowhere to deliver
                TransportJobService.cancel(job, 'building_destroyed', this.transportJobDeps);
                this.activeJobs.delete(carrierId);
                result.jobsCancelled++;
            } else if (job.sourceBuilding === buildingId) {
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
    activeJobs: ReadonlyMap<number, TransportJobRecord>,
    jobId: number
): TransportJobRecord | undefined {
    for (const record of activeJobs.values()) {
        if (record.id === jobId) return record;
    }
    return undefined;
}
