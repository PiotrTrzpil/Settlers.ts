import type { EMaterialType } from '../../economy/material-type';
import { PersistentValue, type StoreSerializer } from '../../persistence/persistent-store';

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

/** Serialized form of a single in-flight entry. */
export interface InFlightEntry {
    buildingId: number;
    material: EMaterialType;
    amount: number;
}

/** Internal nested map type: buildingId → material → count. */
type InFlightCounts = Map<number, Map<EMaterialType, number>>;

/** Custom serializer: nested maps ↔ flat array of InFlightEntry. */
const inFlightSerializer: StoreSerializer<InFlightCounts> = {
    serialize(counts: InFlightCounts): InFlightEntry[] {
        const entries: InFlightEntry[] = [];
        for (const [buildingId, materialMap] of counts) {
            for (const [material, amount] of materialMap) {
                entries.push({ buildingId, material, amount });
            }
        }
        return entries;
    },
    deserialize(raw: unknown): InFlightCounts {
        const entries = raw as InFlightEntry[];
        const counts: InFlightCounts = new Map();
        for (const { buildingId, material, amount } of entries) {
            let materialMap = counts.get(buildingId);
            if (!materialMap) {
                materialMap = new Map();
                counts.set(buildingId, materialMap);
            }
            materialMap.set(material, (materialMap.get(material) ?? 0) + amount);
        }
        return counts;
    },
};

/**
 * Simple Map-based implementation of InFlightTracker.
 * Keyed by destBuilding → material → count.
 *
 * Exposes a PersistentValue store that serializes the nested map to a flat array.
 */
export class InFlightTrackerImpl implements InFlightTracker {
    private readonly counts = new Map<number, Map<EMaterialType, number>>();

    /** Persistence store — add to feature's persistence array. */
    readonly persistenceStore: PersistentValue<InFlightCounts>;

    constructor() {
        this.persistenceStore = new PersistentValue<InFlightCounts>('inFlightTracking', this.counts, {
            serialize: () => inFlightSerializer.serialize(this.counts),
            deserialize: (raw: unknown) => {
                const restored = inFlightSerializer.deserialize(raw);
                this.counts.clear();
                for (const [k, v] of restored) {
                    this.counts.set(k, v);
                }
                return this.counts;
            },
        });
    }

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
