/**
 * CarrierSystem - Tick system for carrier state updates.
 *
 * Handles:
 * - Fatigue recovery for idle/resting carriers at their home tavern
 * - Arrival detection and job completion
 * - Movement triggers after job transitions
 */

import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus, type CarrierState } from './carrier-state';
import {
    handlePickupCompletion,
    handleDeliveryCompletion,
    handleReturnHomeCompletion,
} from './job-completion';

/** Fatigue recovery rate per second when resting at home tavern */
const FATIGUE_RECOVERY_RATE = 10;

/** Fatigue recovery rate per second when idle (not actively resting) */
const IDLE_RECOVERY_RATE = 5;

/** Fatigue gained per tile moved while carrying goods */
const FATIGUE_PER_TILE_CARRYING = 0.5;

/** Fatigue gained per tile moved while empty */
const FATIGUE_PER_TILE_EMPTY = 0.2;

/**
 * Pending delivery info - tracks where a carrier should deliver after pickup.
 * This is set when a job is assigned and used when pickup completes.
 */
export interface PendingDelivery {
    /** Entity ID of the carrier */
    carrierId: number;
    /** Entity ID of the building to deliver to */
    destinationBuildingId: number;
}

/**
 * System that manages carrier behavior each tick.
 *
 * Responsibilities:
 * - Fatigue recovery for idle/resting carriers
 * - Job completion handling when carriers arrive at destinations
 * - Coordinating state transitions between job phases
 */
export class CarrierSystem implements TickSystem {
    private carrierManager: CarrierManager;
    private inventoryManager: BuildingInventoryManager | undefined;
    private gameState: GameState | undefined;
    private eventBus: EventBus | undefined;

    /** Maps carrier entity ID to their pending delivery destination */
    private pendingDeliveries: Map<number, number> = new Map();

    /** Carriers that have arrived and need job completion processed */
    private arrivedCarriers: Set<number> = new Set();

    constructor(carrierManager: CarrierManager) {
        this.carrierManager = carrierManager;
    }

    /**
     * Set dependencies needed for job completion.
     */
    setDependencies(inventoryManager: BuildingInventoryManager, gameState: GameState): void {
        this.inventoryManager = inventoryManager;
        this.gameState = gameState;
    }

    /**
     * Register event bus for emitting carrier system events.
     * Also registers for movement events to detect arrival.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);

        // Listen for unit movement stopped to detect carrier arrival
        eventBus.on('unit:movementStopped', this.handleMovementStopped.bind(this));
    }

    /**
     * Handle unit movement stopped event.
     * If it's a carrier with a job, queue for arrival processing.
     */
    private handleMovementStopped(payload: { entityId: number; direction: number }): void {
        const carrier = this.carrierManager.getCarrier(payload.entityId);
        if (!carrier) return; // Not a carrier

        // Only process if carrier has a job and is in Walking status
        if (carrier.currentJob && carrier.status === CarrierStatus.Walking) {
            this.arrivedCarriers.add(carrier.entityId);
        }
    }

    /**
     * Called each game tick.
     * Updates carrier fatigue and processes arrivals.
     */
    tick(dt: number): void {
        // Process arrived carriers first
        this.processArrivals();

        // Update fatigue for all carriers
        for (const carrier of this.carrierManager.getAllCarriers()) {
            this.updateFatigue(carrier.entityId, carrier.status, dt);
        }
    }

    /**
     * Process carriers that have arrived at their destinations.
     */
    private processArrivals(): void {
        if (this.arrivedCarriers.size === 0) return;

        for (const carrierId of this.arrivedCarriers) {
            const carrier = this.carrierManager.getCarrier(carrierId);
            if (!carrier || !carrier.currentJob) continue;

            // Verify carrier is at the correct destination
            if (this.isAtJobDestination(carrier)) {
                this.processJobArrival(carrier);
            }
        }

        this.arrivedCarriers.clear();
    }

    /**
     * Check if carrier has arrived at their job's destination.
     */
    private isAtJobDestination(carrier: CarrierState): boolean {
        if (!this.gameState) return false;

        const carrierEntity = this.gameState.getEntity(carrier.entityId);
        if (!carrierEntity) return false;

        const job = carrier.currentJob;
        if (!job) return false;

        let targetBuildingId: number;
        switch (job.type) {
        case 'pickup':
            targetBuildingId = job.fromBuilding;
            break;
        case 'deliver':
            targetBuildingId = job.toBuilding;
            break;
        case 'return_home':
            targetBuildingId = carrier.homeBuilding;
            break;
        default:
            return false;
        }

        const targetBuilding = this.gameState.getEntity(targetBuildingId);
        if (!targetBuilding) return false;

        // Check if carrier is adjacent to or at the building
        // For now, use simple distance check (within 2 tiles)
        const dx = Math.abs(carrierEntity.x - targetBuilding.x);
        const dy = Math.abs(carrierEntity.y - targetBuilding.y);
        return dx <= 1 && dy <= 1;
    }

    /**
     * Process a carrier's arrival at their job destination.
     */
    private processJobArrival(carrier: CarrierState): void {
        if (!this.inventoryManager) {
            console.warn('CarrierSystem: Cannot process arrival, inventoryManager not set');
            return;
        }

        const job = carrier.currentJob;
        if (!job) return;

        switch (job.type) {
        case 'pickup':
            this.processPickupArrival(carrier);
            break;
        case 'deliver':
            this.processDeliveryArrival(carrier);
            break;
        case 'return_home':
            this.processReturnHomeArrival(carrier);
            break;
        }
    }

    /**
     * Process carrier arrival at pickup location.
     */
    private processPickupArrival(carrier: CarrierState): void {
        // Update status to PickingUp
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.PickingUp);

        // Get the destination for this delivery
        const destinationId = this.pendingDeliveries.get(carrier.entityId);
        if (destinationId === undefined) {
            console.warn(`CarrierSystem: No pending delivery destination for carrier ${carrier.entityId}`);
            // Fall back to returning home
            this.cancelJobAndReturnHome(carrier.entityId);
            return;
        }

        // Handle pickup completion (withdraws from building, creates deliver job)
        const result = handlePickupCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager!,
            destinationId,
            this.eventBus,
        );

        if (result.success && result.nextJob?.type === 'deliver') {
            // Start movement to delivery destination
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
            this.startMovementToBuilding(carrier.entityId, destinationId);
        } else {
            // Pickup failed, return home
            this.pendingDeliveries.delete(carrier.entityId);
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
            this.startMovementToBuilding(carrier.entityId, carrier.homeBuilding);
        }
    }

    /**
     * Process carrier arrival at delivery location.
     */
    private processDeliveryArrival(carrier: CarrierState): void {
        // Update status to Delivering
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Delivering);

        // Clear pending delivery since we're now delivering
        this.pendingDeliveries.delete(carrier.entityId);

        // Handle delivery completion (deposits to building, creates return_home job)
        const result = handleDeliveryCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager!,
            this.eventBus,
        );

        if (result.success && result.nextJob?.type === 'return_home') {
            // Start movement back to home tavern
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
            this.startMovementToBuilding(carrier.entityId, carrier.homeBuilding);
        }
    }

    /**
     * Process carrier arrival at home tavern.
     */
    private processReturnHomeArrival(carrier: CarrierState): void {
        // Handle return home completion (sets to idle)
        handleReturnHomeCompletion(carrier, this.carrierManager, this.eventBus);

        // Carrier is now idle and available for new jobs
    }

    /**
     * Cancel current job and create a return_home job.
     */
    private cancelJobAndReturnHome(carrierId: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Complete any existing job
        this.carrierManager.completeJob(carrierId);

        // Clear any carried materials
        this.carrierManager.setCarrying(carrierId, null, 0);

        // Create return_home job
        const carrierState = this.carrierManager.getCarrier(carrierId);
        if (carrierState) {
            carrierState.currentJob = { type: 'return_home' };
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
            this.startMovementToBuilding(carrierId, carrier.homeBuilding);
        }
    }

    /**
     * Start carrier movement to a building.
     * Uses the movement system to pathfind and move.
     */
    private startMovementToBuilding(carrierId: number, buildingId: number): void {
        if (!this.gameState) return;

        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            console.warn(`CarrierSystem: Cannot find building ${buildingId} for movement`);
            return;
        }

        // Move to the building's position
        // Note: In a full implementation, we'd find an approach tile adjacent to the building
        this.gameState.movement.moveUnit(carrierId, building.x, building.y);
    }

    /**
     * Register a pending delivery for a carrier.
     * Called when assigning a pickup job to specify where to deliver after pickup.
     *
     * @param carrierId Entity ID of the carrier
     * @param destinationBuildingId Entity ID of the building to deliver to
     */
    setPendingDelivery(carrierId: number, destinationBuildingId: number): void {
        this.pendingDeliveries.set(carrierId, destinationBuildingId);
    }

    /**
     * Get the pending delivery destination for a carrier.
     */
    getPendingDelivery(carrierId: number): number | undefined {
        return this.pendingDeliveries.get(carrierId);
    }

    /**
     * Clear pending delivery for a carrier (e.g., when job is cancelled).
     */
    clearPendingDelivery(carrierId: number): void {
        this.pendingDeliveries.delete(carrierId);
    }

    /**
     * Assign a job to a carrier and start movement to the pickup/target location.
     * This is a convenience method that handles the full job assignment flow.
     *
     * @param carrierId Entity ID of the carrier
     * @param fromBuildingId Entity ID of the building to pick up from
     * @param toBuildingId Entity ID of the building to deliver to
     * @param material Material type to transport
     * @param amount Amount to transport
     * @returns true if job was assigned successfully
     */
    assignDeliveryJob(
        carrierId: number,
        fromBuildingId: number,
        toBuildingId: number,
        material: number,
        amount: number,
    ): boolean {
        // Assign pickup job
        const success = this.carrierManager.assignJob(carrierId, {
            type: 'pickup',
            fromBuilding: fromBuildingId,
            material,
            amount,
        });

        if (!success) return false;

        // Store the delivery destination
        this.setPendingDelivery(carrierId, toBuildingId);

        // Set status to Walking and start movement
        this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        this.startMovementToBuilding(carrierId, fromBuildingId);

        return true;
    }

    /**
     * Update fatigue based on carrier status.
     * - Resting: Fast recovery
     * - Idle: Slow recovery
     * - Other states: No recovery (handled by movement/job systems)
     */
    private updateFatigue(carrierId: number, status: CarrierStatus, dt: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Only recover fatigue when idle or resting
        if (status === CarrierStatus.Resting) {
            const recovery = FATIGUE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrierId, newFatigue);

            // If fully recovered, transition to Idle
            if (newFatigue === 0) {
                this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
            }
        } else if (status === CarrierStatus.Idle && carrier.fatigue > 0) {
            // Slow passive recovery when idle
            const recovery = IDLE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrierId, newFatigue);
        }
    }

    /**
     * Add fatigue to a carrier when they complete a movement step.
     * Call this when the carrier moves one tile.
     */
    addMovementFatigue(carrierId: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        const fatigueGain = carrier.carryingMaterial !== null
            ? FATIGUE_PER_TILE_CARRYING
            : FATIGUE_PER_TILE_EMPTY;

        this.carrierManager.addFatigue(carrierId, fatigueGain);
    }

    /**
     * Get the carrier manager for external access.
     */
    getCarrierManager(): CarrierManager {
        return this.carrierManager;
    }
}
