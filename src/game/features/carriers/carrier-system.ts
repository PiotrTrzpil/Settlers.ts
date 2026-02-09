/**
 * CarrierSystem - Tick system for carrier state updates.
 *
 * Handles:
 * - Fatigue recovery for idle/resting carriers at their home tavern
 * - Future: Job assignment, movement triggers, animation states
 */

import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus } from './carrier-state';

/** Fatigue recovery rate per second when resting at home tavern */
const FATIGUE_RECOVERY_RATE = 10;

/** Fatigue recovery rate per second when idle (not actively resting) */
const IDLE_RECOVERY_RATE = 5;

/**
 * System that manages carrier behavior each tick.
 *
 * Current responsibilities:
 * - Fatigue recovery for idle/resting carriers
 *
 * Future responsibilities (Wave 2):
 * - Job assignment coordination
 * - Movement command triggers
 * - Animation state updates
 */
export class CarrierSystem implements TickSystem {
    private carrierManager: CarrierManager;
    private eventBus: EventBus | undefined;

    constructor(carrierManager: CarrierManager) {
        this.carrierManager = carrierManager;
    }

    /**
     * Register event bus for emitting carrier system events.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);
    }

    /**
     * Called each game tick.
     * Updates carrier fatigue recovery for idle/resting carriers.
     */
    tick(dt: number): void {
        // Update fatigue for all carriers
        for (const carrier of this.carrierManager.getAllCarriers()) {
            this.updateFatigue(carrier.entityId, carrier.status, dt);
        }
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
     * Get the carrier manager for external access.
     */
    getCarrierManager(): CarrierManager {
        return this.carrierManager;
    }
}
