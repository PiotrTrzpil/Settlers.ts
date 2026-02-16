/**
 * CarrierManager - Manages all carrier states, fatigue recovery, and auto-registration.
 *
 * State is stored on entity.carrier (RFC: Entity-Owned State).
 * Cross-entity index (carriersByTavern) remains in the manager.
 */

import type { EventBus } from '../../event-bus';
import { EMaterialType } from '../../economy';
import { type EntityProvider, getCarrierState } from '../../entity';
import { CarrierStatus, type CarrierState, createCarrierState, canAcceptNewJob } from './carrier-state';
import type { ServiceAreaManager } from '../service-areas';
import { LogHandler } from '@/utilities/log-handler';

/** Fatigue recovery rate per second when resting at home tavern */
const FATIGUE_RECOVERY_RATE = 10;

/** Fatigue recovery rate per second when idle (not actively resting) */
const IDLE_RECOVERY_RATE = 5;

/**
 * Configuration for CarrierManager dependencies.
 */
export interface CarrierManagerConfig {
    entityProvider: EntityProvider;
    eventBus: EventBus;
}

/**
 * Manages carrier state for all carrier units.
 * Tracks carriers by their home tavern, handles fatigue recovery, and auto-registers spawned carriers.
 *
 * State is stored on entity.carrier (RFC: Entity-Owned State).
 */
export class CarrierManager {
    private static log = new LogHandler('CarrierManager');

    /** Entity provider for accessing entities */
    private readonly entityProvider: EntityProvider;

    /** Index of tavern ID -> Set of carrier entity IDs (cross-entity state stays in manager) */
    private carriersByTavern: Map<number, Set<number>> = new Map();

    /** Event bus for emitting carrier events */
    private readonly eventBus: EventBus;

    /** Service area manager for auto-registration (set via setServiceAreaManager) */
    private serviceAreaManager: ServiceAreaManager | null = null;

    constructor(config: CarrierManagerConfig) {
        this.entityProvider = config.entityProvider;
        this.eventBus = config.eventBus;
    }

    /**
     * Set the service area manager (needed for auto-registering spawned carriers).
     */
    setServiceAreaManager(manager: ServiceAreaManager): void {
        this.serviceAreaManager = manager;
    }

    /**
     * Create a new carrier and register it with a home tavern.
     * @param entityId - The entity ID of the carrier unit
     * @param homeBuilding - The entity ID of the tavern this carrier is assigned to
     * @returns The created carrier state
     */
    createCarrier(entityId: number, homeBuilding: number): CarrierState {
        const entity = this.entityProvider.getEntity(entityId);
        if (!entity) {
            throw new Error(`Cannot create carrier: entity ${entityId} not found`);
        }
        if (entity.carrier) {
            throw new Error(`Carrier with entity ID ${entityId} already exists`);
        }

        const state = createCarrierState(entityId, homeBuilding);

        // Store state on entity (RFC: Entity-Owned State)
        entity.carrier = state;

        // Add to tavern index (cross-entity state stays in manager)
        if (!this.carriersByTavern.has(homeBuilding)) {
            this.carriersByTavern.set(homeBuilding, new Set());
        }
        this.carriersByTavern.get(homeBuilding)!.add(entityId);

        this.eventBus.emit('carrier:created', { entityId, homeBuilding });

        return state;
    }

    /**
     * Remove a carrier from the system.
     * If the carrier has an active job, it will be abandoned (goods may be lost).
     * @param entityId - The entity ID of the carrier to remove
     * @returns true if the carrier was removed, false if it didn't exist
     */
    removeCarrier(entityId: number): boolean {
        const entity = this.entityProvider.getEntity(entityId);
        const state = entity?.carrier;
        if (!state) return false;

        const hadActiveJob = state.status !== CarrierStatus.Idle && state.status !== CarrierStatus.Resting;
        const homeBuilding = state.homeBuilding;

        // Remove from tavern index
        const tavernCarriers = this.carriersByTavern.get(homeBuilding);
        if (tavernCarriers) {
            tavernCarriers.delete(entityId);
            if (tavernCarriers.size === 0) {
                this.carriersByTavern.delete(homeBuilding);
            }
        }

        // Remove state from entity (RFC: Entity-Owned State)
        delete entity.carrier;

        this.eventBus.emit('carrier:removed', { entityId, homeBuilding, hadActiveJob });

        return true;
    }

    /**
     * Get a carrier's state by entity ID.
     * @param entityId - The entity ID of the carrier
     * @returns The carrier state, or undefined if not found
     */
    getCarrier(entityId: number): CarrierState | undefined {
        return this.entityProvider.getEntity(entityId)?.carrier;
    }

    /**
     * Get a carrier's state, throwing if not found.
     * Use when the carrier MUST exist.
     * @param entityId - The entity ID of the carrier
     * @param context - Optional context for error message
     * @returns The carrier state
     * @throws Error if carrier not found
     */
    getCarrierOrThrow(entityId: number, context?: string): CarrierState {
        const entity = this.entityProvider.getEntityOrThrow(entityId, context ?? 'carrier');
        return getCarrierState(entity);
    }

    /**
     * Check if a carrier exists.
     * @param entityId - The entity ID to check
     * @returns true if the carrier exists
     */
    hasCarrier(entityId: number): boolean {
        return this.entityProvider.getEntity(entityId)?.carrier !== undefined;
    }

    /**
     * Get all carriers assigned to a specific tavern.
     * @param tavernId - The entity ID of the tavern
     * @returns Array of carrier states for that tavern
     */
    getCarriersForTavern(tavernId: number): CarrierState[] {
        const carrierIds = this.carriersByTavern.get(tavernId);
        if (!carrierIds) return [];

        const result: CarrierState[] = [];
        for (const id of carrierIds) {
            const state = this.entityProvider.getEntity(id)?.carrier;
            if (state) result.push(state);
        }
        return result;
    }

    /**
     * Get the number of carriers currently assigned to a hub.
     * @param hubId - The entity ID of the hub building
     * @returns Number of carriers assigned to this hub
     */
    getCarrierCountForHub(hubId: number): number {
        return this.carriersByTavern.get(hubId)?.size ?? 0;
    }

    /**
     * Check if a hub has capacity for more carriers.
     * @param hubId - The entity ID of the hub building
     * @param capacity - The maximum capacity of the hub
     * @returns true if the hub can accept more carriers
     */
    hasCapacity(hubId: number, capacity: number): boolean {
        return this.getCarrierCountForHub(hubId) < capacity;
    }

    /**
     * Get available carriers for a specific tavern (idle, no job, not too fatigued).
     * @param tavernId - The entity ID of the tavern
     * @returns Array of available carrier states for that tavern
     */
    getAvailableCarriers(tavernId: number): CarrierState[] {
        return this.getCarriersForTavern(tavernId).filter(carrier => this.canAssignJobTo(carrier.entityId));
    }

    /**
     * Get carriers that are currently busy (have a job or not idle).
     * @param tavernId - The entity ID of the tavern
     * @returns Array of busy carrier states for that tavern
     */
    getBusyCarriers(tavernId: number): CarrierState[] {
        return this.getCarriersForTavern(tavernId).filter(carrier => carrier.status !== CarrierStatus.Idle);
    }

    /**
     * Check if a job can be assigned to a carrier.
     * @param carrierId - The entity ID of the carrier
     * @returns true if the carrier can accept a new job
     */
    canAssignJobTo(carrierId: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        // Must be idle
        if (state.status !== CarrierStatus.Idle) return false;

        // Must not be too fatigued
        if (!canAcceptNewJob(state.fatigue)) return false;

        return true;
    }

    /**
     * Update a carrier's status.
     * @param carrierId - The entity ID of the carrier
     * @param status - The new status
     * @throws Error if carrier not found
     */
    setStatus(carrierId: number, status: CarrierStatus): void {
        const entity = this.entityProvider.getEntityOrThrow(carrierId, 'carrier for setStatus');
        const state = getCarrierState(entity);

        const previousStatus = state.status;
        if (previousStatus === status) return; // No change needed

        state.status = status;

        this.eventBus.emit('carrier:statusChanged', {
            entityId: carrierId,
            previousStatus,
            newStatus: status,
        });
    }

    /**
     * Update a carrier's fatigue level.
     * @param carrierId - The entity ID of the carrier
     * @param fatigue - The new fatigue level (0-100)
     * @throws Error if carrier not found
     */
    setFatigue(carrierId: number, fatigue: number): void {
        const entity = this.entityProvider.getEntityOrThrow(carrierId, 'carrier for setFatigue');
        const state = getCarrierState(entity);

        state.fatigue = Math.max(0, Math.min(100, fatigue));
    }

    /**
     * Add fatigue to a carrier.
     * @param carrierId - The entity ID of the carrier
     * @param amount - Amount to add (positive) or remove (negative)
     * @throws Error if carrier not found
     */
    addFatigue(carrierId: number, amount: number): void {
        const entity = this.entityProvider.getEntityOrThrow(carrierId, 'carrier for addFatigue');
        const state = getCarrierState(entity);

        this.setFatigue(carrierId, state.fatigue + amount);
    }

    /**
     * Reassign a carrier to a different tavern.
     * Cannot reassign while carrier has an active job.
     * @param carrierId - The entity ID of the carrier
     * @param newTavernId - The entity ID of the new home tavern
     * @returns true if reassigned, false if carrier has active job
     * @throws Error if carrier not found
     */
    reassignToTavern(carrierId: number, newTavernId: number): boolean {
        const entity = this.entityProvider.getEntityOrThrow(carrierId, 'carrier for reassignToTavern');
        const state = getCarrierState(entity);

        // Prevent reassignment while carrier is busy (valid condition, not a bug)
        if (state.status !== CarrierStatus.Idle) return false;

        const oldTavernId = state.homeBuilding;
        if (oldTavernId === newTavernId) return true; // Already at this tavern

        // Remove from old tavern index
        const oldTavernCarriers = this.carriersByTavern.get(oldTavernId);
        if (oldTavernCarriers) {
            oldTavernCarriers.delete(carrierId);
            if (oldTavernCarriers.size === 0) {
                this.carriersByTavern.delete(oldTavernId);
            }
        }

        // Add to new tavern index
        if (!this.carriersByTavern.has(newTavernId)) {
            this.carriersByTavern.set(newTavernId, new Set());
        }
        this.carriersByTavern.get(newTavernId)!.add(carrierId);

        state.homeBuilding = newTavernId;
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Fatigue Recovery (runs each tick)
    // ─────────────────────────────────────────────────────────────

    /**
     * Update fatigue for all carriers.
     * Resting carriers recover faster; idle carriers recover slowly.
     */
    updateFatigue(dt: number): void {
        for (const carrier of this.getAllCarriers()) {
            if (carrier.status === CarrierStatus.Resting) {
                const recovery = FATIGUE_RECOVERY_RATE * dt;
                const newFatigue = Math.max(0, carrier.fatigue - recovery);
                this.setFatigue(carrier.entityId, newFatigue);

                if (newFatigue === 0) {
                    this.setStatus(carrier.entityId, CarrierStatus.Idle);
                }
            } else if (carrier.status === CarrierStatus.Idle && carrier.fatigue > 0) {
                const recovery = IDLE_RECOVERY_RATE * dt;
                const newFatigue = Math.max(0, carrier.fatigue - recovery);
                this.setFatigue(carrier.entityId, newFatigue);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Auto-Registration (called on unit:spawned event)
    // ─────────────────────────────────────────────────────────────

    /**
     * Auto-register a spawned carrier with its nearest hub.
     * Called from GameLoop when a unit:spawned event fires for a carrier.
     */
    autoRegisterCarrier(entityId: number, x: number, y: number, player: number): void {
        if (!this.serviceAreaManager) {
            CarrierManager.log.warn(`Cannot auto-register carrier ${entityId}: no service area manager`);
            return;
        }

        const nearestHub = this.findNearestHub(x, y, player);
        if (!nearestHub) {
            CarrierManager.log.warn(`No hub found for carrier ${entityId} at (${x}, ${y}) for player ${player}`);
            return;
        }

        this.createCarrier(entityId, nearestHub);
        CarrierManager.log.debug(`Registered carrier ${entityId} with hub ${nearestHub}`);
    }

    /**
     * Find the nearest hub (building with service area) for a player at a given position.
     * Only returns hubs that have capacity for more carriers.
     */
    private findNearestHub(x: number, y: number, playerId: number): number | null {
        const serviceAreas = this.serviceAreaManager!.getServiceAreasForPlayer(playerId);
        if (serviceAreas.length === 0) {
            return null;
        }

        let nearestHub: number | null = null;
        let nearestDistSq = Infinity;

        for (const area of serviceAreas) {
            if (!this.hasCapacity(area.buildingId, area.capacity)) {
                continue;
            }

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

    /**
     * Get all carrier states.
     * @returns Iterator of all carrier states
     */
    *getAllCarriers(): IterableIterator<CarrierState> {
        for (const entity of this.entityProvider.entities) {
            if (entity.carrier) {
                yield entity.carrier;
            }
        }
    }

    /**
     * Get the number of carriers.
     */
    get size(): number {
        let count = 0;
        for (const entity of this.entityProvider.entities) {
            if (entity.carrier) count++;
        }
        return count;
    }

    /**
     * Clear all carrier states.
     */
    clear(): void {
        for (const entity of this.entityProvider.entities) {
            delete entity.carrier;
        }
        this.carriersByTavern.clear();
    }

    /**
     * Restore a carrier from serialized state (used by persistence).
     * Does not emit events to avoid duplicate notifications during load.
     */
    restoreCarrier(data: {
        entityId: number;
        homeBuilding: number;
        status: CarrierStatus;
        fatigue: number;
        carryingMaterial: EMaterialType | null;
        carryingAmount: number;
    }): void {
        const entity = this.entityProvider.getEntity(data.entityId);
        if (!entity) {
            throw new Error(`Cannot restore carrier: entity ${data.entityId} not found`);
        }

        // Store carrier state on entity (RFC: Entity-Owned State)
        entity.carrier = {
            entityId: data.entityId,
            homeBuilding: data.homeBuilding,
            fatigue: data.fatigue,
            status: data.status,
        };

        // Restore carrying state if carrier was carrying material
        if (data.carryingMaterial !== null && data.carryingAmount > 0) {
            entity.carrying = {
                material: data.carryingMaterial,
                amount: data.carryingAmount,
            };
        }

        // Add to tavern index
        if (!this.carriersByTavern.has(data.homeBuilding)) {
            this.carriersByTavern.set(data.homeBuilding, new Set());
        }
        this.carriersByTavern.get(data.homeBuilding)!.add(data.entityId);
    }
}
