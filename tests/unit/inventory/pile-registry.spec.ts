/**
 * Unit tests for PileRegistry.
 *
 * Pure unit tests — no game state, no simulation, no XML loading.
 * All dependencies are plain objects or simple mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PileRegistry, type PileSlotKey } from '@/game/features/inventory/pile-registry';
import { EMaterialType } from '@/game/economy/material-type';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/race';
import type { Entity } from '@/game/entity';
import type { PileKind } from '@/game/features/inventory/pile-kind';
import { SlotKind } from '@/game/features/inventory/pile-kind';
import type { PileKindProvider } from '@/game/features/inventory/pile-registry';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeKey(buildingId: number, material: EMaterialType, slotKind: PileSlotKey['slotKind']): PileSlotKey {
    return { buildingId, material, slotKind };
}

function makeStackedResourceEntity(id: number, x: number, y: number, material: EMaterialType): Entity {
    return {
        id,
        type: EntityType.StackedPile,
        x,
        y,
        player: 0,
        subType: material,
        race: Race.Roman,
    };
}

function makeNonResourceEntity(id: number): Entity {
    return {
        id,
        type: EntityType.Unit,
        x: 0,
        y: 0,
        player: 0,
        subType: 0,
        race: Race.Roman,
    };
}

/** Create a mock PileKindProvider that maps entityId → PileKind */
function makeMockResources(kindMap: Map<number, PileKind>): PileKindProvider {
    return {
        getKind(entityId: number): PileKind {
            const kind = kindMap.get(entityId);
            if (!kind) throw new Error(`MockResources: unknown entity ${entityId}`);
            return kind;
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PileRegistry', () => {
    let registry: PileRegistry;

    beforeEach(() => {
        registry = new PileRegistry();
    });

    // ─── register + getEntityId ──────────────────────────────────────────────

    it('register + getEntityId returns entity', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        expect(registry.getEntityId(key)).toBe(1);
    });

    it('getEntityId returns undefined for unknown key', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        expect(registry.getEntityId(key)).toBeUndefined();
    });

    // ─── getKey (reverse lookup) ─────────────────────────────────────────────

    it('getKey(entityId) returns key after register', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        const result = registry.getKey(1);
        expect(result).toEqual(key);
    });

    it('getKey returns undefined for unknown entityId', () => {
        expect(registry.getKey(999)).toBeUndefined();
    });

    // ─── double-spawn detection ──────────────────────────────────────────────

    it('register with duplicate key throws', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        expect(() => registry.register(2, key, { x: 6, y: 4 })).toThrow('already registered (double-spawn bug)');
    });

    it('registering same entityId under a different key does not throw', () => {
        // Different key — no conflict
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.BOARD, SlotKind.Output);
        registry.register(1, keyA, { x: 5, y: 3 });
        expect(() => registry.register(2, keyB, { x: 6, y: 4 })).not.toThrow();
    });

    // ─── deregister ─────────────────────────────────────────────────────────

    it('deregister removes from forward map, reverse map, and usedPositions', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        registry.deregister(1);

        expect(registry.getEntityId(key)).toBeUndefined();
        expect(registry.getKey(1)).toBeUndefined();
        expect(registry.getUsedPositions(10).has('5,3')).toBe(false);
    });

    it('deregister is a no-op for unknown entityId', () => {
        // Should not throw
        expect(() => registry.deregister(9999)).not.toThrow();
    });

    it('deregister removes entity from getLinkedEntities', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        registry.deregister(1);

        expect(registry.getLinkedEntities(10).size).toBe(0);
    });

    it('deregister only removes its own position from usedPositions when two piles share a building', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });

        registry.deregister(1);

        const positions = registry.getUsedPositions(10);
        expect(positions.has('5,3')).toBe(false);
        expect(positions.has('6,4')).toBe(true);
    });

    // ─── clearBuilding ───────────────────────────────────────────────────────

    it('clearBuilding returns all entries for that building; entries for other buildings survive', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        const keyC = makeKey(20, EMaterialType.BOARD, SlotKind.Input);

        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });
        registry.register(3, keyC, { x: 7, y: 8 });

        const cleared = registry.clearBuilding(10);

        // Returns exactly the two entries for building 10
        expect(cleared.size).toBe(2);
        const ids = new Set(cleared.values());
        expect(ids.has(1)).toBe(true);
        expect(ids.has(2)).toBe(true);

        // Building 10 is gone from the registry
        expect(registry.getEntityId(keyA)).toBeUndefined();
        expect(registry.getEntityId(keyB)).toBeUndefined();
        expect(registry.getLinkedEntities(10).size).toBe(0);

        // Building 20 is unaffected
        expect(registry.getEntityId(keyC)).toBe(3);
        expect(registry.getLinkedEntities(20).size).toBe(1);
    });

    it('clearBuilding returns empty map for unknown buildingId', () => {
        const result = registry.clearBuilding(999);
        expect(result.size).toBe(0);
    });

    it('clearBuilding clears usedPositions for the building', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        registry.clearBuilding(10);

        expect(registry.getUsedPositions(10).size).toBe(0);
    });

    // ─── getUsedPositions ────────────────────────────────────────────────────

    it('getUsedPositions reflects registered pile positions', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });

        const positions = registry.getUsedPositions(10);
        expect(positions.has('5,3')).toBe(true);
        expect(positions.has('6,4')).toBe(true);
        expect(positions.size).toBe(2);
    });

    it('getUsedPositions returns empty set for unknown buildingId', () => {
        expect(registry.getUsedPositions(999).size).toBe(0);
    });

    // ─── getLinkedEntities ───────────────────────────────────────────────────

    it('getLinkedEntities returns empty map for unknown buildingId', () => {
        expect(registry.getLinkedEntities(999).size).toBe(0);
    });

    it('getLinkedEntities returns all entities for a building', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });

        const linked = registry.getLinkedEntities(10);
        expect(linked.size).toBe(2);

        const ids = new Set(linked.values());
        expect(ids.has(1)).toBe(true);
        expect(ids.has(2)).toBe(true);
    });

    // ─── rebuildFromEntities ─────────────────────────────────────────────────

    it('rebuildFromEntities: after clear(), scan entities → index fully restored', () => {
        const material = EMaterialType.LOG;
        const entity = makeStackedResourceEntity(42, 5, 3, material);
        const kind: PileKind = { kind: SlotKind.Input, buildingId: 10 };
        const resources = makeMockResources(new Map([[42, kind]]));

        registry.rebuildFromEntities([entity], resources);

        const key = makeKey(10, material, SlotKind.Input);
        expect(registry.getEntityId(key)).toBe(42);
        expect(registry.getKey(42)).toEqual(key);
        expect(registry.getUsedPositions(10).has('5,3')).toBe(true);
        expect(registry.getLinkedEntities(10).size).toBe(1);
    });

    it('rebuildFromEntities clears existing state before rebuilding', () => {
        // Pre-populate with stale data
        const staleKey = makeKey(99, EMaterialType.STONE, SlotKind.Output);
        registry.register(1, staleKey, { x: 1, y: 1 });

        const entity = makeStackedResourceEntity(42, 5, 3, EMaterialType.LOG);
        const kind: PileKind = { kind: SlotKind.Input, buildingId: 10 };
        const resources = makeMockResources(new Map([[42, kind]]));

        registry.rebuildFromEntities([entity], resources);

        // Stale entry is gone
        expect(registry.getEntityId(staleKey)).toBeUndefined();
        expect(registry.getKey(1)).toBeUndefined();

        // New entry is present
        expect(registry.getEntityId(makeKey(10, EMaterialType.LOG, SlotKind.Input))).toBe(42);
    });

    it('rebuildFromEntities skips kind: free entities', () => {
        const entity = makeStackedResourceEntity(7, 2, 2, EMaterialType.STONE);
        const kind: PileKind = { kind: SlotKind.Free };
        const resources = makeMockResources(new Map([[7, kind]]));

        registry.rebuildFromEntities([entity], resources);

        expect(registry.getKey(7)).toBeUndefined();
        expect(registry.getLinkedEntities(0).size).toBe(0);
    });

    it('rebuildFromEntities skips non-StackedResource entities', () => {
        const unit = makeNonResourceEntity(5);
        // resources.getKind should never be called for non-StackedResource
        const resources = makeMockResources(new Map());

        registry.rebuildFromEntities([unit], resources);

        expect(registry.getKey(5)).toBeUndefined();
    });

    it('rebuildFromEntities handles multiple entities across multiple buildings', () => {
        const entA = makeStackedResourceEntity(1, 5, 3, EMaterialType.LOG);
        const entB = makeStackedResourceEntity(2, 6, 4, EMaterialType.STONE);
        const entC = makeStackedResourceEntity(3, 7, 8, EMaterialType.BOARD);

        const kindMap = new Map<number, PileKind>([
            [1, { kind: SlotKind.Input, buildingId: 10 }],
            [2, { kind: SlotKind.Output, buildingId: 10 }],
            [3, { kind: SlotKind.Construction, buildingId: 20 }],
        ]);
        const resources = makeMockResources(kindMap);

        registry.rebuildFromEntities([entA, entB, entC], resources);

        expect(registry.getEntityId(makeKey(10, EMaterialType.LOG, SlotKind.Input))).toBe(1);
        expect(registry.getEntityId(makeKey(10, EMaterialType.STONE, SlotKind.Output))).toBe(2);
        expect(registry.getEntityId(makeKey(20, EMaterialType.BOARD, SlotKind.Construction))).toBe(3);

        expect(registry.getLinkedEntities(10).size).toBe(2);
        expect(registry.getLinkedEntities(20).size).toBe(1);

        expect(registry.getUsedPositions(10).has('5,3')).toBe(true);
        expect(registry.getUsedPositions(10).has('6,4')).toBe(true);
        expect(registry.getUsedPositions(20).has('7,8')).toBe(true);
    });

    // ─── clear ───────────────────────────────────────────────────────────────

    it('clear() resets the entire registry', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        registry.clear();

        expect(registry.getEntityId(key)).toBeUndefined();
        expect(registry.getKey(1)).toBeUndefined();
        expect(registry.getLinkedEntities(10).size).toBe(0);
        expect(registry.getUsedPositions(10).size).toBe(0);
    });

    // ─── slotKind coverage ───────────────────────────────────────────────────

    it('supports all linked slot kinds: output, input, construction, storage', () => {
        const kinds: PileSlotKey['slotKind'][] = [
            SlotKind.Output,
            SlotKind.Input,
            SlotKind.Construction,
            SlotKind.Storage,
        ];

        kinds.forEach((slotKind, i) => {
            const key = makeKey(10 + i, EMaterialType.LOG, slotKind);
            registry.register(i + 1, key, { x: i, y: i });
            expect(registry.getEntityId(key)).toBe(i + 1);
            expect(registry.getKey(i + 1)).toEqual(key);
        });
    });
});
