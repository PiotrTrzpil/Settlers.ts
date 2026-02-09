/**
 * CarrierSystem - Tick system for carrier state updates.
 *
 * Responsibilities:
 * - Fatigue recovery for idle/resting carriers
 * - Arrival detection and job completion
 * - Movement triggers after job transitions
 *
 * This system coordinates carrier behavior but delegates:
 * - State management to CarrierManager
 * - Job completion logic to job-completion handlers
 * - Movement to MovementSystem
 */

import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus, type CarrierState, type CarrierJob } from './carrier-state';
import { EMaterialType } from '../../economy';
import { hexDistance } from '../../systems/hex-directions';
import {
    handlePickupCompletion,
    handleDeliveryCompletion,
    handleReturnHomeCompletion,
    type JobCompletionResult,
} from './job-completion';

/** Fatigue recovery rate per second when resting at home tavern */
const FATIGUE_RECOVERY_RATE = 10;

/** Fatigue recovery rate per second when idle (not actively resting) */
const IDLE_RECOVERY_RATE = 5;

/** Fatigue gained per tile moved while carrying goods */
const FATIGUE_PER_TILE_CARRYING = 0.5;

/** Fatigue gained per tile moved while empty */
const FATIGUE_PER_TILE_EMPTY = 0.2;

/** Maximum hex distance to consider carrier "at" a building */
const ARRIVAL_DISTANCE = 1;

/**
 * Configuration for CarrierSystem dependencies.
 */
export interface CarrierSystemConfig {
    carrierManager: CarrierManager;
    inventoryManager: BuildingInventoryManager;
    gameState: GameState;
}

/**
 * System that manages carrier behavior each tick.
 */
export class CarrierSystem implements TickSystem {
    private readonly carrierManager: CarrierManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly gameState: GameState;
    private eventBus: EventBus | undefined;

    /** Maps carrier entity ID to their pending delivery destination */
    private readonly pendingDeliveries: Map<number, number> = new Map();

    /** Carriers that have arrived and need job completion processed */
    private readonly arrivedCarriers: Set<number> = new Set();

    /** Bound event handler for cleanup */
    private boundHandleMovementStopped: ((payload: { entityId: number; direction: number }) => void) | undefined;
    private boundHandleCarrierRemoved: ((payload: { entityId: number; homeBuilding: number; hadActiveJob: boolean }) => void) | undefined;

    constructor(config: CarrierSystemConfig) {
        this.carrierManager = config.carrierManager;
        this.inventoryManager = config.inventoryManager;
        this.gameState = config.gameState;
    }

    /**
     * Register event bus for emitting carrier system events.
     * Also registers for movement events to detect arrival.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);

        // Bind handlers for later cleanup
        this.boundHandleMovementStopped = this.handleMovementStopped.bind(this);
        this.boundHandleCarrierRemoved = this.handleCarrierRemoved.bind(this);

        // Listen for events
        eventBus.on('unit:movementStopped', this.boundHandleMovementStopped);
        eventBus.on('carrier:removed', this.boundHandleCarrierRemoved);
    }

    /**
     * Unregister event handlers. Call this when disposing the system.
     */
    unregisterEvents(): void {
        if (this.eventBus && this.boundHandleMovementStopped) {
            this.eventBus.off('unit:movementStopped', this.boundHandleMovementStopped);
        }
        if (this.eventBus && this.boundHandleCarrierRemoved) {
            this.eventBus.off('carrier:removed', this.boundHandleCarrierRemoved);
        }
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
     * Handle carrier removed event.
     * Clean up any pending state for this carrier.
     */
    private handleCarrierRemoved(payload: { entityId: number; homeBuilding: number; hadActiveJob: boolean }): void {
        this.pendingDeliveries.delete(payload.entityId);
        this.arrivedCarriers.delete(payload.entityId);
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
            } else {
                // Carrier stopped but not at destination - might have been blocked
                // Could retry pathfinding here, but for now just log
                console.warn(`CarrierSystem: Carrier ${carrierId} stopped but not at destination`);
            }
        }

        this.arrivedCarriers.clear();
    }

    /**
     * Check if carrier has arrived at their job's destination.
     * Uses hex distance for proper grid-based calculation.
     */
    private isAtJobDestination(carrier: CarrierState): boolean {
        const carrierEntity = this.gameState.getEntity(carrier.entityId);
        if (!carrierEntity) return false;

        const job = carrier.currentJob;
        if (!job) return false;

        const targetBuildingId = this.getJobTargetBuilding(job, carrier);
        if (targetBuildingId === undefined) return false;

        const targetBuilding = this.gameState.getEntity(targetBuildingId);
        if (!targetBuilding) {
            // Building was destroyed - this will be handled in processJobArrival
            return true; // Return true to trigger processing which will handle the error
        }

        // Use hex distance for proper grid calculation
        const distance = hexDistance(
            carrierEntity.x,
            carrierEntity.y,
            targetBuilding.x,
            targetBuilding.y,
        );

        return distance <= ARRIVAL_DISTANCE;
    }

    /**
     * Get the target building ID for a job.
     */
    private getJobTargetBuilding(job: CarrierJob, carrier: CarrierState): number | undefined {
        switch (job.type) {
        case 'pickup':
            return job.fromBuilding;
        case 'deliver':
            return job.toBuilding;
        case 'return_home':
            return carrier.homeBuilding;
        default:
            return undefined;
        }
    }

    /**
     * Process a carrier's arrival at their job destination.
     */
    private processJobArrival(carrier: CarrierState): void {
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
            this.cancelJobAndReturnHome(carrier.entityId);
            return;
        }

        // Handle pickup completion
        const result = handlePickupCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager,
            destinationId,
            this.eventBus,
        );

        // Assign the next job and continue
        this.handleJobTransition(carrier.entityId, result, destinationId);
    }

    /**
     * Process carrier arrival at delivery location.
     */
    private processDeliveryArrival(carrier: CarrierState): void {
        // Update status to Delivering
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Delivering);

        // Clear pending delivery since we're now delivering
        this.pendingDeliveries.delete(carrier.entityId);

        // Handle delivery completion
        const result = handleDeliveryCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager,
            this.eventBus,
        );

        // Assign the next job and continue
        this.handleJobTransition(carrier.entityId, result, carrier.homeBuilding);
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
     * Handle job transition - assign next job and start movement.
     */
    private handleJobTransition(
        carrierId: number,
        result: JobCompletionResult,
        nextDestination: number,
    ): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        if (result.nextJob) {
            // Assign the next job through the manager
            // Note: We need to bypass canAssignJobTo since carrier is mid-transition
            this.forceAssignJob(carrierId, result.nextJob);

            // Start movement to next destination
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
            const moveSuccess = this.startMovementToBuilding(carrierId, nextDestination);

            if (!moveSuccess) {
                // Path failed - cancel and return home if not already
                if (result.nextJob.type !== 'return_home') {
                    this.cancelJobAndReturnHome(carrierId);
                } else {
                    // Can't even return home - just idle
                    this.carrierManager.completeJob(carrierId);
                    this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
                }
            }
        }
    }

    /**
     * Force assign a job to a carrier, bypassing the availability check.
     * Used during job transitions when carrier is not in Idle state.
     */
    private forceAssignJob(carrierId: number, job: CarrierJob): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Directly set the job since we're in a controlled transition
        carrier.currentJob = job;

        // Emit event for consistency
        this.eventBus?.emit('carrier:jobAssigned', { entityId: carrierId, job });
    }

    /**
     * Cancel current job and create a return_home job.
     */
    private cancelJobAndReturnHome(carrierId: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Complete any existing job
        this.carrierManager.completeJob(carrierId);

        // Clear pending delivery
        this.pendingDeliveries.delete(carrierId);

        // Clear any carried materials (goods are lost)
        if (carrier.carryingMaterial !== null) {
            // TODO: Could drop goods on ground instead of losing them
            this.carrierManager.setCarrying(carrierId, null, 0);
        }

        // Create return_home job
        this.forceAssignJob(carrierId, { type: 'return_home' });
        this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);

        const moveSuccess = this.startMovementToBuilding(carrierId, carrier.homeBuilding);
        if (!moveSuccess) {
            // Can't even return home - just idle
            this.carrierManager.completeJob(carrierId);
            this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
        }
    }

    /**
     * Start carrier movement to a building.
     * Returns true if movement started successfully, false if path failed.
     */
    private startMovementToBuilding(carrierId: number, buildingId: number): boolean {
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            console.warn(`CarrierSystem: Cannot find building ${buildingId} for movement`);
            return false;
        }

        // Move to the building's position
        // Note: In a full implementation, we'd find an approach tile adjacent to the building
        const success = this.gameState.movement.moveUnit(carrierId, building.x, building.y);

        if (!success) {
            console.warn(`CarrierSystem: Path finding failed for carrier ${carrierId} to building ${buildingId}`);
        }

        return success;
    }

    /**
     * Register a pending delivery for a carrier.
     * Called when assigning a pickup job to specify where to deliver after pickup.
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
     * Assign a delivery job to a carrier.
     * This is the main API for external systems to assign jobs.
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
        material: EMaterialType,
        amount: number,
    ): boolean {
        // Validate buildings exist
        if (!this.gameState.getEntity(fromBuildingId)) {
            console.warn(`CarrierSystem: Source building ${fromBuildingId} not found`);
            return false;
        }
        if (!this.gameState.getEntity(toBuildingId)) {
            console.warn(`CarrierSystem: Destination building ${toBuildingId} not found`);
            return false;
        }

        // Assign pickup job through manager (validates carrier availability)
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
        const moveSuccess = this.startMovementToBuilding(carrierId, fromBuildingId);

        if (!moveSuccess) {
            // Rollback job assignment
            this.carrierManager.completeJob(carrierId);
            this.clearPendingDelivery(carrierId);
            this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
            return false;
        }

        return true;
    }

    /**
     * Update fatigue based on carrier status.
     */
    private updateFatigue(carrierId: number, status: CarrierStatus, dt: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        if (status === CarrierStatus.Resting) {
            const recovery = FATIGUE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrierId, newFatigue);

            if (newFatigue === 0) {
                this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
            }
        } else if (status === CarrierStatus.Idle && carrier.fatigue > 0) {
            const recovery = IDLE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrierId, newFatigue);
        }
    }

    /**
     * Add fatigue to a carrier when they complete a movement step.
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
