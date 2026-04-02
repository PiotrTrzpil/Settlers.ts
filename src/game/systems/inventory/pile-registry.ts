/**
 * PileRegistry
 *
 * Tracks the explicit mapping between linked pile entities and their slot identity:
 * which building they belong to, what material they hold, and whether they are an
 * input, output, construction, or storage slot.
 *
 * Used to look up pile entities by slot key and vice-versa (reverse lookup),
 * and to track which tile positions are occupied by piles for a given building.
 *
 * This registry does NOT own the entities — callers are responsible for
 * spawning/removing entities. The registry only maintains the index.
 */

import type { Tile } from '../../core/coordinates';
import type { EMaterialType } from '../../economy/material-type';
import type { Entity } from '../../entity';
import { EntityType } from '../../entity';
import type { PileKind, LinkedSlotKind } from '../../core/pile-kind';
import { isLinkedPile } from '../../core/pile-kind';

/**
 * Identifies the exact inventory slot that a pile entity represents.
 * For construction piles, pileIndex distinguishes multiple piles of the same material
 * (each capped at 8 items). Default 0 for non-construction piles.
 */
export interface PileSlotKey {
    buildingId: number;
    material: EMaterialType;
    slotKind: LinkedSlotKind;
    pileIndex?: number;
}

/**
 * Minimal interface for pile kind queries during HMR / save-load rebuild.
 * Satisfied by BuildingInventoryManager.
 */
export interface PileKindProvider {
    getPileKind(entityId: number): PileKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key serialization
// ─────────────────────────────────────────────────────────────────────────────

function serializeKey(key: PileSlotKey): string {
    // eslint-disable-next-line no-restricted-syntax -- pileIndex is optional on PileSlotKey; 0 is the correct default when no disambiguation index is set
    const idx = key.pileIndex ?? 0;
    return `${key.buildingId}:${key.slotKind}:${key.material}:${idx}`;
}

function deserializeKey(s: string): PileSlotKey {
    const parts = s.split(':');
    // Support both old 3-part keys and new 4-part keys (with pileIndex)
    if (parts.length !== 3 && parts.length !== 4) {
        throw new Error(`PileRegistry: cannot deserialize invalid key "${s}"`);
    }
    const [buildingIdStr, slotKind, materialStr] = parts as [string, string, string];
    const buildingId = parseInt(buildingIdStr, 10);
    const material = materialStr as EMaterialType;
    if (isNaN(buildingId) || !materialStr) {
        throw new Error(`PileRegistry: key "${s}" contains invalid buildingId or material`);
    }
    const rawIndex = parts.length === 4 ? parseInt(parts[3]!, 10) : 0;
    const pileIndex = rawIndex > 0 ? rawIndex : undefined;
    return { buildingId, material, slotKind: slotKind as LinkedSlotKind, pileIndex };
}

function makeTileKey(x: number, y: number): string {
    return `${x},${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PileRegistry
// ─────────────────────────────────────────────────────────────────────────────

export class PileRegistry {
    /** serializedKey → entityId */
    private forward = new Map<string, number>();
    /** entityId → serializedKey */
    private reverse = new Map<number, string>();
    /** entityId → TileKey string (for position cleanup on deregister) */
    private entityPosition = new Map<number, string>();
    /** buildingId → (serializedKey → entityId) */
    private linked = new Map<number, Map<string, number>>();
    /** buildingId → Set<TileKey> */
    private positions = new Map<number, Set<string>>();

    // ─── Registration ────────────────────────────────────────────────────────

    /**
     * Register a linked pile entity.
     * Throws if the slot key is already registered — this indicates a double-spawn bug.
     */
    register(entityId: number, key: PileSlotKey, position: Tile): void {
        const s = serializeKey(key);

        if (this.forward.has(s)) {
            throw new Error(`PileRegistry: key ${s} already registered (double-spawn bug)`);
        }

        this.forward.set(s, entityId);
        this.reverse.set(entityId, s);
        this.entityPosition.set(entityId, makeTileKey(position.x, position.y));

        // Update linked index
        let buildingLinked = this.linked.get(key.buildingId);
        if (!buildingLinked) {
            buildingLinked = new Map<string, number>();
            this.linked.set(key.buildingId, buildingLinked);
        }
        buildingLinked.set(s, entityId);

        // Update positions index
        let buildingPositions = this.positions.get(key.buildingId);
        if (!buildingPositions) {
            buildingPositions = new Set<string>();
            this.positions.set(key.buildingId, buildingPositions);
        }
        buildingPositions.add(makeTileKey(position.x, position.y));
    }

    /**
     * Remove a pile entity from the registry.
     * Silent no-op if the entityId is not registered.
     */
    deregister(entityId: number): void {
        const s = this.reverse.get(entityId);
        if (!s) {
            return;
        }

        this.reverse.delete(entityId);
        this.forward.delete(s);

        const posKey = this.entityPosition.get(entityId);
        this.entityPosition.delete(entityId);

        const key = deserializeKey(s);

        const buildingLinked = this.linked.get(key.buildingId);
        if (buildingLinked) {
            buildingLinked.delete(s);
            if (buildingLinked.size === 0) {
                this.linked.delete(key.buildingId);
            }
        }

        if (posKey !== undefined) {
            const buildingPositions = this.positions.get(key.buildingId);
            if (buildingPositions) {
                buildingPositions.delete(posKey);
                if (buildingPositions.size === 0) {
                    this.positions.delete(key.buildingId);
                }
            }
        }
    }

    // ─── Lookup ──────────────────────────────────────────────────────────────

    /** Forward lookup: slot key → entity id */
    getEntityId(key: PileSlotKey): number | undefined {
        return this.forward.get(serializeKey(key));
    }

    /** Reverse lookup: entity id → slot key */
    getKey(entityId: number): PileSlotKey | undefined {
        const s = this.reverse.get(entityId);
        if (!s) {
            return undefined;
        }
        return deserializeKey(s);
    }

    /**
     * All linked pile entities for a building.
     * Returns a ReadonlyMap of serialized key → entity id.
     */
    getLinkedEntities(buildingId: number): ReadonlyMap<string, number> {
        return this.linked.get(buildingId) ?? new Map<string, number>();
    }

    /**
     * All tile positions occupied by piles for a building.
     * Returns a ReadonlySet of TileKey strings (`"x,y"`).
     */
    getUsedPositions(buildingId: number): ReadonlySet<string> {
        return this.positions.get(buildingId) ?? new Set<string>();
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Remove all registered pile entries for a building.
     * Returns a copy of the linked map (serialized key → entity id) so the caller can
     * decide whether to remove the entities or convert them to free piles.
     *
     * Returns an empty map if the building is not registered — callers need not guard.
     */
    clearBuilding(buildingId: number): ReadonlyMap<string, number> {
        const buildingLinked = this.linked.get(buildingId);
        if (!buildingLinked || buildingLinked.size === 0) {
            return new Map<string, number>();
        }

        // Snapshot before mutating
        const snapshot = new Map<string, number>(buildingLinked);

        for (const entityId of snapshot.values()) {
            this.deregister(entityId);
        }

        return snapshot;
    }

    /**
     * Rebuild the entire index from a list of entities and a PileKind provider.
     *
     * Used during HMR and save-load restores. Calls clear() first, then re-registers
     * every StackedPile entity whose kind is linked (non-free).
     */
    rebuildFromEntities(entities: readonly Entity[], resources: PileKindProvider): void {
        this.clear();

        // Track pile indices per (building, material, kind) for disambiguation
        const pileIndices = new Map<string, number>();

        for (const entity of entities) {
            if (entity.type !== EntityType.StackedPile) {
                continue;
            }

            const kind = resources.getPileKind(entity.id);
            if (!isLinkedPile(kind)) {
                continue;
            }

            const counterKey = `${kind.buildingId}:${entity.subType}:${kind.kind}`;
            // eslint-disable-next-line no-restricted-syntax -- Map starts empty; 0 is the correct starting index for the first pile of a given (building, material, kind) combination
            const idx = pileIndices.get(counterKey) ?? 0;
            const pileIndex = idx > 0 ? idx : undefined;
            pileIndices.set(counterKey, idx + 1);

            const key: PileSlotKey = {
                buildingId: kind.buildingId,
                material: entity.subType as EMaterialType,
                slotKind: kind.kind,
                pileIndex,
            };
            this.register(entity.id, key, { x: entity.x, y: entity.y });
        }
    }

    /**
     * Reset the registry to empty state.
     */
    clear(): void {
        this.forward.clear();
        this.reverse.clear();
        this.entityPosition.clear();
        this.linked.clear();
        this.positions.clear();
    }
}
