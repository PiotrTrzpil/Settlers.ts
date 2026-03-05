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
import { sortedEntries } from '@/utilities/collections';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { GameState } from '../../game-state';
import type { CarrierManager } from '../carriers';
import type { RequestManager } from './request-manager';
import type { ServiceAreaManager } from '../service-areas';
import { RequestStatus, type ResourceRequest } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import type { TransportJob } from './transport-job';
import type { BuildingInventoryManager } from '../inventory';
import type { TerritoryManager } from '../territory';
import { RequestMatcher } from './request-matcher';
import { CarrierAssigner, type JobAssigner } from './carrier-assigner';
import { StallDetector } from './stall-detector';
import { MatchDiagnostics } from './match-diagnostics';
import { TransportJobBuilder, type TransportPositionResolver, type ChoreographyLookup } from './transport-job-builder';

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/** Cooldown in seconds for `logistics:noCarrier` event per (building, material) pair. */
const NO_CARRIER_COOLDOWN = 5;

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig {
    gameState: GameState;
    eventBus: EventBus;
    carrierManager: CarrierManager;
    jobAssigner: JobAssigner;
    positionResolver: TransportPositionResolver;
    choreographyLookup: ChoreographyLookup;
    requestManager: RequestManager;
    serviceAreaManager: ServiceAreaManager;
    inventoryManager: BuildingInventoryManager;
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

    /** Active transport jobs indexed by carrier ID */
    private readonly activeJobs: Map<number, TransportJob> = new Map();

    /** Throttle for `logistics:noCarrier` and `logistics:noMatch` — tracks last emit time per key. */
    private readonly noCarrierCooldowns = new Map<string, number>();
    private readonly noMatchCooldowns = new Map<string, number>();
    private elapsedTime = 0;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: LogisticsDispatcherConfig) {
        this.eventBus = config.eventBus;
        this.requestManager = config.requestManager;
        this.reservationManager = new InventoryReservationManager(config.inventoryManager);

        this.requestMatcher = new RequestMatcher({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
            serviceAreaManager: config.serviceAreaManager,
            reservationManager: this.reservationManager,
        });

        const transportJobBuilder = new TransportJobBuilder({
            gameState: config.gameState,
            positionResolver: config.positionResolver,
            choreographyLookup: config.choreographyLookup,
        });

        this.carrierAssigner = new CarrierAssigner({
            gameState: config.gameState,
            eventBus: config.eventBus,
            carrierManager: config.carrierManager,
            jobAssigner: config.jobAssigner,
            transportJobBuilder,
            serviceAreaManager: config.serviceAreaManager,
            reservationManager: this.reservationManager,
            requestManager: config.requestManager,
            inventoryManager: config.inventoryManager,
        });

        this.stallDetector = new StallDetector({
            requestManager: config.requestManager,
            reservationManager: this.reservationManager,
        });

        this.matchDiagnostics = new MatchDiagnostics({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
        });
    }

    /** Whether carriers can deliver globally (true) or only within shared service areas (false). */
    get globalLogistics(): boolean {
        return this.requestMatcher.globalLogistics;
    }

    set globalLogistics(enabled: boolean) {
        this.requestMatcher.globalLogistics = enabled;
        this.carrierAssigner.globalLogistics = enabled;
    }

    /** Whether carrier operations are restricted to player territory. */
    get territoryEnabled(): boolean {
        return this.requestMatcher.territoryEnabled;
    }

    set territoryEnabled(enabled: boolean) {
        this.requestMatcher.territoryEnabled = enabled;
    }

    /** Set the territory manager for territory-based filtering. */
    setTerritoryManager(manager: TerritoryManager): void {
        this.requestMatcher.setTerritoryManager(manager);
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

        this.subscriptions.subscribe(eventBus, 'carrier:removed', ({ entityId }) =>
            this.handleCarrierRemoved(entityId)
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
        this.elapsedTime += dt;
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
                this.activeJobs.set(result.carrierId, result.transportJob);
                assignmentCount++;
            }
        }
    }

    /** Emit `logistics:noMatch` at most once per 5 seconds per (building, material) pair. */
    private emitNoMatchThrottled(request: ResourceRequest): void {
        const key = `${request.buildingId}:${request.materialType}`;
        const lastEmit = this.noMatchCooldowns.get(key) ?? -Infinity;
        if (this.elapsedTime - lastEmit < NO_CARRIER_COOLDOWN) return;
        this.noMatchCooldowns.set(key, this.elapsedTime);
        this.eventBus.emit('logistics:noMatch', {
            requestId: request.id,
            buildingId: request.buildingId,
            materialType: request.materialType,
        });
    }

    /** Emit `logistics:noCarrier` at most once per 5 seconds per (building, material) pair. */
    private emitNoCarrierThrottled(request: ResourceRequest, sourceBuilding: number): void {
        const key = `${request.buildingId}:${request.materialType}`;
        const lastEmit = this.noCarrierCooldowns.get(key) ?? -Infinity;
        if (this.elapsedTime - lastEmit < NO_CARRIER_COOLDOWN) return;
        this.noCarrierCooldowns.set(key, this.elapsedTime);
        this.eventBus.emit('logistics:noCarrier', {
            requestId: request.id,
            buildingId: request.buildingId,
            materialType: request.materialType,
            sourceBuilding,
        });
    }

    /**
     * Handle carrier removed — cancel its TransportJob if active.
     */
    private handleCarrierRemoved(carrierId: number): void {
        const job = this.activeJobs.get(carrierId);
        if (!job) return;

        job.cancel('carrier_removed');
        this.activeJobs.delete(carrierId);
    }

    /**
     * Get the reservation manager for testing/debugging.
     */
    getReservationManager(): InventoryReservationManager {
        return this.reservationManager;
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

        // Cancel all active TransportJobs that reference this building
        for (const [carrierId, job] of sortedEntries(this.activeJobs)) {
            if (job.sourceBuilding === buildingId || job.destBuilding === buildingId) {
                job.cancel('building_destroyed');
                this.activeJobs.delete(carrierId);
                result.jobsCancelled++;
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
