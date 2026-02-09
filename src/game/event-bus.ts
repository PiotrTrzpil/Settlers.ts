/**
 * Lightweight typed event bus for decoupling game systems.
 * Features register event handlers instead of being called directly.
 */

import type { BuildingState } from './features/building-construction';
import type { BuildingType } from './buildings/types';
import type { UnitType } from './unit-types';
import type { CarrierJob } from './features/carriers';

/** Event map defining all game events and their payloads */
export interface GameEvents {
    /** Emitted when a building is successfully placed (construction begins) */
    'building:placed': {
        entityId: number;
        buildingType: BuildingType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when building construction completes */
    'building:completed': {
        entityId: number;
        buildingState: BuildingState;
    };
    /** Emitted when a building is removed/cancelled */
    'building:removed': {
        entityId: number;
        buildingState: BuildingState;
    };
    /** Emitted when a unit is spawned */
    'unit:spawned': {
        entityId: number;
        unitType: UnitType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when terrain is modified (e.g., during building construction leveling) */
    'terrain:modified': Record<string, never>;

    // === Movement Events ===

    /** Emitted when a unit starts moving */
    'unit:movementStarted': {
        entityId: number;
        direction: number;
    };

    /** Emitted when a unit stops moving (becomes idle) */
    'unit:movementStopped': {
        entityId: number;
        direction: number;
    };

    /** Emitted when a unit's facing direction changes during movement */
    'unit:directionChanged': {
        entityId: number;
        direction: number;
        previousDirection: number;
    };

    // === Carrier Events ===

    /** Emitted when a carrier is registered with a tavern */
    'carrier:created': {
        entityId: number;
        homeBuilding: number;
    };

    /** Emitted when a carrier is removed from the system */
    'carrier:removed': {
        entityId: number;
        homeBuilding: number;
        /** True if carrier was removed while on a job */
        hadActiveJob: boolean;
    };

    /** Emitted when a job is assigned to a carrier */
    'carrier:jobAssigned': {
        entityId: number;
        job: CarrierJob;
    };

    /** Emitted when a carrier completes their current job */
    'carrier:jobCompleted': {
        entityId: number;
        completedJob: CarrierJob;
    };

    /** Emitted when a carrier's status changes */
    'carrier:statusChanged': {
        entityId: number;
        previousStatus: number;
        newStatus: number;
    };

    /** Emitted when a carrier arrives at a building for pickup */
    'carrier:arrivedForPickup': {
        entityId: number;
        buildingId: number;
    };

    /** Emitted when a carrier arrives at a building for delivery */
    'carrier:arrivedForDelivery': {
        entityId: number;
        buildingId: number;
    };

    /** Emitted when a carrier arrives at their home tavern */
    'carrier:arrivedHome': {
        entityId: number;
        homeBuilding: number;
    };

    /** Emitted when a carrier completes a pickup (material transferred) */
    'carrier:pickupComplete': {
        entityId: number;
        fromBuilding: number;
        material: number;
        amount: number;
    };

    /** Emitted when a carrier completes a delivery (material transferred) */
    'carrier:deliveryComplete': {
        entityId: number;
        toBuilding: number;
        material: number;
        amount: number;
        /** Amount that couldn't be delivered (destination full) */
        overflow: number;
    };

    /** Emitted when a carrier returns to their home tavern and becomes idle/resting */
    'carrier:returnedHome': {
        entityId: number;
        homeBuilding: number;
    };
}

type EventHandler<T> = (payload: T) => void;

export class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();

    /** Register an event handler */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        if (!this.handlers.has(event as string)) {
            this.handlers.set(event as string, new Set());
        }
        this.handlers.get(event as string)!.add(handler);
    }

    /** Remove an event handler */
    off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        this.handlers.get(event as string)?.delete(handler);
    }

    /** Emit an event to all registered handlers */
    emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
        const handlers = this.handlers.get(event as string);
        if (!handlers) return;
        for (const handler of handlers) {
            handler(payload);
        }
    }

    /** Remove all handlers */
    clear(): void {
        this.handlers.clear();
    }
}
