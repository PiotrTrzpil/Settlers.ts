/**
 * CarrierManager - Manages all carrier states and auto-registration.
 */

import type { EventBus } from '../../event-bus';
import { EMaterialType } from '../../economy';
import type { EntityProvider } from '../../entity';
import { CarrierStatus, type CarrierState, createCarrierState } from './carrier-state';
import { LogHandler } from '@/utilities/log-handler';

/**
 * Configuration for CarrierManager dependencies.
 */
export interface CarrierManagerConfig {
    entityProvider: EntityProvider;
    eventBus: EventBus;
}

/**
 * Manages carrier state for all carrier units.
 * Tracks carrier status and auto-registers spawned carriers.
 */
export class CarrierManager {
    private static log = new LogHandler('CarrierManager');

    /** Entity provider for accessing entities */
    private readonly entityProvider: EntityProvider;

    /** Internal state storage: carrierId -> CarrierState */
    private readonly states = new Map<number, CarrierState>();

    /** Event bus for emitting carrier events */
    private readonly eventBus: EventBus;

    constructor(config: CarrierManagerConfig) {
        this.entityProvider = config.entityProvider;
        this.eventBus = config.eventBus;
    }

    /**
     * Register a new carrier.
     */
    registerCarrier(entityId: number): CarrierState {
        if (!this.entityProvider.getEntity(entityId)) {
            throw new Error(`Cannot create carrier: entity ${entityId} not found`);
        }
        if (this.states.has(entityId)) {
            throw new Error(`Carrier with entity ID ${entityId} already exists`);
        }

        const state = createCarrierState(entityId);
        this.states.set(entityId, state);

        this.eventBus.emit('carrier:created', { entityId });
        CarrierManager.log.debug(`Registered carrier ${entityId}`);

        return state;
    }

    /**
     * Remove a carrier from the system.
     */
    removeCarrier(entityId: number): boolean {
        const state = this.states.get(entityId);
        if (!state) return false;

        const hadActiveJob = state.status !== CarrierStatus.Idle;
        this.states.delete(entityId);

        this.eventBus.emit('carrier:removed', { entityId, hadActiveJob });

        return true;
    }

    /**
     * Get a carrier's state by entity ID.
     */
    getCarrier(entityId: number): CarrierState | undefined {
        return this.states.get(entityId);
    }

    /**
     * Get a carrier's state, throwing if not found.
     */
    getCarrierOrThrow(entityId: number, context?: string): CarrierState {
        const state = this.states.get(entityId);
        if (!state) {
            const contextSuffix = context ? ` [${context}]` : '';
            throw new Error(`Entity ${entityId} is not a carrier (has no carrier state)${contextSuffix}`);
        }
        return state;
    }

    /**
     * Check if a carrier exists.
     */
    hasCarrier(entityId: number): boolean {
        return this.states.has(entityId);
    }

    /**
     * Check if a job can be assigned to a carrier.
     */
    canAssignJobTo(carrierId: number): boolean {
        const state = this.states.get(carrierId);
        if (!state) return false;
        return state.status === CarrierStatus.Idle;
    }

    /**
     * Update a carrier's status.
     */
    setStatus(carrierId: number, status: CarrierStatus): void {
        const state = this.getCarrierOrThrow(carrierId, 'setStatus');

        const previousStatus = state.status;
        if (previousStatus === status) return;

        state.status = status;

        this.eventBus.emit('carrier:statusChanged', {
            entityId: carrierId,
            previousStatus,
            newStatus: status,
        });
    }

    /**
     * Get all carrier states.
     */
    *getAllCarriers(): IterableIterator<CarrierState> {
        yield* this.states.values();
    }

    /**
     * Get the number of carriers.
     */
    get size(): number {
        return this.states.size;
    }

    /**
     * Clear all carrier states.
     */
    clear(): void {
        this.states.clear();
    }

    /**
     * Restore a carrier from serialized state (used by persistence).
     * Does not emit events to avoid duplicate notifications during load.
     */
    restoreCarrier(data: {
        entityId: number;
        status: CarrierStatus;
        carryingMaterial: EMaterialType | null;
        carryingAmount: number;
    }): void {
        const entity = this.entityProvider.getEntity(data.entityId);
        if (!entity) {
            console.warn(`Cannot restore carrier: entity ${data.entityId} not found, skipping`);
            return;
        }

        this.states.set(data.entityId, {
            entityId: data.entityId,
            status: data.status,
        });

        if (data.carryingMaterial !== null && data.carryingAmount > 0) {
            entity.carrying = {
                material: data.carryingMaterial,
                amount: data.carryingAmount,
            };
        }
    }
}
