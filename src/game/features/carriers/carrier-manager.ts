/**
 * CarrierManager - Manages all carrier states.
 * Provides CRUD operations and queries for carrier units.
 */

import type { EventBus } from '../../event-bus';
import { CarrierStatus, type CarrierState, type CarrierJob, createCarrierState } from './carrier-state';

/**
 * Manages carrier state for all carrier units.
 * Tracks carriers by their home tavern and provides job assignment.
 */
export class CarrierManager {
    /** Map of entity ID -> carrier state */
    private carriers: Map<number, CarrierState> = new Map();

    /** Index of tavern ID -> Set of carrier entity IDs */
    private carriersByTavern: Map<number, Set<number>> = new Map();

    /** Optional event bus for emitting carrier events (used by future carrier system) */
    private _eventBus: EventBus | undefined;

    /**
     * Register event bus for emitting carrier events.
     */
    registerEvents(eventBus: EventBus): void {
        this._eventBus = eventBus;
    }

    /**
     * Create a new carrier and register it with a home tavern.
     * @param entityId - The entity ID of the carrier unit
     * @param homeBuilding - The entity ID of the tavern this carrier is assigned to
     * @returns The created carrier state
     */
    createCarrier(entityId: number, homeBuilding: number): CarrierState {
        if (this.carriers.has(entityId)) {
            throw new Error(`Carrier with entity ID ${entityId} already exists`);
        }

        const state = createCarrierState(entityId, homeBuilding);
        this.carriers.set(entityId, state);

        // Add to tavern index
        if (!this.carriersByTavern.has(homeBuilding)) {
            this.carriersByTavern.set(homeBuilding, new Set());
        }
        this.carriersByTavern.get(homeBuilding)!.add(entityId);

        return state;
    }

    /**
     * Remove a carrier from the system.
     * @param entityId - The entity ID of the carrier to remove
     * @returns true if the carrier was removed, false if it didn't exist
     */
    removeCarrier(entityId: number): boolean {
        const state = this.carriers.get(entityId);
        if (!state) return false;

        // Remove from tavern index
        const tavernCarriers = this.carriersByTavern.get(state.homeBuilding);
        if (tavernCarriers) {
            tavernCarriers.delete(entityId);
            if (tavernCarriers.size === 0) {
                this.carriersByTavern.delete(state.homeBuilding);
            }
        }

        this.carriers.delete(entityId);
        return true;
    }

    /**
     * Get a carrier's state by entity ID.
     * @param entityId - The entity ID of the carrier
     * @returns The carrier state, or undefined if not found
     */
    getCarrier(entityId: number): CarrierState | undefined {
        return this.carriers.get(entityId);
    }

    /**
     * Check if a carrier exists.
     * @param entityId - The entity ID to check
     * @returns true if the carrier exists
     */
    hasCarrier(entityId: number): boolean {
        return this.carriers.has(entityId);
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
            const state = this.carriers.get(id);
            if (state) result.push(state);
        }
        return result;
    }

    /**
     * Get available (idle) carriers for a specific tavern.
     * @param tavernId - The entity ID of the tavern
     * @returns Array of idle carrier states for that tavern
     */
    getAvailableCarriers(tavernId: number): CarrierState[] {
        return this.getCarriersForTavern(tavernId).filter(
            carrier => carrier.status === CarrierStatus.Idle && carrier.currentJob === null
        );
    }

    /**
     * Assign a job to a carrier.
     * @param carrierId - The entity ID of the carrier
     * @param job - The job to assign
     * @returns true if the job was assigned, false if carrier not found or already has a job
     */
    assignJob(carrierId: number, job: CarrierJob): boolean {
        const state = this.carriers.get(carrierId);
        if (!state) return false;

        // Can only assign job to idle carriers
        if (state.status !== CarrierStatus.Idle || state.currentJob !== null) {
            return false;
        }

        state.currentJob = job;
        state.status = CarrierStatus.Walking;

        return true;
    }

    /**
     * Mark a carrier's current job as complete and return to idle.
     * @param carrierId - The entity ID of the carrier
     * @returns true if the job was completed, false if carrier not found or had no job
     */
    completeJob(carrierId: number): boolean {
        const state = this.carriers.get(carrierId);
        if (!state) return false;
        if (state.currentJob === null) return false;

        state.currentJob = null;
        state.status = CarrierStatus.Idle;

        return true;
    }

    /**
     * Update a carrier's status.
     * @param carrierId - The entity ID of the carrier
     * @param status - The new status
     * @returns true if the status was updated, false if carrier not found
     */
    setStatus(carrierId: number, status: CarrierStatus): boolean {
        const state = this.carriers.get(carrierId);
        if (!state) return false;

        state.status = status;
        return true;
    }

    /**
     * Set what material a carrier is currently carrying.
     * @param carrierId - The entity ID of the carrier
     * @param material - The material type, or null to clear
     * @param amount - The amount being carried
     * @returns true if updated, false if carrier not found
     */
    setCarrying(carrierId: number, material: import('../../economy').EMaterialType | null, amount: number): boolean {
        const state = this.carriers.get(carrierId);
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
        const state = this.carriers.get(carrierId);
        if (!state) return false;

        state.fatigue = Math.max(0, Math.min(100, fatigue));
        return true;
    }

    /**
     * Reassign a carrier to a different tavern.
     * @param carrierId - The entity ID of the carrier
     * @param newTavernId - The entity ID of the new home tavern
     * @returns true if reassigned, false if carrier not found
     */
    reassignToTavern(carrierId: number, newTavernId: number): boolean {
        const state = this.carriers.get(carrierId);
        if (!state) return false;

        const oldTavernId = state.homeBuilding;

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
    getAllCarriers(): IterableIterator<CarrierState> {
        return this.carriers.values();
    }

    /**
     * Get the number of carriers.
     */
    get size(): number {
        return this.carriers.size;
    }

    /**
     * Clear all carrier states.
     */
    clear(): void {
        this.carriers.clear();
        this.carriersByTavern.clear();
    }
}
