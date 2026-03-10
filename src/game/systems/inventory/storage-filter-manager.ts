import { EMaterialType } from '../../economy/material-type';
import type { Persistable } from '@/game/persistence';
import type { SerializedStorageFilter } from '@/game/state/game-state-persistence';

/** Direction control for a material in a StorageArea. */
export enum StorageDirection {
    /** Carriers may deliver this material here, but won't pick it up for other buildings. */
    Import = 1,
    /** Carriers may pick this material up, but won't deliver more here. */
    Export = 2,
    /** Carriers may both deliver and pick up this material. */
    Both = 3,
}

const EMPTY_MAP: ReadonlyMap<EMaterialType, StorageDirection> = new Map();

/**
 * Tracks per-building material direction settings for StorageArea buildings.
 *
 * Default state: empty map — a newly placed StorageArea accepts nothing
 * until the player explicitly configures it.
 */
export class StorageFilterManager implements Persistable<SerializedStorageFilter[]> {
    readonly persistKey = 'storageFilters' as const;
    private readonly _filters = new Map<number, Map<EMaterialType, StorageDirection>>();

    /** Set a material's direction for a building. Map is created lazily. */
    setDirection(buildingId: number, material: EMaterialType, direction: StorageDirection): void {
        let map = this._filters.get(buildingId);
        if (!map) {
            map = new Map();
            this._filters.set(buildingId, map);
        }
        map.set(material, direction);
    }

    /** Remove a material from a building's filter (disables it). */
    disallow(buildingId: number, material: EMaterialType): void {
        this._filters.get(buildingId)?.delete(material);
    }

    /** Returns the direction for a material, or null if not configured (disabled). */
    getDirection(buildingId: number, material: EMaterialType): StorageDirection | null {
        return this._filters.get(buildingId)?.get(material) ?? null;
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
        return this._filters.get(buildingId)?.has(material) ?? false;
    }

    /**
     * Returns the direction map for a building (empty map if not configured).
     */
    getDirections(buildingId: number): ReadonlyMap<EMaterialType, StorageDirection> {
        return this._filters.get(buildingId) ?? EMPTY_MAP;
    }

    /**
     * Called on building destruction to free memory.
     */
    removeBuilding(buildingId: number): void {
        this._filters.delete(buildingId);
    }

    /**
     * Clear all filter state.
     */
    clear(): void {
        this._filters.clear();
    }

    // ── Persistable ───────────────────────────────────────────────

    serialize(): SerializedStorageFilter[] {
        const result: SerializedStorageFilter[] = [];
        for (const [buildingId, directions] of this._filters) {
            const materials: number[] = [];
            const dirs: number[] = [];
            for (const [mat, dir] of directions) {
                materials.push(mat);
                dirs.push(dir);
            }
            result.push({ buildingId, materials, directions: dirs });
        }
        return result;
    }

    deserialize(data: SerializedStorageFilter[]): void {
        this._filters.clear();
        for (const entry of data) {
            const map = new Map<EMaterialType, StorageDirection>();
            for (let i = 0; i < entry.materials.length; i++) {
                // Legacy format: no directions array → default to Both
                const dir = entry.directions?.[i] ?? StorageDirection.Both;
                map.set(entry.materials[i] as EMaterialType, dir);
            }
            this._filters.set(entry.buildingId, map);
        }
    }
}
