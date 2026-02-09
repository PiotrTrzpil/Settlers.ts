/**
 * CarrierSystem - Tick system for carrier state updates and behavior.
 *
 * Responsibilities:
 * - Fatigue recovery for idle/resting carriers
 * - Movement coordination via CarrierMovementController
 * - Animation timing via CarrierAnimationController
 * - Arrival detection and job completion via job-completion handlers
 * - Movement triggers after job transitions
 *
 * This system orchestrates carrier behavior by delegating to:
 * - CarrierManager: State management
 * - CarrierMovementController: Movement commands and pending movement tracking
 * - CarrierAnimationController: Animation states and timing
 * - job-completion handlers: Inventory transfers and state transitions
 */

import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus, type CarrierState, type CarrierJob } from './carrier-state';
import { CarrierMovementController, type MovementStartResult } from './carrier-movement';
import { CarrierAnimationController } from './carrier-animation';
import { EMaterialType } from '../../economy';
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

/** Fatigue added per delivery cycle */
const FATIGUE_PER_DELIVERY = 5;

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
 *
 * Responsibilities:
 * - Fatigue recovery for idle/resting carriers
 * - Movement command coordination
 * - Animation state updates and timing
 * - Arrival event handling
 * - Job completion processing
 */
export class CarrierSystem implements TickSystem {
    private readonly carrierManager: CarrierManager;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly gameState: GameState;
    private readonly movementController: CarrierMovementController;
    private readonly animationController: CarrierAnimationController;

    private eventBus: EventBus | undefined;

    /** Current simulation time in milliseconds (for animation timing) */
    private currentTimeMs: number = 0;

    /** Maps carrier entity ID to their pending delivery destination */
    private readonly pendingDeliveries: Map<number, number> = new Map();

    /** Handler references for unsubscribing */
    private movementStoppedHandler: ((payload: { entityId: number; direction: number }) => void) | undefined;
    private carrierRemovedHandler: ((payload: { entityId: number; homeBuilding: number; hadActiveJob: boolean }) => void) | undefined;

    constructor(config: CarrierSystemConfig) {
        this.carrierManager = config.carrierManager;
        this.inventoryManager = config.inventoryManager;
        this.gameState = config.gameState;
        this.movementController = new CarrierMovementController(this.carrierManager);
        this.animationController = new CarrierAnimationController();
    }

    /**
     * Register event bus for emitting carrier system events.
     * Also registers for movement events to detect arrival.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);

        // Listen for movement stopped events to handle arrivals
        this.movementStoppedHandler = (payload) => {
            this.handleMovementStopped(payload.entityId);
        };
        eventBus.on('unit:movementStopped', this.movementStoppedHandler);

        // Listen for carrier removal to cleanup pending state
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
            if (this.movementStoppedHandler) {
                this.eventBus.off('unit:movementStopped', this.movementStoppedHandler);
                this.movementStoppedHandler = undefined;
            }
            if (this.carrierRemovedHandler) {
                this.eventBus.off('carrier:removed', this.carrierRemovedHandler);
                this.carrierRemovedHandler = undefined;
            }
        }
    }

    /**
     * Called each game tick.
     * Updates carrier fatigue, animation timers, and state transitions.
     */
    tick(dt: number): void {
        // Update simulation time
        this.currentTimeMs += dt * 1000;

        // Update fatigue for all carriers
        for (const carrier of this.carrierManager.getAllCarriers()) {
            this.updateFatigue(carrier.entityId, carrier.status, dt);
        }

        // Process animation completions
        this.processAnimationCompletions();
    }

    // === Arrival and Movement Handling ===

    /**
     * Handle when a unit stops moving.
     * Check if it's a carrier that arrived at a destination.
     */
    private handleMovementStopped(entityId: number): void {
        // Check if this entity is a carrier with a pending movement
        const pendingMovement = this.movementController.getPendingMovement(entityId);
        if (!pendingMovement) return;

        const carrier = this.carrierManager.getCarrier(entityId);
        if (!carrier) {
            this.movementController.clearPendingMovement(entityId);
            return;
        }

        // Validate that target building still exists
        const targetBuilding = this.gameState.getEntity(pendingMovement.targetBuildingId);
        if (!targetBuilding && pendingMovement.movementType !== 'return_home') {
            // Building was destroyed mid-transit - return home
            this.movementController.clearPendingMovement(entityId);
            this.handleTargetDestroyed(carrier);
            return;
        }

        // For return_home, check home building exists
        if (pendingMovement.movementType === 'return_home') {
            const homeBuilding = this.gameState.getEntity(carrier.homeBuilding);
            if (!homeBuilding) {
                // Home was destroyed - carrier is orphaned
                this.movementController.clearPendingMovement(entityId);
                this.carrierManager.setStatus(entityId, CarrierStatus.Idle);
                return;
            }
        }

        // Handle based on movement type
        switch (pendingMovement.movementType) {
        case 'pickup':
            this.handlePickupArrival(carrier, pendingMovement.targetBuildingId);
            break;
        case 'deliver':
            this.handleDeliveryArrival(carrier, pendingMovement.targetBuildingId);
            break;
        case 'return_home':
            this.handleReturnHomeArrival(carrier);
            break;
        }

        // Clear the pending movement
        this.movementController.clearPendingMovement(entityId);
    }

    /**
     * Handle case where target building was destroyed while carrier was in transit.
     */
    private handleTargetDestroyed(carrier: CarrierState): void {
        // Cancel current job
        this.carrierManager.completeJob(carrier.entityId);

        // Clear pending delivery
        this.pendingDeliveries.delete(carrier.entityId);

        // If carrying materials, they're lost
        if (carrier.carryingMaterial !== null) {
            this.carrierManager.setCarrying(carrier.entityId, null, 0);
            this.animationController.clearCarryingAnimation(carrier.entityId, this.gameState);
        }

        // Return home
        this.startReturnHome(carrier.entityId);
    }

    /**
     * Handle carrier removed event.
     * Clean up any pending state for this carrier.
     */
    private handleCarrierRemoved(entityId: number): void {
        this.movementController.clearPendingMovement(entityId);
        this.animationController.clearAnimationTimer(entityId);
        this.pendingDeliveries.delete(entityId);
    }

    // === Arrival Handlers ===

    /**
     * Handle carrier arriving at a building for pickup.
     */
    private handlePickupArrival(carrier: CarrierState, buildingId: number): void {
        // Validate job state matches
        if (!carrier.currentJob || carrier.currentJob.type !== 'pickup') {
            this.startReturnHome(carrier.entityId);
            return;
        }

        // Set status to picking up
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.PickingUp);

        // Start pickup animation
        this.animationController.playPickupAnimation(
            carrier.entityId,
            this.gameState,
            this.currentTimeMs,
        );

        // Emit arrival event
        this.eventBus?.emit('carrier:arrivedForPickup', {
            entityId: carrier.entityId,
            buildingId,
        });
    }

    /**
     * Handle carrier arriving at a building for delivery.
     */
    private handleDeliveryArrival(carrier: CarrierState, buildingId: number): void {
        // Validate job state matches
        if (!carrier.currentJob || carrier.currentJob.type !== 'deliver') {
            this.startReturnHome(carrier.entityId);
            return;
        }

        // Set status to delivering
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Delivering);

        // Start drop animation
        this.animationController.playDropAnimation(
            carrier.entityId,
            this.gameState,
            this.currentTimeMs,
        );

        // Emit arrival event
        this.eventBus?.emit('carrier:arrivedForDelivery', {
            entityId: carrier.entityId,
            buildingId,
        });
    }

    /**
     * Handle carrier arriving at their home tavern.
     */
    private handleReturnHomeArrival(carrier: CarrierState): void {
        // Use the job-completion handler for return home
        handleReturnHomeCompletion(carrier, this.carrierManager, this.eventBus);

        // Set to resting if fatigued, otherwise idle
        if (carrier.fatigue > 50) {
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Resting);
        }

        // Clear carrying animation (in case we were carrying something)
        this.animationController.clearCarryingAnimation(carrier.entityId, this.gameState);

        // Emit arrival event
        this.eventBus?.emit('carrier:arrivedHome', {
            entityId: carrier.entityId,
            homeBuilding: carrier.homeBuilding,
        });
    }

    // === Animation Completion Handling ===

    /**
     * Process animation completions for carriers in pickup/delivery states.
     */
    private processAnimationCompletions(): void {
        const carriersWithAnimations = [...this.animationController.getCarriersWithActiveAnimations()];

        for (const carrierId of carriersWithAnimations) {
            if (this.animationController.isAnimationComplete(carrierId, this.currentTimeMs)) {
                this.completeAnimation(carrierId);
            }
        }
    }

    /**
     * Complete an animation and transition to next state.
     */
    private completeAnimation(carrierId: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) {
            this.animationController.clearAnimationTimer(carrierId);
            return;
        }

        const animationType = this.animationController.getActiveAnimationType(carrierId);
        this.animationController.clearAnimationTimer(carrierId);

        if (animationType === 'pickup') {
            this.completePickup(carrier);
        } else if (animationType === 'drop') {
            this.completeDelivery(carrier);
        }
    }

    /**
     * Complete the pickup action - transfer material and start delivery.
     */
    private completePickup(carrier: CarrierState): void {
        const job = carrier.currentJob;
        if (!job || job.type !== 'pickup') {
            this.startReturnHome(carrier.entityId);
            return;
        }

        // Get the destination for this delivery
        const destinationId = this.pendingDeliveries.get(carrier.entityId);
        if (destinationId === undefined) {
            console.warn(`CarrierSystem: No pending delivery destination for carrier ${carrier.entityId}`);
            this.carrierManager.completeJob(carrier.entityId);
            this.startReturnHome(carrier.entityId);
            return;
        }

        // Use job-completion handler for the material transfer
        const result = handlePickupCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager,
            destinationId,
            this.eventBus,
        );

        if (result.success && result.nextJob) {
            // Set carrying animation
            this.animationController.setCarryingAnimation(
                carrier.entityId,
                job.material,
                this.gameState,
            );

            // Assign deliver job and start movement
            this.handleJobTransition(carrier.entityId, result, destinationId);
        } else {
            // Pickup failed - return home
            this.pendingDeliveries.delete(carrier.entityId);
            this.startReturnHome(carrier.entityId);
        }
    }

    /**
     * Complete the delivery action - transfer material and return home.
     */
    private completeDelivery(carrier: CarrierState): void {
        const job = carrier.currentJob;
        if (!job || job.type !== 'deliver') {
            this.startReturnHome(carrier.entityId);
            return;
        }

        // Clear pending delivery since we're now delivering
        this.pendingDeliveries.delete(carrier.entityId);

        // Use job-completion handler for the material transfer
        const result = handleDeliveryCompletion(
            carrier,
            this.carrierManager,
            this.inventoryManager,
            this.eventBus,
        );

        // Clear carrying animation
        this.animationController.clearCarryingAnimation(carrier.entityId, this.gameState);

        // Add fatigue from the delivery
        this.carrierManager.addFatigue(carrier.entityId, FATIGUE_PER_DELIVERY);

        // Handle the job transition (return home)
        if (result.nextJob) {
            this.handleJobTransition(carrier.entityId, result, carrier.homeBuilding);
        } else {
            // No next job means go idle
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Idle);
        }
    }

    // === Job Transition Handling ===

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
            // Assign the next job
            this.forceAssignJob(carrierId, result.nextJob);

            // Start movement to next destination
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
            const moveSuccess = this.startMovementToBuilding(carrierId, nextDestination, result.nextJob.type as 'deliver' | 'return_home');

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
            this.carrierManager.setCarrying(carrierId, null, 0);
            this.animationController.clearCarryingAnimation(carrierId, this.gameState);
        }

        // Start return home
        this.startReturnHome(carrierId);
    }

    /**
     * Start movement to return home.
     */
    private startReturnHome(carrierId: number): void {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Assign return_home job if not already assigned
        if (!carrier.currentJob || carrier.currentJob.type !== 'return_home') {
            this.forceAssignJob(carrierId, { type: 'return_home' });
        }

        // Start movement
        const result = this.movementController.startReturnMovement(carrierId, this.gameState);

        if (!result.success) {
            // Can't path home - just set idle
            this.carrierManager.completeJob(carrierId);
            this.carrierManager.setStatus(carrierId, CarrierStatus.Idle);
        }
    }

    /**
     * Start carrier movement to a building.
     * Returns true if movement started successfully, false if path failed.
     */
    private startMovementToBuilding(
        carrierId: number,
        buildingId: number,
        movementType: 'pickup' | 'deliver' | 'return_home',
    ): boolean {
        let result: MovementStartResult;

        switch (movementType) {
        case 'pickup':
            result = this.movementController.startPickupMovement(carrierId, buildingId, this.gameState);
            break;
        case 'deliver':
            result = this.movementController.startDeliveryMovement(carrierId, buildingId, this.gameState);
            break;
        case 'return_home':
            result = this.movementController.startReturnMovement(carrierId, this.gameState);
            break;
        default:
            return false;
        }

        if (!result.success) {
            console.warn(`CarrierSystem: Movement failed for carrier ${carrierId}: ${result.failureReason}`);
        }

        return result.success;
    }

    // === Fatigue Management ===

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

    // === Public API ===

    /**
     * Assign a delivery job to a carrier.
     * This is the main API for external systems (like the logistics system) to assign jobs.
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

        // Store the delivery destination for after pickup completes
        this.pendingDeliveries.set(carrierId, toBuildingId);

        // Start movement to source building
        const moveSuccess = this.startMovementToBuilding(carrierId, fromBuildingId, 'pickup');

        if (!moveSuccess) {
            // Rollback job assignment
            this.carrierManager.completeJob(carrierId);
            this.pendingDeliveries.delete(carrierId);
            return false;
        }

        return true;
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
     * Start a pickup movement for a carrier.
     * Lower-level API for systems that manage their own job assignment.
     *
     * @returns Result with success flag and failure reason
     */
    startPickup(carrierId: number, buildingId: number): MovementStartResult {
        return this.movementController.startPickupMovement(carrierId, buildingId, this.gameState);
    }

    /**
     * Start a delivery movement for a carrier.
     * Lower-level API for systems that manage their own job assignment.
     *
     * @returns Result with success flag and failure reason
     */
    startDelivery(carrierId: number, buildingId: number): MovementStartResult {
        return this.movementController.startDeliveryMovement(carrierId, buildingId, this.gameState);
    }

    /**
     * Cancel any pending movement for a carrier.
     * Call this when a job is cancelled while carrier is in transit.
     *
     * @returns true if a pending movement was cancelled
     */
    cancelCarrierMovement(carrierId: number): boolean {
        return this.movementController.cancelMovement(carrierId);
    }

    /**
     * Get the carrier manager for external access.
     */
    getCarrierManager(): CarrierManager {
        return this.carrierManager;
    }

    /**
     * Get the movement controller for debugging/testing.
     */
    getMovementController(): CarrierMovementController {
        return this.movementController;
    }

    /**
     * Get the animation controller for debugging/testing.
     */
    getAnimationController(): CarrierAnimationController {
        return this.animationController;
    }
}
