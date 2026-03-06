/**
 * Inventory Reservation System
 *
 * Tracks reserved amounts in building inventories to prevent
 * multiple requests from over-committing the same supply.
 *
 * When a request is matched to a supply, the amount is "reserved"
 * until the carrier picks it up (converting to actual withdrawal)
 * or the request is cancelled (releasing the reservation).
 *
 * This manager delegates to BuildingInventoryManager for actual slot-level
 * enforcement, while maintaining request-level bookkeeping.
 */

import { EMaterialType } from '../../economy/material-type';
import type { BuildingInventoryManager } from '../inventory';

/**
 * A reservation of inventory at a building.
 */
export interface InventoryReservation {
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
 * Manages inventory reservations across all buildings.
 *
 * Single nested Map<buildingId, Map<materialType, Map<requestId, Reservation>>>
 * is the sole source of truth. A secondary byRequest index stores the same
 * object references for O(1) request lookups.
 *
 * Delegates to BuildingInventoryManager for slot-level enforcement.
 */
export class InventoryReservationManager {
    /** Source of truth: buildingId → materialType → requestId → Reservation */
    private store = new Map<number, Map<EMaterialType, Map<number, InventoryReservation>>>();

    /** Secondary index for O(1) request lookup (same object references) */
    private byRequest = new Map<number, InventoryReservation>();

    /** Total reservation count */
    private _size = 0;

    private readonly inventoryManager: BuildingInventoryManager;

    constructor(inventoryManager: BuildingInventoryManager) {
        this.inventoryManager = inventoryManager;
    }

    // --- Single mutation point ---

    private addReservation(r: InventoryReservation): void {
        let byMaterial = this.store.get(r.buildingId);
        if (!byMaterial) {
            byMaterial = new Map();
            this.store.set(r.buildingId, byMaterial);
        }
        let byReq = byMaterial.get(r.materialType);
        if (!byReq) {
            byReq = new Map();
            byMaterial.set(r.materialType, byReq);
        }
        byReq.set(r.requestId, r);
        this.byRequest.set(r.requestId, r);
        this._size++;
    }

    private removeReservation(r: InventoryReservation): void {
        const byMaterial = this.store.get(r.buildingId);
        if (!byMaterial) return;
        const byReq = byMaterial.get(r.materialType);
        if (!byReq) return;
        byReq.delete(r.requestId);
        if (byReq.size === 0) {
            byMaterial.delete(r.materialType);
            if (byMaterial.size === 0) {
                this.store.delete(r.buildingId);
            }
        }
        this.byRequest.delete(r.requestId);
        this._size--;
    }

    // --- Public API ---

    /**
     * Create a reservation for inventory at a building.
     *
     * @returns The created reservation, or null if invalid or not enough inventory
     */
    createReservation(
        buildingId: number,
        materialType: EMaterialType,
        amount: number,
        requestId: number
    ): InventoryReservation | null {
        if (amount <= 0) return null;

        const actualReserved = this.inventoryManager.reserveOutput(buildingId, materialType, amount);
        if (actualReserved === 0) return null;

        const reservation: InventoryReservation = {
            buildingId,
            materialType,
            amount: actualReserved,
            requestId,
            timestamp: Date.now(),
        };

        this.addReservation(reservation);
        return reservation;
    }

    /**
     * Release the reservation for a specific request.
     * Releases both the bookkeeping AND the slot-level reservation.
     */
    releaseReservationForRequest(requestId: number): boolean {
        const reservation = this.byRequest.get(requestId);
        if (!reservation) return false;

        this.inventoryManager.releaseOutputReservation(
            reservation.buildingId,
            reservation.materialType,
            reservation.amount
        );
        this.removeReservation(reservation);
        return true;
    }

    /**
     * Remove reservation bookkeeping for a request WITHOUT releasing the slot-level reservation.
     * Used after `withdrawReservedOutput()` which already decremented `slot.reservedAmount`.
     * Calling `releaseReservationForRequest` after withdrawal would double-release the slot.
     */
    consumeReservationForRequest(requestId: number): boolean {
        const reservation = this.byRequest.get(requestId);
        if (!reservation) return false;

        this.removeReservation(reservation);
        return true;
    }

    /**
     * Get the reservation for a specific request.
     */
    getReservationForRequest(requestId: number): InventoryReservation | undefined {
        return this.byRequest.get(requestId);
    }

    /**
     * Get total reserved amount for a building and material type.
     */
    getReservedAmount(buildingId: number, materialType: EMaterialType): number {
        const byReq = this.store.get(buildingId)?.get(materialType);
        if (!byReq) return 0;

        let total = 0;
        for (const r of byReq.values()) {
            total += r.amount;
        }
        return total;
    }

    /**
     * Get available amount at a building, accounting for reservations.
     */
    getAvailableAmount(buildingId: number, materialType: EMaterialType, actualAmount: number): number {
        return Math.max(0, actualAmount - this.getReservedAmount(buildingId, materialType));
    }

    /**
     * Transfer a reservation from one building to another.
     * Used when building piles are converted to free piles — the reservation
     * moves from the destroyed building's inventory to the pile entity's inventory.
     */
    transferReservation(requestId: number, newBuildingId: number): boolean {
        const old = this.byRequest.get(requestId);
        if (!old) return false;

        // Release slot-level reservation on old building
        this.inventoryManager.releaseOutputReservation(old.buildingId, old.materialType, old.amount);

        // Reserve on new building
        const actualReserved = this.inventoryManager.reserveOutput(newBuildingId, old.materialType, old.amount);
        if (actualReserved === 0) return false;

        // Swap in the store: remove old, add updated
        this.removeReservation(old);
        const updated: InventoryReservation = { ...old, buildingId: newBuildingId, amount: actualReserved };
        this.addReservation(updated);

        return true;
    }

    /**
     * Release all reservations for a building.
     * Useful when a building is destroyed.
     */
    releaseReservationsForBuilding(buildingId: number): number {
        const byMaterial = this.store.get(buildingId);
        if (!byMaterial) return 0;

        let count = 0;
        for (const byReq of byMaterial.values()) {
            for (const r of byReq.values()) {
                this.inventoryManager.releaseOutputReservation(r.buildingId, r.materialType, r.amount);
                this.byRequest.delete(r.requestId);
                count++;
            }
        }
        this.store.delete(buildingId);
        this._size -= count;

        return count;
    }

    /**
     * Get all reservations.
     */
    *getAllReservations(): IterableIterator<InventoryReservation> {
        yield* this.byRequest.values();
    }

    /**
     * Get count of active reservations.
     */
    get size(): number {
        return this._size;
    }

    /**
     * Clear all reservations.
     */
    clear(): void {
        this.store.clear();
        this.byRequest.clear();
        this._size = 0;
    }
}
