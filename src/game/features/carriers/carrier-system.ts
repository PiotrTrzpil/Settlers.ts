/**
 * CarrierSystem - Tick system for carrier management.
 *
 * Responsibilities (after unification with SettlerTaskSystem):
 * - Fatigue recovery for idle/resting carriers
 * - Auto-registering spawned carriers with nearest hub
 * - Providing the public API for assigning delivery jobs
 *
 * Task execution (movement, animation, pickup, dropoff) is now handled by
 * SettlerTaskSystem using the YAML-defined carrier.transport job sequence.
 */

import type { TickSystem } from '../../tick-system';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { ServiceAreaManager } from '../service-areas';
import { CarrierManager } from './carrier-manager';
import { CarrierStatus, type CarrierState } from './carrier-state';
import { EMaterialType } from '../../economy';
import { UnitType } from '../../unit-types';
import { LogHandler } from '@/utilities/log-handler';
import type { AnimationService } from '../../animation/index';
import type { SettlerTaskSystem } from '../../systems/settler-tasks';

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
    serviceAreaManager: ServiceAreaManager;
    animationService: AnimationService;
}

/**
 * System that manages carrier registration and fatigue.
 *
 * Task execution is handled by SettlerTaskSystem.
 */
export class CarrierSystem implements TickSystem {
    private static log = new LogHandler('CarrierSystem');

    private readonly carrierManager: CarrierManager;
    private readonly gameState: GameState;
    private readonly serviceAreaManager: ServiceAreaManager;

    /** Event bus (MUST be set via registerEvents) */
    private eventBus!: EventBus;

    /** Reference to settler task system for assigning jobs (MUST be set via setSettlerTaskSystem) */
    private settlerTaskSystem!: SettlerTaskSystem;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: CarrierSystemConfig) {
        this.carrierManager = config.carrierManager;
        this.gameState = config.gameState;
        this.serviceAreaManager = config.serviceAreaManager;
    }

    /**
     * Set reference to SettlerTaskSystem (called after both systems are created).
     */
    setSettlerTaskSystem(system: SettlerTaskSystem): void {
        this.settlerTaskSystem = system;
    }

    /**
     * Register event bus for emitting carrier system events.
     * Also registers for carrier lifecycle events.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        this.carrierManager.registerEvents(eventBus);

        // Listen for unit spawned to auto-register carriers
        this.subscriptions.subscribe(eventBus, 'unit:spawned', (payload) => {
            this.handleUnitSpawned(payload);
        });

        // Listen for carrier removal to cleanup
        this.subscriptions.subscribe(eventBus, 'carrier:removed', (_payload) => {
            // No additional cleanup needed - SettlerTaskSystem handles task state
        });

        // Listen for delivery complete to add fatigue
        this.subscriptions.subscribe(eventBus, 'carrier:deliveryComplete', (payload) => {
            this.carrierManager.addFatigue(payload.entityId, FATIGUE_PER_DELIVERY);
        });
    }

    /**
     * Unregister event handlers.
     */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Called each game tick.
     * Updates carrier fatigue.
     */
    tick(dt: number): void {
        // Update fatigue for all carriers
        for (const carrier of this.carrierManager.getAllCarriers()) {
            this.updateFatigue(carrier, dt);
        }
    }

    // === Fatigue Management ===

    /**
     * Update fatigue based on carrier status.
     */
    private updateFatigue(carrier: CarrierState, dt: number): void {
        if (carrier.status === CarrierStatus.Resting) {
            const recovery = FATIGUE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrier.entityId, newFatigue);

            if (newFatigue === 0) {
                this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Idle);
            }
        } else if (carrier.status === CarrierStatus.Idle && carrier.fatigue > 0) {
            const recovery = IDLE_RECOVERY_RATE * dt;
            const newFatigue = Math.max(0, carrier.fatigue - recovery);
            this.carrierManager.setFatigue(carrier.entityId, newFatigue);
        }
    }

    // === Unit Spawning ===

    /**
     * Handle unit spawned event.
     * If it's a carrier, register it with the nearest hub.
     */
    private handleUnitSpawned(payload: { entityId: number; unitType: UnitType; x: number; y: number; player: number }): void {
        if (payload.unitType !== UnitType.Carrier) {
            return;
        }

        // Find nearest hub (residence) for this player
        const nearestHub = this.findNearestHub(payload.x, payload.y, payload.player);
        if (!nearestHub) {
            CarrierSystem.log.warn(`No hub found for carrier ${payload.entityId} at (${payload.x}, ${payload.y}) for player ${payload.player}`);
            return;
        }

        // Register the carrier with the hub
        this.carrierManager.createCarrier(payload.entityId, nearestHub);
        CarrierSystem.log.debug(`Registered carrier ${payload.entityId} with hub ${nearestHub}`);
    }

    /**
     * Find the nearest hub (building with service area) for a player at a given position.
     */
    private findNearestHub(x: number, y: number, playerId: number): number | null {
        const serviceAreas = this.serviceAreaManager.getServiceAreasForPlayer(playerId);
        if (serviceAreas.length === 0) {
            return null;
        }

        let nearestHub: number | null = null;
        let nearestDistSq = Infinity;

        for (const area of serviceAreas) {
            const dx = area.centerX - x;
            const dy = area.centerY - y;
            const distSq = dx * dx + dy * dy;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestHub = area.buildingId;
            }
        }

        return nearestHub;
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
        // Buildings MUST exist - caller should have validated
        this.gameState.getEntityOrThrow(fromBuildingId, 'source building for delivery');
        this.gameState.getEntityOrThrow(toBuildingId, 'destination building for delivery');

        // Check carrier availability
        if (!this.carrierManager.canAssignJobTo(carrierId)) {
            CarrierSystem.log.warn(`Carrier ${carrierId} is not available for jobs`);
            return false;
        }

        // Get carrier's home building (must exist since canAssignJobTo passed)
        const carrier = this.carrierManager.getCarrierOrThrow(carrierId, 'for job assignment');

        // Assign job via SettlerTaskSystem
        const success = this.settlerTaskSystem.assignCarrierJob(
            carrierId,
            fromBuildingId,
            toBuildingId,
            material,
            amount,
            carrier.homeBuilding,
        );

        if (success) {
            // Update carrier status
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);

            // Emit job assigned event
            this.eventBus!.emit('carrier:jobAssigned', {
                entityId: carrierId,
                job: {
                    type: 'pickup',
                    fromBuilding: fromBuildingId,
                    material,
                    amount,
                },
            });
        }

        return success;
    }

    /**
     * Get the carrier manager for external access.
     */
    getCarrierManager(): CarrierManager {
        return this.carrierManager;
    }
}
