import type { EMaterialType } from '../../economy/material-type';

/**
 * Tracks how many units of each material are currently being carried TO each building.
 * Incremented when carrier picks up, decremented on delivery/cancel/drop.
 *
 * Complementary to source-side reservations — this provides destination-side awareness
 * to prevent over-dispatch and help cap construction request creation.
 */
export interface InFlightTracker {
    /** Record that a carrier picked up material heading to destBuilding. */
    recordPickup(destBuilding: number, material: EMaterialType, amount: number): void;
    /** Record that material was delivered (or dropped/cancelled) for destBuilding. */
    recordResolved(destBuilding: number, material: EMaterialType, amount: number): void;
    /** Get total in-flight amount for a building+material. */
    getInFlightAmount(destBuilding: number, material: EMaterialType): number;
}

/**
 * Simple Map-based implementation of InFlightTracker.
 * Keyed by destBuilding → material → count.
 */
export class InFlightTrackerImpl implements InFlightTracker {
    private readonly counts = new Map<number, Map<EMaterialType, number>>();

    recordPickup(destBuilding: number, material: EMaterialType, amount: number): void {
        let materialMap = this.counts.get(destBuilding);
        if (!materialMap) {
            materialMap = new Map();
            this.counts.set(destBuilding, materialMap);
        }
        const current = materialMap.get(material) ?? 0;
        materialMap.set(material, current + amount);
    }

    recordResolved(destBuilding: number, material: EMaterialType, amount: number): void {
        const materialMap = this.counts.get(destBuilding);
        if (!materialMap) return;
        const current = materialMap.get(material) ?? 0;
        const next = current - amount;
        if (next <= 0) {
            materialMap.delete(material);
            if (materialMap.size === 0) {
                this.counts.delete(destBuilding);
            }
        } else {
            materialMap.set(material, next);
        }
    }

    getInFlightAmount(destBuilding: number, material: EMaterialType): number {
        return this.counts.get(destBuilding)?.get(material) ?? 0;
    }
}
