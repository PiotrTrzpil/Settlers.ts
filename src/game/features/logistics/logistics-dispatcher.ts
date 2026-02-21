/**
 * LogisticsDispatcher - Coordinates resource requests and carrier assignments.
 *
 * This is the integration layer between the logistics system and the carrier system.
 * Each tick, it:
 * 1. Finds pending resource requests
 * 2. Matches them to available supplies using FulfillmentMatcher
 * 3. Creates a TransportJob (which reserves inventory + marks request InProgress)
 * 4. Assigns idle carriers to fulfill the job
 *
 * TransportJob owns the full lifecycle: reservation, request status, and cleanup.
 * The dispatcher just creates jobs and cancels them when carriers fail or buildings are destroyed.
 */

import type { TickSystem } from '../../tick-system';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { CarrierManager } from '../carriers';
import { CarrierStatus } from '../carriers';
import type { RequestManager } from './request-manager';
import type { ServiceAreaManager } from '../service-areas';
import { getHubsServingBothPositions, getHubsServingPosition } from '../service-areas/service-area-queries';
import { matchRequestToSupply } from './fulfillment-matcher';
import { RequestStatus, type ResourceRequest } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import { TransportJob } from './transport-job';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingInventoryManager } from '../inventory';
import { buildCarrierJob, type SettlerTaskSystem } from '../settler-tasks';

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig {
    gameState: GameState;
    carrierManager: CarrierManager;
    settlerTaskSystem: SettlerTaskSystem;
    requestManager: RequestManager;
    serviceAreaManager: ServiceAreaManager;
    inventoryManager: BuildingInventoryManager;
}

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/** Request timeout in milliseconds - requests older than this are considered stalled */
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

/** How often to check for stalled requests (in milliseconds) */
const STALL_CHECK_INTERVAL_MS = 5_000; // Check every 5 seconds

/** How often to log match failure diagnostics (in milliseconds) */
const MATCH_DIAGNOSTIC_INTERVAL_MS = 10_000;

/**
 * System that coordinates resource requests with carrier assignments.
 *
 * Creates TransportJob instances that own the reservation + request lifecycle.
 * The dispatcher's role is limited to: matching supply, creating jobs, and
 * cancelling jobs when external events require it (carrier removed, building destroyed).
 */
export class LogisticsDispatcher implements TickSystem {
    private static log = new LogHandler('LogisticsDispatcher');

    private readonly gameState: GameState;
    private readonly carrierManager: CarrierManager;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly requestManager: RequestManager;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly reservationManager: InventoryReservationManager;

    private eventBus!: EventBus;

    /** Active transport jobs indexed by carrier ID */
    private readonly activeJobs: Map<number, TransportJob> = new Map();

    /** Accumulated time since last stall check (in ms) */
    private timeSinceStallCheck: number = 0;

    /** Accumulated time since last match diagnostic log (in ms) */
    private timeSinceMatchDiagnostic: number = 0;
    private matchDiagnosticDue = false;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: LogisticsDispatcherConfig) {
        this.gameState = config.gameState;
        this.carrierManager = config.carrierManager;
        this.settlerTaskSystem = config.settlerTaskSystem;
        this.requestManager = config.requestManager;
        this.serviceAreaManager = config.serviceAreaManager;
        this.inventoryManager = config.inventoryManager;
        this.reservationManager = new InventoryReservationManager();

        // Wire up inventory manager for slot-level reservation enforcement
        this.reservationManager.setInventoryManager(this.inventoryManager);
    }

    /**
     * Register for carrier events.
     * deliveryComplete and pickupFailed are handled by TransportJob internally,
     * but we still listen to clean up our activeJobs map.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;

        this.subscriptions.subscribe(eventBus, 'carrier:deliveryComplete', payload => {
            this.activeJobs.delete(payload.entityId);
        });

        this.subscriptions.subscribe(eventBus, 'carrier:pickupFailed', payload => {
            this.activeJobs.delete(payload.entityId);
        });

        this.subscriptions.subscribe(eventBus, 'carrier:removed', payload => {
            this.handleCarrierRemoved(payload.entityId);
        });

        // Clean up logistics state when buildings are destroyed
        // Must be registered before inventory cleanup (inventory needed for reservation release)
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.handleBuildingDestroyed(entityId);
        });
    }

    /**
     * Unregister event handlers.
     */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Cleanup for HMR and game exit.
     */
    destroy(): void {
        this.unregisterEvents();
    }

    /**
     * Main tick - assign pending requests to available carriers and check for stalls.
     */
    tick(dt: number): void {
        // Enable match diagnostics periodically
        this.timeSinceMatchDiagnostic += dt * 1000;
        if (this.timeSinceMatchDiagnostic >= MATCH_DIAGNOSTIC_INTERVAL_MS) {
            this.timeSinceMatchDiagnostic = 0;
            this.matchDiagnosticDue = true;
        }

        this.assignPendingRequests();
        this.matchDiagnosticDue = false;

        // Periodically check for stalled requests
        this.timeSinceStallCheck += dt * 1000;
        if (this.timeSinceStallCheck >= STALL_CHECK_INTERVAL_MS) {
            this.timeSinceStallCheck = 0;
            this.checkForStalledRequests();
        }
    }

    /**
     * Check for requests that have been in-progress too long (stalled).
     * Cancel the TransportJob, which releases reservation and resets request.
     */
    private checkForStalledRequests(): void {
        const stalledRequests = this.requestManager.getStalledRequests(REQUEST_TIMEOUT_MS);

        for (const request of stalledRequests) {
            LogisticsDispatcher.log.warn(
                `Request #${request.id} stalled after ${REQUEST_TIMEOUT_MS / 1000}s: ` +
                    `material=${request.materialType}, building=${request.buildingId}, carrier=${request.assignedCarrier}. ` +
                    'Cancelling transport job.'
            );

            // Find and cancel the TransportJob for this carrier
            if (request.assignedCarrier !== null) {
                const job = this.activeJobs.get(request.assignedCarrier);
                if (job) {
                    job.cancel('timeout');
                    this.activeJobs.delete(request.assignedCarrier);
                    continue;
                }
            }

            // Fallback: no active job found, clean up manually
            this.reservationManager.releaseReservationForRequest(request.id);
            this.requestManager.resetRequest(request.id, 'timeout');
        }
    }

    /**
     * Assign pending requests to available carriers.
     * Limits assignments per tick to prevent frame drops.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- complex carrier dispatch algorithm
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

            // Look up destination building once for both matching and carrier search
            const destBuilding = this.gameState.getEntityOrThrow(request.buildingId, 'requesting building');
            const playerId = destBuilding.player;

            // Try to match this request to a supply (accounting for already-reserved inventory)
            const match = matchRequestToSupply(
                request,
                this.gameState,
                this.inventoryManager,
                this.serviceAreaManager,
                {
                    playerId,
                    requireServiceArea: true,
                    reservationManager: this.reservationManager,
                }
            );

            if (!match) {
                if (this.matchDiagnosticDue) {
                    this.logMatchFailure(request);
                }
                continue; // No supply available for this request
            }

            // Find an available carrier from a hub that serves both buildings
            const carrier = this.findAvailableCarrier(match.serviceHubs, playerId);
            if (!carrier) {
                if (this.matchDiagnosticDue) {
                    LogisticsDispatcher.log.warn(
                        `Request #${request.id}: matched source=${match.sourceBuilding} but no carrier available ` +
                            `(${match.serviceHubs.length} valid hubs: [${match.serviceHubs.join(', ')}])`
                    );
                }
                continue; // No carrier available
            }

            // Create TransportJob — reserves inventory + marks request InProgress
            const carrierState = this.carrierManager.getCarrierOrThrow(carrier.entityId, 'for delivery assignment');
            const transportJob = TransportJob.create(
                request.id,
                match.sourceBuilding,
                request.buildingId,
                request.materialType,
                match.amount,
                carrierState.homeBuilding,
                carrier.entityId,
                {
                    reservationManager: this.reservationManager,
                    requestManager: this.requestManager,
                    inventoryManager: this.inventoryManager,
                }
            );

            if (!transportJob) {
                continue; // Reservation failed
            }

            // Build carrier job (references the TransportJob) and assign
            const sourceBuilding = this.gameState.getEntityOrThrow(match.sourceBuilding, 'source building for carrier');
            const job = buildCarrierJob(transportJob);
            const success = this.settlerTaskSystem.assignJob(carrier.entityId, job, {
                x: sourceBuilding.x,
                y: sourceBuilding.y,
            });

            if (success) {
                this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
                this.activeJobs.set(carrier.entityId, transportJob);
                assignmentCount++;
            } else {
                transportJob.cancel('assignment_failed');
            }
        }
    }

    /**
     * Find an available carrier from the given service hubs.
     * Uses per-hub carrier lookup instead of scanning all carriers.
     */
    private findAvailableCarrier(serviceHubs: number[], playerId: number): { entityId: number } | null {
        if (serviceHubs.length === 0) {
            return null;
        }

        for (const hubId of serviceHubs) {
            const hubEntity = this.gameState.getEntity(hubId);
            if (!hubEntity || hubEntity.player !== playerId) {
                continue;
            }

            for (const carrier of this.carrierManager.getCarriersForTavern(hubId)) {
                if (this.carrierManager.canAssignJobTo(carrier.entityId)) {
                    return { entityId: carrier.entityId };
                }
            }
        }

        return null;
    }

    /**
     * Log diagnostic info when a request cannot be matched to any supply.
     */
    private logMatchFailure(request: ResourceRequest): void {
        const destBuilding = this.gameState.getEntity(request.buildingId);
        if (!destBuilding) return;

        const playerId = destBuilding.player;
        const destHubs = getHubsServingPosition(destBuilding.x, destBuilding.y, this.serviceAreaManager, { playerId });

        if (destHubs.length === 0) {
            LogisticsDispatcher.log.warn(
                `Request #${request.id} (material=${request.materialType}): ` +
                    `destination building ${request.buildingId} at (${destBuilding.x},${destBuilding.y}) ` +
                    `is NOT covered by any hub service area`
            );
            return;
        }

        const supplies = this.inventoryManager.getBuildingsWithOutput(request.materialType, 1);
        const otherSupplies = supplies.filter(id => id !== request.buildingId);
        if (otherSupplies.length === 0) {
            LogisticsDispatcher.log.debug(
                `Request #${request.id} (material=${request.materialType}): no supply available anywhere`
            );
            return;
        }

        for (const supplyId of otherSupplies) {
            const supplyBuilding = this.gameState.getEntity(supplyId);
            if (!supplyBuilding) continue;

            const supplyHubs = getHubsServingPosition(supplyBuilding.x, supplyBuilding.y, this.serviceAreaManager, {
                playerId,
            });

            if (supplyHubs.length === 0) {
                LogisticsDispatcher.log.warn(
                    `Request #${request.id} (material=${request.materialType}): ` +
                        `supply building ${supplyId} at (${supplyBuilding.x},${supplyBuilding.y}) ` +
                        `is NOT covered by any hub`
                );
            } else {
                const sharedHubs = getHubsServingBothPositions(
                    supplyBuilding.x,
                    supplyBuilding.y,
                    destBuilding.x,
                    destBuilding.y,
                    this.serviceAreaManager,
                    { playerId }
                );
                if (sharedHubs.length === 0) {
                    LogisticsDispatcher.log.warn(
                        `Request #${request.id} (material=${request.materialType}): ` +
                            `supply ${supplyId} at (${supplyBuilding.x},${supplyBuilding.y}) ` +
                            `and dest ${request.buildingId} at (${destBuilding.x},${destBuilding.y}) ` +
                            `are covered by DIFFERENT hubs (no shared hub). ` +
                            `Supply hubs: [${supplyHubs.join(',')}], Dest hubs: [${destHubs.join(',')}]`
                    );
                }
            }
        }
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
        for (const [carrierId, job] of this.activeJobs) {
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
