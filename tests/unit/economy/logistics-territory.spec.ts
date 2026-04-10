import { describe, it, expect } from 'vitest';
import {
    createTerritoryPlacementFilter,
    createTerritoryMatchFilter,
    createTerritoryCarrierFilter,
} from '@/game/features/territory';
import { PlacementStatus } from '@/game/systems/placement';
import type { TerritoryManager } from '@/game/features/territory';
import type { Entity } from '@/game/entity';
import type { Tile } from '@/game/core/coordinates';
import { Race } from '@/game/core/race';

/** Non-dark-tribe player races for placement filter tests. */
const TEST_PLAYER_RACES: ReadonlyMap<number, Race> = new Map([
    [1, Race.Roman],
    [2, Race.Viking],
]);

/**
 * Create a mock TerritoryManager where tiles with x < threshold are "in territory" for the given player.
 * Tiles in the same player's territory are always connected (single contiguous pocket).
 */
function createMockTerritoryManager(threshold: number, territoryPlayer: number): TerritoryManager {
    const isInTerritory = (tile: Tile, player: number) => player === territoryPlayer && tile.x < threshold;
    return {
        isInTerritory,
        areConnected: (a: Tile, b: Tile, player: number) => isInTerritory(a, player) && isInTerritory(b, player),
    } as unknown as TerritoryManager;
}

/**
 * Create a mock TerritoryManager with two disconnected territory pockets.
 * Pocket A: x < splitA, Pocket B: x >= splitB. Tiles in between are unclaimed.
 */
function createDisconnectedTerritoryManager(splitA: number, splitB: number, territoryPlayer: number): TerritoryManager {
    const isInTerritory = (tile: Tile, player: number) =>
        player === territoryPlayer && (tile.x < splitA || tile.x >= splitB);
    return {
        isInTerritory,
        areConnected: (a: Tile, b: Tile, player: number) => {
            if (!isInTerritory(a, player) || !isInTerritory(b, player)) {
                return false;
            }
            // Same pocket = connected; different pockets = disconnected
            const inA1 = a.x < splitA;
            const inA2 = b.x < splitA;
            return inA1 === inA2;
        },
    } as unknown as TerritoryManager;
}

/** Create a minimal mock entity at the given position. */
function mockEntity(tile: Tile, player = 1): Entity {
    return { x: tile.x, y: tile.y, player } as Entity;
}

describe('createTerritoryPlacementFilter', () => {
    it('should return null (allow) when tile is in territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm, TEST_PLAYER_RACES);
        expect(filter({ x: 10, y: 10 }, 1)).toBeNull();
    });

    it('should return OutOfTerritory when tile is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm, TEST_PLAYER_RACES);
        expect(filter({ x: 25, y: 10 }, 1)).toBe(PlacementStatus.OutOfTerritory);
    });

    it('should return OutOfTerritory for wrong player', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryPlacementFilter(tm, TEST_PLAYER_RACES);
        expect(filter({ x: 10, y: 10 }, 2)).toBe(PlacementStatus.OutOfTerritory);
    });
});

describe('createTerritoryMatchFilter', () => {
    it('should allow match when both source and dest are in same territory pocket', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 5, y: 5 });
        const dst = mockEntity({ x: 15, y: 15 });
        expect(filter(src, dst, 1)).toBe(true);
    });

    it('should reject match when source is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 25, y: 5 });
        const dst = mockEntity({ x: 15, y: 15 });
        expect(filter(src, dst, 1)).toBe(false);
    });

    it('should reject match when destination is outside territory', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 5, y: 5 });
        const dst = mockEntity({ x: 25, y: 15 });
        expect(filter(src, dst, 1)).toBe(false);
    });

    it('should reject match for wrong player', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 5, y: 5 });
        const dst = mockEntity({ x: 15, y: 15 });
        expect(filter(src, dst, 2)).toBe(false);
    });

    it('should reject match when source and dest are in disconnected territory pockets', () => {
        const tm = createDisconnectedTerritoryManager(10, 50, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 5, y: 5 }); // pocket A
        const dst = mockEntity({ x: 55, y: 5 }); // pocket B
        expect(filter(src, dst, 1)).toBe(false);
    });

    it('should allow match when source and dest are in the same disconnected pocket', () => {
        const tm = createDisconnectedTerritoryManager(10, 50, 1);
        const filter = createTerritoryMatchFilter(tm);
        const src = mockEntity({ x: 3, y: 5 }); // pocket A
        const dst = mockEntity({ x: 7, y: 5 }); // pocket A
        expect(filter(src, dst, 1)).toBe(true);
    });
});

describe('createTerritoryCarrierFilter', () => {
    it('should allow carrier in territory (no destination)', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity({ x: 10, y: 10 }, 1);
        expect(filter(carrier, 1)).toBe(true);
    });

    it('should reject carrier outside territory (no destination)', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity({ x: 25, y: 10 }, 1);
        expect(filter(carrier, 1)).toBe(false);
    });

    it('should allow carrier connected to destination', () => {
        const tm = createMockTerritoryManager(20, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity({ x: 5, y: 5 }, 1);
        expect(filter(carrier, 1, 15, 15)).toBe(true);
    });

    it('should reject carrier in disconnected pocket from destination', () => {
        const tm = createDisconnectedTerritoryManager(10, 50, 1);
        const filter = createTerritoryCarrierFilter(tm);
        const carrier = mockEntity({ x: 5, y: 5 }, 1); // pocket A
        expect(filter(carrier, 1, 55, 5)).toBe(false); // dest in pocket B
    });
});
