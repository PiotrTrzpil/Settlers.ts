/**
 * PileStatesView — a derived ReadonlyMap<entityId, StackedPileState> backed by
 * BuildingInventoryManager's slot data.
 *
 * Eliminates dual-state desync by
 * making pile state a live view over the single source of truth (inventory slots).
 *
 * Caches StackedPileState objects to avoid per-frame allocation — the renderer
 * calls `.get(entityId)` every frame for every visible pile. A cached entry is
 * reused when the slot hasn't changed (same slotId and currentAmount).
 */

import type { StackedPileState } from '../../entity';
import type { PileSlot } from './pile-slot';
import { buildPileKind } from './building-inventory-helpers';

/** Minimal interface for the data sources PileStatesView needs. */
export interface PileStatesDataSource {
    /** Reverse index: entityId → slotId */
    readonly entityIndex: ReadonlyMap<number, number>;
    /** Primary slot store: slotId → PileSlot */
    getSlot(slotId: number): PileSlot | undefined;
}

/** Construct a StackedPileState from a PileSlot (on-the-fly). */
function slotToState(slot: PileSlot): StackedPileState {
    return {
        entityId: slot.entityId!,
        quantity: slot.currentAmount,
        kind: buildPileKind(slot),
    };
}

interface CachedEntry {
    state: StackedPileState;
    slotId: number;
    amount: number;
}

/**
 * Live read-only Map view that derives StackedPileState from inventory slots.
 * The renderer reads this via `.get(entityId)` each frame.
 *
 * Extends Map to satisfy the ReadonlyMap interface (including MapIterator return
 * types required by ESNext lib). Mutating methods throw to enforce read-only access.
 *
 * Invariant: entityIndex only contains entries where the slot has a live entity
 * (entityId !== null, currentAmount > 0). This is maintained by deposit/withdraw/
 * registerFreePile/onPileEntityRemoved — so get/has/size trust the index directly.
 */
export class PileStatesView extends Map<number, StackedPileState> {
    private readonly _cache = new Map<number, CachedEntry>();

    constructor(private readonly source: PileStatesDataSource) {
        super();
    }

    override get(entityId: number): StackedPileState | undefined {
        const slotId = this.source.entityIndex.get(entityId);
        if (slotId === undefined) {
            return undefined;
        }
        const slot = this.source.getSlot(slotId);
        if (!slot) {
            throw new Error(`Slot ${slotId} not found in slotStore [PileStatesView.get(${entityId})]`);
        }
        const cached = this._cache.get(entityId);
        if (cached && cached.slotId === slotId && cached.amount === slot.currentAmount) {
            return cached.state;
        }
        const state = slotToState(slot);
        this._cache.set(entityId, { state, slotId, amount: slot.currentAmount });
        return state;
    }

    override has(entityId: number): boolean {
        return this.source.entityIndex.has(entityId);
    }

    override get size(): number {
        return this.source.entityIndex.size;
    }

    override forEach(
        callbackfn: (value: StackedPileState, key: number, map: Map<number, StackedPileState>) => void
    ): void {
        for (const [key, value] of this.entries()) {
            callbackfn(value, key, this);
        }
    }

    override *entries(): MapIterator<[number, StackedPileState]> {
        for (const entityId of this.source.entityIndex.keys()) {
            const state = this.get(entityId);
            if (!state) {
                throw new Error(`PileStatesView.entries: entity ${entityId} in index but get() returned undefined`);
            }
            yield [entityId, state];
        }
    }

    override *keys(): MapIterator<number> {
        for (const entityId of this.source.entityIndex.keys()) {
            yield entityId;
        }
    }

    override *values(): MapIterator<StackedPileState> {
        for (const entityId of this.source.entityIndex.keys()) {
            const state = this.get(entityId);
            if (!state) {
                throw new Error(`PileStatesView.values: entity ${entityId} in index but get() returned undefined`);
            }
            yield state;
        }
    }

    override [Symbol.iterator](): MapIterator<[number, StackedPileState]> {
        return this.entries();
    }

    // Block mutations — this is a derived view, not a writable Map.
    override set(_key: number, _value: StackedPileState): this {
        throw new Error('PileStatesView is read-only');
    }

    override delete(_key: number): boolean {
        throw new Error('PileStatesView is read-only');
    }

    override clear(): void {
        throw new Error('PileStatesView is read-only');
    }
}
