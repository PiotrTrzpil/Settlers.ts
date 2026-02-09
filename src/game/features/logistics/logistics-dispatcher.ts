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
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { CarrierSystem } from '../carriers';
import type { RequestManager } from './request-manager';
import type { ServiceAreaManager } from '../service-areas';
import { matchRequestToSupply } from './fulfillment-matcher';
import { RequestStatus } from './resource-request';
import { InventoryReservationManager } from './inventory-reservation';
import { canAcceptNewJob } from '../carriers';

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig {
    gameState: GameState;
    carrierSystem: CarrierSystem;
    requestManager: RequestManager;
    serviceAreaManager: ServiceAreaManager;
}

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/**
 * System that coordinates resource requests with carrier assignments.
 *
 * This system bridges the gap between:
 * - RequestManager: tracks what materials buildings need
 * - FulfillmentMatcher: finds where to get materials
 * - CarrierSystem: assigns carriers to pickup/deliver jobs
 */
export class LogisticsDispatcher implements TickSystem {
    private readonly gameState: GameState;
    private readonly carrierSystem: CarrierSystem;
    private readonly requestManager: RequestManager;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly reservationManager: InventoryReservationManager;

    private eventBus: EventBus | undefined;

    /** Track which carriers have active requests (carrierId -> requestId) */
    private readonly carrierToRequest: Map<number, number> = new Map();

    /** Event handlers for cleanup */
    private deliveryCompleteHandler: ((payload: {
        entityId: number;
        toBuilding: number;
        material: number;
        amount: number;
        overflow: number;
    }) => void) | undefined;

    private carrierRemovedHandler: ((payload: {
        entityId: number;
        homeBuilding: number;
        hadActiveJob: boolean;
    }) => void) | undefined;

    constructor(config: LogisticsDispatcherConfig) {
        this.gameState = config.gameState;
        this.carrierSystem = config.carrierSystem;
        this.requestManager = config.requestManager;
        this.serviceAreaManager = config.serviceAreaManager;
        this.reservationManager = new InventoryReservationManager();
    }

    /**
     * Register for carrier events to track request fulfillment.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;

        // Listen for delivery completions to fulfill requests
        this.deliveryCompleteHandler = (payload) => {
            this.handleDeliveryComplete(payload.entityId);
        };
        eventBus.on('carrier:deliveryComplete', this.deliveryCompleteHandler);

        // Listen for carrier removal to reset requests
        this.carrierRemovedHandler = (payload) => {
            this.handleCarrierRemoved(payload.entityId);
        };
        eventBus.on('carrier:removed', this.carrierRemovedHandler);
    }

    /**
     * Unregister event handlers.
     */
    unregisterEvents(): void {
        if (this.eventBus) {
            if (this.deliveryCompleteHandler) {
                this.eventBus.off('carrier:deliveryComplete', this.deliveryCompleteHandler);
                this.deliveryCompleteHandler = undefined;
            }
            if (this.carrierRemovedHandler) {
                this.eventBus.off('carrier:removed', this.carrierRemovedHandler);
                this.carrierRemovedHandler = undefined;
            }
        }
    }

    /**
     * Main tick - assign pending requests to available carriers.
     */
    tick(_dt: number): void {
        this.assignPendingRequests();
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
                this.serviceAreaManager,
                {
                    playerId: this.getRequestPlayerId(request.buildingId),
                    requireServiceArea: true,
                    reservationManager: this.reservationManager,
                },
            );

            if (!match) {
                continue; // No supply available for this request
            }

            // Find an available carrier that can serve both buildings
            const carrier = this.findAvailableCarrier(match.sourceBuilding, request.buildingId);
            if (!carrier) {
                continue; // No carrier available
            }

            // Reserve the inventory to prevent race conditions
            const reservation = this.reservationManager.createReservation(
                match.sourceBuilding,
                request.materialType,
                match.amount,
                request.id,
            );

            // Assign the delivery job to the carrier
            const success = this.carrierSystem.assignDeliveryJob(
                carrier.entityId,
                match.sourceBuilding,
                request.buildingId,
                request.materialType,
                match.amount,
            );

            if (success) {
                // Mark request as in progress
                this.requestManager.assignRequest(
                    request.id,
                    match.sourceBuilding,
                    carrier.entityId,
                );

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
     * The carrier must be in the service area of both buildings and be idle/available.
     */
    private findAvailableCarrier(
        sourceBuildingId: number,
        destBuildingId: number,
    ): { entityId: number } | null {
        const sourceBuilding = this.gameState.getEntity(sourceBuildingId);
        const destBuilding = this.gameState.getEntity(destBuildingId);

        if (!sourceBuilding || !destBuilding) {
            return null;
        }

        // Get player from destination building (the one requesting)
        const playerId = destBuilding.player;

        // Find taverns that can serve both buildings
        const carrierManager = this.carrierSystem.getCarrierManager();

        // Get all idle carriers for this player
        for (const carrier of carrierManager.getAllCarriers()) {
            // Must be able to accept new jobs (not exhausted/collapsed)
            if (!canAcceptNewJob(carrier.fatigue)) {
                continue;
            }

            // Carrier must not already have a job
            if (carrier.currentJob !== null) {
                continue;
            }

            // Carrier's home building (tavern) must be in service area that covers both buildings
            const homeBuilding = this.gameState.getEntity(carrier.homeBuilding);
            if (!homeBuilding || homeBuilding.player !== playerId) {
                continue;
            }

            // Check if this carrier's tavern can serve both locations
            const serviceArea = this.serviceAreaManager.getServiceArea(carrier.homeBuilding);
            if (!serviceArea) {
                continue;
            }

            // Simple distance check - both buildings should be within service radius
            const toSource = this.hexDistance(
                serviceArea.centerX, serviceArea.centerY,
                sourceBuilding.x, sourceBuilding.y,
            );
            const toDest = this.hexDistance(
                serviceArea.centerX, serviceArea.centerY,
                destBuilding.x, destBuilding.y,
            );

            if (toSource <= serviceArea.radius && toDest <= serviceArea.radius) {
                return { entityId: carrier.entityId };
            }
        }

        return null;
    }

    /**
     * Get the player ID for a building's request.
     */
    private getRequestPlayerId(buildingId: number): number {
        const building = this.gameState.getEntity(buildingId);
        return building?.player ?? 0;
    }

    /**
     * Simple hex distance calculation.
     */
    private hexDistance(x1: number, y1: number, x2: number, y2: number): number {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        return Math.max(dx, dy, Math.abs(dx - dy));
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
     * Clean up when a building is destroyed.
     * Cancels requests to/from the building and releases reservations.
     *
     * @param buildingId Entity ID of the destroyed building
     */
    handleBuildingDestroyed(buildingId: number): void {
        // Cancel all requests TO this building (it can no longer receive materials)
        this.requestManager.cancelRequestsForBuilding(buildingId);

        // Reset requests FROM this building (carriers can't pick up from it anymore)
        this.requestManager.resetRequestsFromSource(buildingId);

        // Release any reservations at this building
        this.reservationManager.releaseReservationsForBuilding(buildingId);

        // Find and remove any carrier-to-request mappings for carriers
        // that were assigned to this building's requests
        for (const [carrierId, requestId] of this.carrierToRequest.entries()) {
            const request = this.requestManager.getRequest(requestId);
            if (request && (request.buildingId === buildingId || request.sourceBuilding === buildingId)) {
                this.carrierToRequest.delete(carrierId);
            }
        }
    }
}
