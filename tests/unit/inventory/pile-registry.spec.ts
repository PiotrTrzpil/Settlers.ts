/**
 * Unit tests for PileRegistry.
 *
 * Tests the bidirectional index (building+material+slotKind <-> entityId),
 * double-spawn detection, and rebuild-from-entities recovery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PileRegistry, type PileSlotKey } from '@/game/systems/inventory/pile-registry';
import { EMaterialType } from '@/game/economy/material-type';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { Entity } from '@/game/entity';
import type { PileKind } from '@/game/core/pile-kind';
import { SlotKind } from '@/game/core/pile-kind';
import type { PileKindProvider } from '@/game/systems/inventory/pile-registry';

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

function makeMockResources(kindMap: Map<number, PileKind>): PileKindProvider {
    return {
        getPileKind(entityId: number): PileKind {
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

    it('register/deregister: forward lookup, reverse lookup, and position tracking', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });

        // Forward and reverse lookups work
        expect(registry.getEntityId(key)).toBe(1);
        expect(registry.getKey(1)).toEqual(key);
        expect(registry.getUsedPositions(10).has('5,3')).toBe(true);
        expect(registry.getLinkedEntities(10).size).toBe(1);

        // Deregister cleans everything
        registry.deregister(1);
        expect(registry.getEntityId(key)).toBeUndefined();
        expect(registry.getKey(1)).toBeUndefined();
        expect(registry.getUsedPositions(10).has('5,3')).toBe(false);
        expect(registry.getLinkedEntities(10).size).toBe(0);
    });

    it('duplicate key throws double-spawn error', () => {
        const key = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        registry.register(1, key, { x: 5, y: 3 });
        expect(() => registry.register(2, key, { x: 6, y: 4 })).toThrow('already registered (double-spawn bug)');
    });

    it('deregister only removes its own position when two piles share a building', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });

        registry.deregister(1);

        expect(registry.getUsedPositions(10).has('5,3')).toBe(false);
        expect(registry.getUsedPositions(10).has('6,4')).toBe(true);
    });

    it('clearBuilding removes all entries for that building; others survive', () => {
        const keyA = makeKey(10, EMaterialType.LOG, SlotKind.Input);
        const keyB = makeKey(10, EMaterialType.STONE, SlotKind.Output);
        const keyC = makeKey(20, EMaterialType.BOARD, SlotKind.Input);

        registry.register(1, keyA, { x: 5, y: 3 });
        registry.register(2, keyB, { x: 6, y: 4 });
        registry.register(3, keyC, { x: 7, y: 8 });

        const cleared = registry.clearBuilding(10);

        expect(cleared.size).toBe(2);
        expect(registry.getEntityId(keyA)).toBeUndefined();
        expect(registry.getEntityId(keyB)).toBeUndefined();
        expect(registry.getUsedPositions(10).size).toBe(0);

        // Building 20 unaffected
        expect(registry.getEntityId(keyC)).toBe(3);
        expect(registry.getLinkedEntities(20).size).toBe(1);
    });

    it('rebuildFromEntities restores full index from entity scan', () => {
        // Pre-populate with stale data
        registry.register(1, makeKey(99, EMaterialType.STONE, SlotKind.Output), { x: 1, y: 1 });

        const entA = makeStackedResourceEntity(1, 5, 3, EMaterialType.LOG);
        const entB = makeStackedResourceEntity(2, 6, 4, EMaterialType.STONE);
        const entC = makeStackedResourceEntity(3, 7, 8, EMaterialType.BOARD);
        // Non-resource entity should be skipped
        const unit: Entity = { id: 4, type: EntityType.Unit, x: 0, y: 0, player: 0, subType: 0, race: Race.Roman };
        // Free pile should be skipped
        const freeEnt = makeStackedResourceEntity(5, 9, 9, EMaterialType.STONE);

        const kindMap = new Map<number, PileKind>([
            [1, { kind: SlotKind.Input, buildingId: 10 }],
            [2, { kind: SlotKind.Output, buildingId: 10 }],
            [3, { kind: SlotKind.Input, buildingId: 20 }],
            [5, { kind: SlotKind.Free }],
        ]);
        const resources = makeMockResources(kindMap);

        registry.rebuildFromEntities([entA, entB, entC, unit, freeEnt], resources);

        // Stale data cleared
        expect(registry.getEntityId(makeKey(99, EMaterialType.STONE, SlotKind.Output))).toBeUndefined();

        // New entries present
        expect(registry.getEntityId(makeKey(10, EMaterialType.LOG, SlotKind.Input))).toBe(1);
        expect(registry.getEntityId(makeKey(10, EMaterialType.STONE, SlotKind.Output))).toBe(2);
        expect(registry.getEntityId(makeKey(20, EMaterialType.BOARD, SlotKind.Input))).toBe(3);

        expect(registry.getLinkedEntities(10).size).toBe(2);
        expect(registry.getLinkedEntities(20).size).toBe(1);

        // Skipped entities
        expect(registry.getKey(4)).toBeUndefined(); // unit
        expect(registry.getKey(5)).toBeUndefined(); // free
    });

    it('clear resets the entire registry', () => {
        registry.register(1, makeKey(10, EMaterialType.LOG, SlotKind.Input), { x: 5, y: 3 });
        registry.clear();

        expect(registry.getEntityId(makeKey(10, EMaterialType.LOG, SlotKind.Input))).toBeUndefined();
        expect(registry.getKey(1)).toBeUndefined();
        expect(registry.getLinkedEntities(10).size).toBe(0);
    });
});
