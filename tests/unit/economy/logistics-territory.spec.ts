import { describe, it, expect } from 'vitest';
import {
    createTerritoryPlacementFilter,
    createTerritoryMatchFilter,
    createTerritoryCarrierFilter,
} from '@/game/features/territory';
import { PlacementStatus } from '@/game/features/placement';
import type { TerritoryManager } from '@/game/features/territory';
import type { Entity } from '@/game/entity';

/** Create a mock TerritoryManager where tiles with x < threshold are "in territory" for the given player. */
function createMockTerritoryManager(threshold: number, territoryPlayer: number): TerritoryManager {
    return {
        isInTerritory: (x: number, _y: number, player: number) => player === territoryPlayer && x < threshold,
    } as unknown as TerritoryManager;
}

/** Create a minimal mock entity at the given position. */
function mockEntity(x: number, y: number, player = 1): Entity {
    return { x, y, player } as Entity;
}

describe('createTerritoryPlacementFilter', () => {
    it('should return null (allow) when tile is in territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm);
        expect(filter(10, 10, 1)).toBeNull();
    });

    it('should return OutOfTerritory when tile is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm);
        expect(filter(25, 10, 1)).toBe(PlacementStatus.OutOfTerritory);
    });

    it('should return OutOfTerritory for wrong player', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm);
        expect(filter(10, 10, 2)).toBe(PlacementStatus.OutOfTerritory);
    });
});

describe('createTerritoryMatchFilter', () => {
    it('should allow match when both source and dest are in territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity(5, 5);
        const dst = mockEntity(15, 15);
        expect(filter(src, dst, 1)).toBe(true);
    });

    it('should reject match when source is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity(25, 5);
        const dst = mockEntity(15, 15);
        expect(filter(src, dst, 1)).toBe(false);
    });

    it('should reject match when destination is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity(5, 5);
        const dst = mockEntity(25, 15);
        expect(filter(src, dst, 1)).toBe(false);
    });

    it('should reject match for wrong player', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity(5, 5);
        const dst = mockEntity(15, 15);
        expect(filter(src, dst, 2)).toBe(false);
    });
});

describe('createTerritoryCarrierFilter', () => {
    it('should allow carrier in territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity(10, 10, 1);
        expect(filter(carrier, 1)).toBe(true);
    });

    it('should reject carrier outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity(25, 10, 1);
        expect(filter(carrier, 1)).toBe(false);
    });
});
