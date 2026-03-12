/**
 * StackedPileManager — owns stacked resource state (quantities, pile kind/ownership).
 *
 * Extracted from GameState per design-rules.md Rule 5.1: feature-specific state
 * should not live inside the entity store.
 */

import type { StackedPileState } from '../entity';
import { MAX_PILE_SIZE, EntityType, type Entity, type EntityProvider } from '../entity';
import type { EMaterialType } from '../economy';
import { type PileKind, getOwnerBuildingId, SlotKind } from '../core/pile-kind';
import { type ComponentStore, mapStore } from '../ecs';
import type { Persistable } from '@/game/persistence';
import type { SpatialGrid } from '../spatial-grid';

type SerializedResourceQuantity = { entityId: number; quantity: number };

export class StackedPileManager implements Persistable<SerializedResourceQuantity[]> {
    readonly persistKey = 'resourceQuantities' as const;

    /** Stacked resource state tracking (quantity of items in each stack) */
    public readonly states: Map<number, StackedPileState> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<StackedPileState> = mapStore(this.states);

    private spatialIndex?: SpatialGrid;

    constructor(private entityProvider: EntityProvider) {}

    /** Inject spatial index for fast proximity queries. Called after SpatialGrid is created. */
    initSpatialIndex(index: SpatialGrid): void {
        this.spatialIndex = index;
    }

    /** Create initial state for a new stacked resource entity. */
    createState(entityId: number, kind: PileKind = { kind: SlotKind.Free }): void {
        this.states.set(entityId, { entityId, quantity: 1, kind });
    }

    /** Remove state when a stacked resource entity is deleted. */
    removeState(entityId: number): void {
        this.states.delete(entityId);
    }

    /** Set the pile kind for a stacked resource. */
    setKind(entityId: number, kind: PileKind): void {
        const state = this.states.get(entityId);
        if (state) state.kind = kind;
    }

    /**
     * Get the pile kind for a stacked resource.
     * Throws if the entity is unknown.
     */
    getKind(entityId: number): PileKind {
        const state = this.states.get(entityId);
        if (!state) throw new Error(`StackedPileManager.getKind: unknown entity ${entityId}`);
        return state.kind;
    }

    /** Returns true if the pile is linked to a building (i.e. not free). */
    isLinked(entityId: number): boolean {
        const state = this.states.get(entityId);
        return state !== undefined && state.kind.kind !== SlotKind.Free;
    }

    /**
     * Get the building ID that owns this pile.
     * Returns undefined if the pile is free or the entity is unknown.
     */
    getOwnerBuildingId(entityId: number): number | undefined {
        const state = this.states.get(entityId);
        if (!state) return undefined;
        return getOwnerBuildingId(state.kind);
    }

    /** Set the quantity of resources in a stack directly. */
    setQuantity(entityId: number, quantity: number): void {
        const state = this.states.get(entityId);
        if (state) {
            state.quantity = Math.min(quantity, MAX_PILE_SIZE);
        }
    }

    /** Get the quantity of resources in a stack. Returns 0 if entity is unknown. */
    getQuantity(entityId: number): number {
        const state = this.states.get(entityId);
        return state?.quantity ?? 0;
    }

    /**
     * Find the nearest free stacked resource of the given material type within radius.
     * Only considers piles where kind.kind === 'free' (not linked to any building).
     *
     * When `player` is provided and a spatial index is available, uses the
     * territory-aware spatial hash to avoid scanning all entities.
     */
    findNearestFree(
        x: number,
        y: number,
        material: EMaterialType,
        radius: number,
        player?: number
    ): Entity | undefined {
        let nearest: Entity | undefined;
        let minDistSq = radius * radius;

        const candidates =
            this.spatialIndex && player !== undefined
                ? this.spatialIndex.nearbyForPlayer(x, y, radius, player)
                : this.entityProvider.entities;

        for (const entity of candidates) {
            if (entity.type !== EntityType.StackedPile) continue;
            if (entity.subType !== material) continue;
            const state = this.states.get(entity.id);
            if (!state || state.kind.kind !== SlotKind.Free) continue;

            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = entity;
            }
        }
        return nearest;
    }

    // ── Persistable ───────────────────────────────────────────────

    serialize(): SerializedResourceQuantity[] {
        const result: SerializedResourceQuantity[] = [];
        for (const [entityId, state] of this.states) {
            result.push({ entityId, quantity: state.quantity });
        }
        return result;
    }

    deserialize(data: SerializedResourceQuantity[]): void {
        this.states.clear();
        for (const rq of data) {
            // Create state with default Free kind — BuildingInventoryManager.restoreComplete()
            // will assign the correct PileKind after all persistables are restored.
            this.states.set(rq.entityId, {
                entityId: rq.entityId,
                quantity: rq.quantity,
                kind: { kind: SlotKind.Free },
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deprecated wrappers — will be removed in integration pass
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @deprecated Use setKind instead.
     * Maps buildingId to { kind: 'output', buildingId } or { kind: 'free' } when undefined.
     */
    setBuildingId(entityId: number, buildingId: number | undefined): void {
        this.setKind(
            entityId,
            buildingId !== undefined ? { kind: SlotKind.Output, buildingId } : { kind: SlotKind.Free }
        );
    }

    /** @deprecated Use getOwnerBuildingId instead. */
    getBuildingId(entityId: number): number | undefined {
        return this.getOwnerBuildingId(entityId);
    }

    /** @deprecated Use findNearestFree instead. */
    findNearestPile(x: number, y: number, materialType: EMaterialType, radius: number): Entity | undefined {
        return this.findNearestFree(x, y, materialType, radius);
    }
}
