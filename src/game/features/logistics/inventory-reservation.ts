/**
 * Inventory Reservation System
 *
 * Tracks reserved amounts in building inventories to prevent
 * multiple requests from over-committing the same supply.
 *
 * When a request is matched to a supply, the amount is "reserved"
 * until the carrier picks it up (converting to actual withdrawal)
 * or the request is cancelled (releasing the reservation).
 */

import { EMaterialType } from '../../economy/material-type';

/**
 * A reservation of inventory at a building.
 */
export interface InventoryReservation {
    /** Unique ID for this reservation */
    readonly id: number;
    /** Entity ID of the building with the reserved inventory */
    readonly buildingId: number;
    /** Material type reserved */
    readonly materialType: EMaterialType;
    /** Amount reserved */
    readonly amount: number;
    /** ID of the request this reservation is for */
    readonly requestId: number;
    /** Timestamp when reservation was created */
    readonly timestamp: number;
}

/**
 * Key for looking up reservations by building and material.
 */
function reservationKey(buildingId: number, materialType: EMaterialType): string {
    return `${buildingId}:${materialType}`;
}

/**
 * Manages inventory reservations across all buildings.
 *
 * Reservations temporarily reduce the "available" amount of a material
 * without actually removing it from the building's inventory.
 */
export class InventoryReservationManager {
    /** All reservations indexed by ID */
    private reservations: Map<number, InventoryReservation> = new Map();

    /** Reservations indexed by building+material for fast lookup */
    private byBuildingMaterial: Map<string, Set<number>> = new Map();

    /** Reservations indexed by request ID */
    private byRequest: Map<number, number> = new Map();

    /** Next reservation ID */
    private nextId = 1;

    /**
     * Create a reservation for inventory at a building.
     *
     * @param buildingId Building with the inventory
     * @param materialType Material to reserve
     * @param amount Amount to reserve
     * @param requestId Request this reservation is for
     * @returns The created reservation, or null if invalid
     */
    createReservation(
        buildingId: number,
        materialType: EMaterialType,
        amount: number,
        requestId: number,
    ): InventoryReservation | null {
        if (amount <= 0) return null;

        const reservation: InventoryReservation = {
            id: this.nextId++,
            buildingId,
            materialType,
            amount,
            requestId,
            timestamp: Date.now(),
        };

        this.reservations.set(reservation.id, reservation);

        // Index by building+material
        const key = reservationKey(buildingId, materialType);
        let byBuilding = this.byBuildingMaterial.get(key);
        if (!byBuilding) {
            byBuilding = new Set();
            this.byBuildingMaterial.set(key, byBuilding);
        }
        byBuilding.add(reservation.id);

        // Index by request
        this.byRequest.set(requestId, reservation.id);

        return reservation;
    }

    /**
     * Release a reservation by ID.
     *
     * @param reservationId ID of the reservation to release
     * @returns True if reservation was released
     */
    releaseReservation(reservationId: number): boolean {
        const reservation = this.reservations.get(reservationId);
        if (!reservation) return false;

        this.reservations.delete(reservationId);

        // Remove from building+material index
        const key = reservationKey(reservation.buildingId, reservation.materialType);
        const byBuilding = this.byBuildingMaterial.get(key);
        if (byBuilding) {
            byBuilding.delete(reservationId);
            if (byBuilding.size === 0) {
                this.byBuildingMaterial.delete(key);
            }
        }

        // Remove from request index
        this.byRequest.delete(reservation.requestId);

        return true;
    }

    /**
     * Release the reservation for a specific request.
     *
     * @param requestId ID of the request
     * @returns True if a reservation was released
     */
    releaseReservationForRequest(requestId: number): boolean {
        const reservationId = this.byRequest.get(requestId);
        if (reservationId === undefined) return false;
        return this.releaseReservation(reservationId);
    }

    /**
     * Get the reservation for a specific request.
     *
     * @param requestId ID of the request
     * @returns The reservation or undefined
     */
    getReservationForRequest(requestId: number): InventoryReservation | undefined {
        const reservationId = this.byRequest.get(requestId);
        if (reservationId === undefined) return undefined;
        return this.reservations.get(reservationId);
    }

    /**
     * Get total reserved amount for a building and material type.
     *
     * @param buildingId Building to check
     * @param materialType Material to check
     * @returns Total reserved amount
     */
    getReservedAmount(buildingId: number, materialType: EMaterialType): number {
        const key = reservationKey(buildingId, materialType);
        const reservationIds = this.byBuildingMaterial.get(key);
        if (!reservationIds) return 0;

        let total = 0;
        for (const id of reservationIds) {
            const reservation = this.reservations.get(id);
            if (reservation) {
                total += reservation.amount;
            }
        }
        return total;
    }

    /**
     * Get available amount at a building, accounting for reservations.
     *
     * @param buildingId Building to check
     * @param materialType Material to check
     * @param actualAmount Actual amount in inventory
     * @returns Available amount (actual minus reserved)
     */
    getAvailableAmount(
        buildingId: number,
        materialType: EMaterialType,
        actualAmount: number,
    ): number {
        const reserved = this.getReservedAmount(buildingId, materialType);
        return Math.max(0, actualAmount - reserved);
    }

    /**
     * Release all reservations for a building.
     * Useful when a building is destroyed.
     *
     * @param buildingId Building to clear reservations for
     * @returns Number of reservations released
     */
    releaseReservationsForBuilding(buildingId: number): number {
        const toRelease: number[] = [];

        for (const reservation of this.reservations.values()) {
            if (reservation.buildingId === buildingId) {
                toRelease.push(reservation.id);
            }
        }

        for (const id of toRelease) {
            this.releaseReservation(id);
        }

        return toRelease.length;
    }

    /**
     * Get all reservations.
     */
    getAllReservations(): IterableIterator<InventoryReservation> {
        return this.reservations.values();
    }

    /**
     * Get count of active reservations.
     */
    get size(): number {
        return this.reservations.size;
    }

    /**
     * Clear all reservations.
     */
    clear(): void {
        this.reservations.clear();
        this.byBuildingMaterial.clear();
        this.byRequest.clear();
    }
}
