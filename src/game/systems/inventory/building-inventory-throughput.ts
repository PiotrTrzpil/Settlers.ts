/**
 * Throughput tracking for BuildingInventoryManager.
 *
 * Extracted to keep building-inventory.ts under the file size limit.
 * Owns the persistent ThroughputMap store and all read/write operations on it.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { MaterialThroughput, ThroughputMap } from './building-inventory-helpers';
import { PersistentValue } from '@/game/persistence/persistent-store';
import { throughputSerializer, getOrCreateThroughput } from './building-inventory-helpers';

export class InventoryThroughputTracker {
    /** Cumulative throughput per (buildingId, materialType) — auto-persisted. */
    readonly throughputStore = new PersistentValue<ThroughputMap>(
        'buildingInventoryThroughput',
        new Map(),
        throughputSerializer
    );

    recordIn(buildingId: number, materialType: EMaterialType, amount: number): void {
        getOrCreateThroughput(this.throughputStore.get(), buildingId, materialType).totalIn += amount;
    }

    recordOut(buildingId: number, materialType: EMaterialType, amount: number): void {
        getOrCreateThroughput(this.throughputStore.get(), buildingId, materialType).totalOut += amount;
    }

    getThroughput(buildingId: number, materialType: EMaterialType): MaterialThroughput {
        return this.throughputStore.get().get(buildingId)?.get(materialType) ?? { totalIn: 0, totalOut: 0 };
    }

    getBuildingThroughput(buildingId: number): ReadonlyMap<EMaterialType, MaterialThroughput> {
        return this.throughputStore.get().get(buildingId) ?? new Map();
    }

    clear(): void {
        this.throughputStore.get().clear();
    }
}
