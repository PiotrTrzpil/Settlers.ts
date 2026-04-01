import { EMaterialType } from '../../economy/material-type';
import { PersistentMap } from '@/game/persistence/persistent-store';

/** Direction control for a material in a StorageArea. */
export enum StorageDirection {
    /** Carriers may deliver this material here, but won't pick it up for other buildings. */
    Import = 1,
    /** Carriers may pick this material up, but won't deliver more here. */
    Export = 2,
    /** Carriers may both deliver and pick up this material. */
    Both = 3,
}

/** Per-building filter config: maps material type → direction. */
export type FilterConfig = Map<EMaterialType, StorageDirection>;

const EMPTY_MAP: ReadonlyMap<EMaterialType, StorageDirection> = new Map();

/**
 * Tracks per-building material direction settings for StorageArea buildings.
 *
 * Default state: empty map — a newly placed StorageArea accepts nothing
 * until the player explicitly configures it.
 */
export class StorageFilterManager {
    readonly persistentStore = new PersistentMap<FilterConfig>('storageFilters');

    /** Set a material's direction for a building. Map is created lazily. */
    setDirection(buildingId: number, material: EMaterialType, direction: StorageDirection): void {
        let map = this.persistentStore.get(buildingId);
        if (!map) {
            map = new Map();
            this.persistentStore.set(buildingId, map);
        }
        map.set(material, direction);
    }

    /** Remove a material from a building's filter (disables it). */
    disallow(buildingId: number, material: EMaterialType): void {
        this.persistentStore.get(buildingId)?.delete(material);
    }

    /** Returns the direction for a material, or null if not configured (disabled). */
    getDirection(buildingId: number, material: EMaterialType): StorageDirection | undefined {
        return this.persistentStore.get(buildingId)?.get(material);
    }

    /**
     * Returns true if the material is allowed for import (Import or Both).
     */
    isImportAllowed(buildingId: number, material: EMaterialType): boolean {
        const dir = this.getDirection(buildingId, material);
        return dir === StorageDirection.Import || dir === StorageDirection.Both;
    }

    /**
     * Returns true if the material is allowed for export (Export or Both).
     */
    isExportAllowed(buildingId: number, material: EMaterialType): boolean {
        const dir = this.getDirection(buildingId, material);
        return dir === StorageDirection.Export || dir === StorageDirection.Both;
    }

    /**
     * Legacy compat: returns true if the material has any direction set.
     */
    isAllowed(buildingId: number, material: EMaterialType): boolean {
        // eslint-disable-next-line no-restricted-syntax -- building may have no storage filter config; false is the correct default (material not configured means not allowed)
        return this.persistentStore.get(buildingId)?.has(material) ?? false;
    }

    /**
     * Returns the direction map for a building (empty map if not configured).
     */
    getDirections(buildingId: number): ReadonlyMap<EMaterialType, StorageDirection> {
        return this.persistentStore.get(buildingId) ?? EMPTY_MAP;
    }

    /**
     * Called on building destruction to free memory.
     */
    removeBuilding(buildingId: number): void {
        this.persistentStore.delete(buildingId);
    }

    /**
     * Clear all filter state.
     */
    clear(): void {
        this.persistentStore.clear();
    }
}
