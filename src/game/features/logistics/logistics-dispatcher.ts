/**
 * LogisticsDispatcher - Coordinates resource requests and carrier assignments.
 *
 * This is the integration layer between the logistics system and the carrier system.
 * Each tick, it:
 * 1. Finds pending resource requests
 * 2. Matches them to available supplies using FulfillmentMatcher
 * 3. Assigns idle carriers to fulfill requests via CarrierSystem
 *
 * It also listens for carrier events to update request status accordingly.
 */

import type { TickSystem } from '../../tick-system';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { CarrierSystem } from '../carriers';
import type { RequestManager } from './request-manager';
import type { ServiceAreaManager } from '../service-areas';
import { getHubsServingBothPositions, getHubsServingPosition } from '../service-areas/service-area-queries';
import { matchRequestToSupply } from './fulfillment-matcher';
import { RequestStatus, type ResourceRequest } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import { canAcceptNewJob } from '../carriers';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingInventoryManager } from '../inventory';

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig {
    gameState: GameState;
    carrierSystem: CarrierSystem;
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
 * This system bridges the gap between:
 * - RequestManager: tracks what materials buildings need
 * - FulfillmentMatcher: finds where to get materials
 * - CarrierSystem: assigns carriers to pickup/deliver jobs
 */
export class LogisticsDispatcher implements TickSystem {
    private static log = new LogHandler('LogisticsDispatcher');

    private readonly gameState: GameState;
    private readonly carrierSystem: CarrierSystem;
    private readonly requestManager: RequestManager;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly reservationManager: InventoryReservationManager;

    private eventBus!: EventBus;

    /** Track which carriers have active requests (carrierId -> requestId) */
    private readonly carrierToRequest: Map<number, number> = new Map();

    /** Accumulated time since last stall check (in ms) */
    private timeSinceStallCheck: number = 0;

    /** Accumulated time since last match diagnostic log (in ms) */
    private timeSinceMatchDiagnostic: number = 0;
    private matchDiagnosticDue = false;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: LogisticsDispatcherConfig) {
        this.gameState = config.gameState;
        this.carrierSystem = config.carrierSystem;
        this.requestManager = config.requestManager;
        this.serviceAreaManager = config.serviceAreaManager;
        this.inventoryManager = config.inventoryManager;
        this.reservationManager = new InventoryReservationManager();

        // Wire up inventory manager for slot-level reservation enforcement
        this.reservationManager.setInventoryManager(this.inventoryManager);
    }

    /**
     * Register for carrier events to track request fulfillment.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;

        // Listen for delivery completions to fulfill requests
        this.subscriptions.subscribe(eventBus, 'carrier:deliveryComplete', payload => {
            this.handleDeliveryComplete(payload.entityId);
        });

        // Listen for pickup failures to reset requests (so they can be reassigned)
        this.subscriptions.subscribe(eventBus, 'carrier:pickupFailed', payload => {
            this.handlePickupFailed(payload.entityId);
        });

        // Listen for carrier removal to reset requests
        this.subscriptions.subscribe(eventBus, 'carrier:removed', payload => {
            this.handleCarrierRemoved(payload.entityId);
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
     * These are reset to pending so they can be reassigned.
     */
    private checkForStalledRequests(): void {
        const stalledRequests = this.requestManager.getStalledRequests(REQUEST_TIMEOUT_MS);

        for (const request of stalledRequests) {
            // Find the carrier assigned to this request
            const carrierId = request.assignedCarrier;

            // Log warning about the stalled request
            LogisticsDispatcher.log.warn(
                `Request #${request.id} stalled after ${REQUEST_TIMEOUT_MS / 1000}s: ` +
                    `material=${request.materialType}, building=${request.buildingId}, carrier=${carrierId}. ` +
                    'Resetting to pending.'
            );

            // Release reservation if it exists
            this.reservationManager.releaseReservationForRequest(request.id);

            // Clear carrier-to-request mapping if we have one
            if (carrierId !== null) {
                this.carrierToRequest.delete(carrierId);
            }

            // Reset the request to pending
            this.requestManager.resetRequest(request.id, 'timeout');
        }
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

            // Try to match this request to a supply (accounting for already-reserved inventory)
            const match = matchRequestToSupply(
                request,
                this.gameState,
                this.inventoryManager,
                this.serviceAreaManager,
                {
                    playerId: this.getRequestPlayerId(request.buildingId),
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

            // Find an available carrier that can serve both buildings
            const carrier = this.findAvailableCarrier(match.sourceBuilding, request.buildingId);
            if (!carrier) {
                if (this.matchDiagnosticDue) {
                    LogisticsDispatcher.log.warn(
                        `Request #${request.id}: matched source=${match.sourceBuilding} but no carrier available ` +
                            `(${match.serviceHubs.length} valid hubs: [${match.serviceHubs.join(', ')}])`
                    );
                }
                continue; // No carrier available
            }

            // Reserve the inventory to prevent race conditions
            const reservation = this.reservationManager.createReservation(
                match.sourceBuilding,
                request.materialType,
                match.amount,
                request.id
            );

            // Assign the delivery job to the carrier
            const success = this.carrierSystem.assignDeliveryJob(
                carrier.entityId,
                match.sourceBuilding,
                request.buildingId,
                request.materialType,
                match.amount
            );

            if (success) {
                // Mark request as in progress
                this.requestManager.assignRequest(request.id, match.sourceBuilding, carrier.entityId);

                // Track the carrier-to-request mapping
                this.carrierToRequest.set(carrier.entityId, request.id);

                assignmentCount++;
            } else {
                // Assignment failed - release reservation
                if (reservation !== null) {
                    this.reservationManager.releaseReservation(reservation.id);
                }
            }
        }
    }

    /**
     * Find an available carrier that can serve both source and destination buildings.
     * The carrier must belong to a hub whose service area covers both buildings.
     */
    private findAvailableCarrier(sourceBuildingId: number, destBuildingId: number): { entityId: number } | null {
        const sourceBuilding = this.gameState.getEntity(sourceBuildingId);
        const destBuilding = this.gameState.getEntity(destBuildingId);

        if (!sourceBuilding || !destBuilding) {
            return null;
        }

        // Get player from destination building (the one requesting)
        const playerId = destBuilding.player;

        // Find hubs (taverns/warehouses) whose service areas cover both buildings
        const validHubs = new Set(
            getHubsServingBothPositions(
                sourceBuilding.x,
                sourceBuilding.y,
                destBuilding.x,
                destBuilding.y,
                this.serviceAreaManager,
                { playerId }
            )
        );

        if (validHubs.size === 0) {
            return null;
        }

        // Find an available carrier whose home is one of the valid hubs
        const carrierManager = this.carrierSystem.getCarrierManager();

        for (const carrier of carrierManager.getAllCarriers()) {
            // Carrier's home must be a hub that serves both buildings
            if (!validHubs.has(carrier.homeBuilding)) {
                continue;
            }

            // Must be able to accept new jobs (not exhausted/collapsed)
            if (!canAcceptNewJob(carrier.fatigue)) {
                continue;
            }

            // Carrier must not already have a job
            if (carrier.currentJob !== null) {
                continue;
            }

            // Verify home building belongs to the right player
            const homeBuilding = this.gameState.getEntity(carrier.homeBuilding);
            if (!homeBuilding || homeBuilding.player !== playerId) {
                continue;
            }

            return { entityId: carrier.entityId };
        }

        return null;
    }

    /**
     * Get the player ID for a building's request.
     */
    private getRequestPlayerId(buildingId: number): number {
        // Building MUST exist - we have an active request for it
        return this.gameState.getEntityOrThrow(buildingId, 'requesting building').player;
    }

    /**
     * Log diagnostic info when a request cannot be matched to any supply.
     * Helps identify service area coverage gaps.
     */
    private logMatchFailure(request: ResourceRequest): void {
        const destBuilding = this.gameState.getEntity(request.buildingId);
        if (!destBuilding) return;

        const playerId = destBuilding.player;
        const destHubs = getHubsServingPosition(destBuilding.x, destBuilding.y, this.serviceAreaManager, { playerId });

        // Check if destination is even covered by any hub
        if (destHubs.length === 0) {
            LogisticsDispatcher.log.warn(
                `Request #${request.id} (material=${request.materialType}): ` +
                    `destination building ${request.buildingId} at (${destBuilding.x},${destBuilding.y}) ` +
                    `is NOT covered by any hub service area`
            );
            return;
        }

        // Check if any supply exists
        const supplies = this.inventoryManager.getBuildingsWithOutput(request.materialType, 1);
        const otherSupplies = supplies.filter((id: number) => id !== request.buildingId);
        if (otherSupplies.length === 0) {
            LogisticsDispatcher.log.debug(
                `Request #${request.id} (material=${request.materialType}): no supply available anywhere`
            );
            return;
        }

        // Check why no supply is reachable
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
                // Both are covered, but by different hubs
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
     * Handle carrier delivery completion - fulfill the corresponding request.
     */
    private handleDeliveryComplete(carrierId: number): void {
        const requestId = this.carrierToRequest.get(carrierId);
        if (requestId === undefined) {
            return; // Carrier wasn't assigned by us
        }

        // Fulfill the request
        this.requestManager.fulfillRequest(requestId);

        // Release any reservations for this request
        this.reservationManager.releaseReservationForRequest(requestId);

        // Clear the mapping
        this.carrierToRequest.delete(carrierId);
    }

    /**
     * Handle carrier pickup failure - reset the request so it can be reassigned.
     * This happens when reserved material is no longer available (e.g., building destroyed).
     */
    private handlePickupFailed(carrierId: number): void {
        const requestId = this.carrierToRequest.get(carrierId);
        if (requestId === undefined) {
            return; // Carrier wasn't assigned by us
        }

        LogisticsDispatcher.log.debug(`Pickup failed for carrier ${carrierId}, resetting request ${requestId}`);

        // Release the reservation (frees up slot-level reservation)
        this.reservationManager.releaseReservationForRequest(requestId);

        // Reset the request so it can be reassigned to another carrier
        this.requestManager.resetRequest(requestId, 'pickup_failed');

        // Clear the mapping
        this.carrierToRequest.delete(carrierId);
    }

    /**
     * Handle carrier removal - reset any request they were fulfilling.
     */
    private handleCarrierRemoved(carrierId: number): void {
        const requestId = this.carrierToRequest.get(carrierId);
        if (requestId === undefined) {
            return;
        }

        // Release the reservation FIRST (before modifying request state)
        this.reservationManager.releaseReservationForRequest(requestId);

        // Reset the request so it can be re-assigned to another carrier
        this.requestManager.resetRequestsForCarrier(carrierId);

        // Clear the mapping
        this.carrierToRequest.delete(carrierId);
    }

    /**
     * Get the reservation manager for testing/debugging.
     */
    getReservationManager(): InventoryReservationManager {
        return this.reservationManager;
    }

    /**
     * Get carrier-to-request mappings for testing/debugging.
     */
    getCarrierToRequestMap(): ReadonlyMap<number, number> {
        return this.carrierToRequest;
    }

    /**
     * Unified cleanup coordinator for building destruction.
     *
     * When a building is destroyed, the logistics system must clean up all
     * related state to prevent orphaned references and resource leaks.
     *
     * This method coordinates cleanup across all logistics subsystems:
     *
     * 1. **Request Cancellation** (RequestManager)
     *    - Cancel requests TO the building (destination no longer exists)
     *    - Reset requests FROM the building (source no longer exists)
     *    - Reset requests return to Pending so they can be reassigned
     *
     * 2. **Reservation Release** (InventoryReservationManager)
     *    - Release all material reservations at the building
     *    - This frees up inventory that was "soft-held" for pending pickups
     *
     * 3. **Carrier Mapping Cleanup** (carrierToRequest map)
     *    - Remove mappings for carriers working on affected requests
     *    - This prevents stale lookups when carriers complete/fail
     *
     * 4. **Event Emission** (EventBus)
     *    - Emit logistics:buildingCleanedUp so other systems can react
     *
     * @param buildingId Entity ID of the destroyed building
     * @returns Summary of cleanup actions taken
     */
    handleBuildingDestroyed(buildingId: number): BuildingCleanupResult {
        const result: BuildingCleanupResult = {
            buildingId,
            requestsCancelled: 0,
            requestsReset: 0,
            reservationsReleased: 0,
            carrierMappingsCleared: 0,
        };

        // Step 1a: Cancel all requests TO this building (it can no longer receive materials)
        result.requestsCancelled = this.requestManager.cancelRequestsForBuilding(buildingId);

        // Step 1b: Reset requests FROM this building (carriers can't pick up from it anymore)
        result.requestsReset = this.requestManager.resetRequestsFromSource(buildingId);

        // Step 2: Release any reservations at this building
        result.reservationsReleased = this.reservationManager.releaseReservationsForBuilding(buildingId);

        // Step 3: Find and remove any carrier-to-request mappings for carriers
        // that were assigned to this building's requests
        // Sort carrier IDs for deterministic iteration order
        const sortedCarrierIds = [...this.carrierToRequest.keys()].sort((a, b) => a - b);
        const mappingsToRemove: number[] = [];
        for (const carrierId of sortedCarrierIds) {
            const requestId = this.carrierToRequest.get(carrierId);
            if (requestId === undefined) continue;
            const request = this.requestManager.getRequest(requestId);
            // Request may already be deleted if it was cancelled, so also check
            // if requestId was in the cancelled set by checking if request is gone
            if (!request || request.buildingId === buildingId || request.sourceBuilding === buildingId) {
                mappingsToRemove.push(carrierId);
            }
        }
        for (const carrierId of mappingsToRemove) {
            this.carrierToRequest.delete(carrierId);
            result.carrierMappingsCleared++;
        }

        // Step 4: Emit event for other systems
        this.eventBus!.emit('logistics:buildingCleanedUp', result);

        // Log summary if any cleanup was performed
        if (
            result.requestsCancelled > 0 ||
            result.requestsReset > 0 ||
            result.reservationsReleased > 0 ||
            result.carrierMappingsCleared > 0
        ) {
            console.debug(
                `[Logistics] Building ${buildingId} cleanup: ` +
                    `${result.requestsCancelled} cancelled, ${result.requestsReset} reset, ` +
                    `${result.reservationsReleased} reservations released, ` +
                    `${result.carrierMappingsCleared} carrier mappings cleared`
            );
        }

        return result;
    }
}

/**
 * Result of building destruction cleanup.
 * Useful for debugging and testing.
 */
export interface BuildingCleanupResult {
    /** Entity ID of the destroyed building */
    buildingId: number;
    /** Number of requests to this building that were cancelled */
    requestsCancelled: number;
    /** Number of requests from this building that were reset to pending */
    requestsReset: number;
    /** Number of inventory reservations that were released */
    reservationsReleased: number;
    /** Number of carrier-to-request mappings that were cleared */
    carrierMappingsCleared: number;
}
