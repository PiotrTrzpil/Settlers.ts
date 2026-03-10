import { EMaterialType } from '../../economy/material-type';
import type { Persistable } from '@/game/persistence';
import type { SerializedStorageFilter } from '@/game/state/game-state-persistence';

const EMPTY_SET: ReadonlySet<EMaterialType> = new Set();

/**
 * Tracks per-building material allow-lists for StorageArea buildings.
 *
 * Default state: empty set — a newly placed StorageArea accepts nothing
 * until the player explicitly configures it.
 */
export class StorageFilterManager implements Persistable<SerializedStorageFilter[]> {
    readonly persistKey = 'storageFilters' as const;
    private readonly _filters = new Map<number, Set<EMaterialType>>();

    /** Allow a material for a building. Set is created lazily. */
    allow(buildingId: number, material: EMaterialType): void {
        let set = this._filters.get(buildingId);
        if (!set) {
            set = new Set();
            this._filters.set(buildingId, set);
        }
        set.add(material);
    }

    /** Disallow a material for a building. No-op if not configured. */
    disallow(buildingId: number, material: EMaterialType): void {
        this._filters.get(buildingId)?.delete(material);
    }

    /**
     * Returns true if the material is in the building's allowed set.
     * Returns false if the building has no configuration (empty set = nothing allowed).
     */
    isAllowed(buildingId: number, material: EMaterialType): boolean {
        return this._filters.get(buildingId)?.has(material) ?? false;
    }

    /**
     * Returns the allowed set for a building (empty set if not configured).
     */
    getAllowedMaterials(buildingId: number): ReadonlySet<EMaterialType> {
        return this._filters.get(buildingId) ?? EMPTY_SET;
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
        for (const [buildingId, materials] of this._filters) {
            result.push({ buildingId, materials: [...materials] as number[] });
        }
        return result;
    }

    deserialize(data: SerializedStorageFilter[]): void {
        this._filters.clear();
        for (const entry of data) {
            this._filters.set(entry.buildingId, new Set(entry.materials as EMaterialType[]));
        }
    }
}
