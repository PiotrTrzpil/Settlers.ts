/**
 * CarrierSystem - Tick system for carrier state updates.
 *
 * Handles:
 * - Fatigue recovery for idle/resting carriers at their home tavern
 * - Movement arrival handling and state transitions
 * - Animation timing for pickup/drop actions
 * - Movement commands triggered by job states
 */

import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus, type CarrierState } from './carrier-state';
import { CarrierMovementController } from './carrier-movement';
import { CarrierAnimationController } from './carrier-animation';

/** Fatigue recovery rate per second when resting at home tavern */
const FATIGUE_RECOVERY_RATE = 10;

/** Fatigue recovery rate per second when idle (not actively resting) */
const IDLE_RECOVERY_RATE = 5;

/** Fatigue added per delivery cycle */
const FATIGUE_PER_DELIVERY = 5;

/**
 * System that manages carrier behavior each tick.
 *
 * Responsibilities:
 * - Fatigue recovery for idle/resting carriers
 * - Movement command coordination
 * - Animation state updates and timing
 * - Arrival event handling
 */
export class CarrierSystem implements TickSystem {
    private carrierManager: CarrierManager;
    private movementController: CarrierMovementController;
    private animationController: CarrierAnimationController;
    private eventBus: EventBus | undefined;
    private gameState: GameState | undefined;

    /** Current simulation time in milliseconds (for animation timing) */
    private currentTimeMs: number = 0;

    /** Handler reference for unsubscribing */
    private movementStoppedHandler: ((payload: { entityId: number; direction: number }) => void) | undefined;

    constructor(carrierManager: CarrierManager) {
        this.carrierManager = carrierManager;
        this.movementController = new CarrierMovementController(carrierManager);
        this.animationController = new CarrierAnimationController();
    }

    /**
     * Set the game state reference for movement commands.
     */
    setGameState(gameState: GameState): void {
        this.gameState = gameState;
    }

    /**
     * Register event bus for emitting carrier system events.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);

        // Listen for movement stopped events to handle arrivals
        this.movementStoppedHandler = (payload) => {
            this.handleMovementStopped(payload.entityId);
        };
        eventBus.on('unit:movementStopped', this.movementStoppedHandler);
    }

    /**
     * Unregister event handlers.
     */
    unregisterEvents(): void {
        if (this.eventBus && this.movementStoppedHandler) {
            this.eventBus.off('unit:movementStopped', this.movementStoppedHandler);
            this.movementStoppedHandler = undefined;
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
     * Handle carrier arriving at a building for pickup.
     */
    private handlePickupArrival(carrier: CarrierState, buildingId: number): void {
        // Set status to picking up
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.PickingUp);

        // Start pickup animation
        if (this.gameState) {
            this.animationController.playPickupAnimation(
                carrier.entityId,
                this.gameState,
                this.currentTimeMs,
            );
        }

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
        // Set status to delivering
        this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Delivering);

        // Start drop animation
        if (this.gameState) {
            this.animationController.playDropAnimation(
                carrier.entityId,
                this.gameState,
                this.currentTimeMs,
            );
        }

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
        // Complete the return_home job
        this.carrierManager.completeJob(carrier.entityId);

        // Set to idle (or resting if fatigued)
        if (carrier.fatigue > 50) {
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Resting);
        } else {
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Idle);
        }

        // Clear carrying animation
        if (this.gameState) {
            this.animationController.clearCarryingAnimation(carrier.entityId, this.gameState);
        }

        // Emit arrival event
        this.eventBus?.emit('carrier:arrivedHome', {
            entityId: carrier.entityId,
            homeBuilding: carrier.homeBuilding,
        });
    }

    /**
     * Process animation completions for carriers in pickup/delivery states.
     */
    private processAnimationCompletions(): void {
        for (const carrierId of this.animationController.getCarriersWithActiveAnimations()) {
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
        if (!carrier || !this.gameState) {
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
     * Complete the pickup action - transfer material and start delivery movement.
     */
    private completePickup(carrier: CarrierState): void {
        const job = carrier.currentJob;
        if (!job || job.type !== 'pickup' || !this.gameState) return;

        // Transfer material from building to carrier
        const withdrawResult = this.gameState.inventoryManager.withdrawOutput(
            job.fromBuilding,
            job.material,
            job.amount,
        );

        if (withdrawResult > 0) {
            // Set carrier as carrying the material
            this.carrierManager.setCarrying(carrier.entityId, job.material, withdrawResult);

            // Set carrying animation
            this.animationController.setCarryingAnimation(
                carrier.entityId,
                job.material,
                this.gameState,
            );

            // Emit pickup complete event
            this.eventBus?.emit('carrier:pickupComplete', {
                entityId: carrier.entityId,
                buildingId: job.fromBuilding,
                material: job.material,
                amount: withdrawResult,
            });

            // Complete pickup job
            this.carrierManager.completeJob(carrier.entityId);

            // Note: The job assignment system (Wave 2B) should then assign
            // a deliver job to this carrier. For now, the carrier goes idle.
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Idle);
        } else {
            // Material not available - job fails, return home
            this.carrierManager.completeJob(carrier.entityId);
            this.startReturnHome(carrier.entityId);
        }
    }

    /**
     * Complete the delivery action - transfer material and decide next action.
     */
    private completeDelivery(carrier: CarrierState): void {
        const job = carrier.currentJob;
        if (!job || job.type !== 'deliver' || !this.gameState) return;

        // Transfer material from carrier to building
        const depositResult = this.gameState.inventoryManager.depositInput(
            job.toBuilding,
            job.material,
            carrier.carryingAmount,
        );

        // Clear carrier's carrying state
        const deliveredAmount = carrier.carryingAmount - depositResult;
        this.carrierManager.setCarrying(carrier.entityId, null, 0);

        // Clear carrying animation
        this.animationController.clearCarryingAnimation(carrier.entityId, this.gameState);

        // Emit delivery complete event
        this.eventBus?.emit('carrier:deliveryComplete', {
            entityId: carrier.entityId,
            buildingId: job.toBuilding,
            material: job.material,
            amount: deliveredAmount,
        });

        // Complete delivery job
        this.carrierManager.completeJob(carrier.entityId);

        // Add fatigue from the delivery
        this.carrierManager.addFatigue(carrier.entityId, FATIGUE_PER_DELIVERY);

        // Return home
        this.startReturnHome(carrier.entityId);
    }

    /**
     * Start movement to return home.
     */
    private startReturnHome(carrierId: number): void {
        if (!this.gameState) return;

        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return;

        // Assign return_home job
        this.carrierManager.assignJob(carrierId, { type: 'return_home' });

        // Start movement
        this.movementController.startReturnMovement(carrierId, this.gameState);
    }

    // === Public API for job execution (called by Wave 2B job assignment) ===

    /**
     * Start a pickup movement for a carrier.
     * Called by the job assignment system when a pickup job is assigned.
     */
    startPickup(carrierId: number, buildingId: number): boolean {
        if (!this.gameState) return false;
        return this.movementController.startPickupMovement(carrierId, buildingId, this.gameState);
    }

    /**
     * Start a delivery movement for a carrier.
     * Called by the job assignment system when a deliver job is assigned.
     */
    startDelivery(carrierId: number, buildingId: number): boolean {
        if (!this.gameState) return false;
        return this.movementController.startDeliveryMovement(carrierId, buildingId, this.gameState);
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
