/**
 * CarrierManager - Manages all carrier states.
 * Provides CRUD operations and queries for carrier units.
 *
 * State is stored on entity.carrier (RFC: Entity-Owned State).
 * Cross-entity index (carriersByTavern) remains in the manager.
 */

import type { EventBus } from '../../event-bus';
import { EMaterialType } from '../../economy';
import type { EntityProvider } from '../../entity';
import {
    CarrierStatus,
    type CarrierState,
    type CarrierJob,
    createCarrierState,
    canAcceptNewJob,
} from './carrier-state';

/**
 * Manages carrier state for all carrier units.
 * Tracks carriers by their home tavern and provides job assignment.
 *
 * State is stored on entity.carrier (RFC: Entity-Owned State).
 */
export class CarrierManager {
    /** Entity provider for accessing entities (MUST be set via setEntityProvider) */
    private entityProvider!: EntityProvider;

    /** Index of tavern ID -> Set of carrier entity IDs (cross-entity state stays in manager) */
    private carriersByTavern: Map<number, Set<number>> = new Map();

    /** Event bus for emitting carrier events (MUST be set via registerEvents) */
    private eventBus!: EventBus;

    /**
     * Set the entity provider (called by GameState after construction).
     */
    setEntityProvider(provider: EntityProvider): void {
        this.entityProvider = provider;
    }

    /**
     * Register event bus for emitting carrier events.
     */
    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
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

        this.eventBus!.emit('carrier:created', { entityId, homeBuilding });

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

        const hadActiveJob = state.currentJob !== null;
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

        this.eventBus!.emit('carrier:removed', { entityId, homeBuilding, hadActiveJob });

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
     * Get available carriers for a specific tavern (idle, no job, not too fatigued).
     * @param tavernId - The entity ID of the tavern
     * @returns Array of available carrier states for that tavern
     */
    getAvailableCarriers(tavernId: number): CarrierState[] {
        return this.getCarriersForTavern(tavernId).filter(
            carrier => this.canAssignJobTo(carrier.entityId)
        );
    }

    /**
     * Get carriers that are currently busy (have a job or not idle).
     * @param tavernId - The entity ID of the tavern
     * @returns Array of busy carrier states for that tavern
     */
    getBusyCarriers(tavernId: number): CarrierState[] {
        return this.getCarriersForTavern(tavernId).filter(
            carrier => carrier.currentJob !== null || carrier.status !== CarrierStatus.Idle
        );
    }

    /**
     * Check if a job can be assigned to a carrier.
     * @param carrierId - The entity ID of the carrier
     * @returns true if the carrier can accept a new job
     */
    canAssignJobTo(carrierId: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        // Must be idle with no current job
        if (state.status !== CarrierStatus.Idle) return false;
        if (state.currentJob !== null) return false;

        // Must not be too fatigued
        if (!canAcceptNewJob(state.fatigue)) return false;

        return true;
    }

    /**
     * Assign a job to a carrier.
     * Does NOT automatically change carrier status - caller should set status appropriately.
     * @param carrierId - The entity ID of the carrier
     * @param job - The job to assign
     * @returns true if the job was assigned, false if carrier not found or cannot accept jobs
     */
    assignJob(carrierId: number, job: CarrierJob): boolean {
        if (!this.canAssignJobTo(carrierId)) {
            return false;
        }

        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        state.currentJob = job;

        this.eventBus!.emit('carrier:jobAssigned', { entityId: carrierId, job });

        return true;
    }

    /**
     * Mark a carrier's current job as complete.
     * Does NOT automatically change status - caller should set status appropriately.
     * @param carrierId - The entity ID of the carrier
     * @returns The completed job, or null if carrier not found or had no job
     */
    completeJob(carrierId: number): CarrierJob | null {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return null;
        if (state.currentJob === null) return null;

        const completedJob = state.currentJob;
        state.currentJob = null;

        this.eventBus!.emit('carrier:jobCompleted', { entityId: carrierId, completedJob });

        return completedJob;
    }

    /**
     * Update a carrier's status.
     * @param carrierId - The entity ID of the carrier
     * @param status - The new status
     * @returns true if the status was updated, false if carrier not found
     */
    setStatus(carrierId: number, status: CarrierStatus): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        const previousStatus = state.status;
        if (previousStatus === status) return true; // No change needed

        state.status = status;

        this.eventBus!.emit('carrier:statusChanged', {
            entityId: carrierId,
            previousStatus,
            newStatus: status,
        });

        return true;
    }

    /**
     * Set what material a carrier is currently carrying.
     * @param carrierId - The entity ID of the carrier
     * @param material - The material type, or null to clear
     * @param amount - The amount being carried
     * @returns true if updated, false if carrier not found
     */
    setCarrying(carrierId: number, material: EMaterialType | null, amount: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        state.carryingMaterial = material;
        state.carryingAmount = amount;
        return true;
    }

    /**
     * Update a carrier's fatigue level.
     * @param carrierId - The entity ID of the carrier
     * @param fatigue - The new fatigue level (0-100)
     * @returns true if updated, false if carrier not found
     */
    setFatigue(carrierId: number, fatigue: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        state.fatigue = Math.max(0, Math.min(100, fatigue));
        return true;
    }

    /**
     * Add fatigue to a carrier.
     * @param carrierId - The entity ID of the carrier
     * @param amount - Amount to add (positive) or remove (negative)
     * @returns true if updated, false if carrier not found
     */
    addFatigue(carrierId: number, amount: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        return this.setFatigue(carrierId, state.fatigue + amount);
    }

    /**
     * Reassign a carrier to a different tavern.
     * Cannot reassign while carrier has an active job.
     * @param carrierId - The entity ID of the carrier
     * @param newTavernId - The entity ID of the new home tavern
     * @returns true if reassigned, false if carrier not found or has active job
     */
    reassignToTavern(carrierId: number, newTavernId: number): boolean {
        const state = this.entityProvider.getEntity(carrierId)?.carrier;
        if (!state) return false;

        // Prevent reassignment while on a job
        if (state.currentJob !== null) return false;

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

    /**
     * Get all carrier states.
     * @returns Iterator of all carrier states
     */
    *getAllCarriers(): IterableIterator<CarrierState> {
        for (const entity of this.entityProvider!.entities) {
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
        for (const entity of this.entityProvider!.entities) {
            if (entity.carrier) count++;
        }
        return count;
    }

    /**
     * Clear all carrier states.
     */
    clear(): void {
        for (const entity of this.entityProvider!.entities) {
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

        // Store state on entity (RFC: Entity-Owned State)
        entity.carrier = {
            entityId: data.entityId,
            homeBuilding: data.homeBuilding,
            currentJob: null, // Jobs are not persisted - will be re-assigned
            fatigue: data.fatigue,
            carryingMaterial: data.carryingMaterial,
            carryingAmount: data.carryingAmount,
            status: data.status,
        };

        // Add to tavern index
        if (!this.carriersByTavern.has(data.homeBuilding)) {
            this.carriersByTavern.set(data.homeBuilding, new Set());
        }
        this.carriersByTavern.get(data.homeBuilding)!.add(data.entityId);
    }
}
