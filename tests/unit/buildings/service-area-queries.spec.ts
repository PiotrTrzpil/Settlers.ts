import { describe, it, expect, beforeEach } from 'vitest';
import {
    ServiceAreaManager,
    DEFAULT_SERVICE_RADIUS,
    MIN_SERVICE_RADIUS,
    MAX_SERVICE_RADIUS,
    isPositionInServiceArea,
    getBuildingsInServiceArea,
    getHubsServingPosition,
    getNearestHubForPosition,
    isPositionInAnyServiceArea,
    getHubsServingBothPositions,
    createServiceArea,
} from '@/game/features/service-areas';
import { createGameState, addBuilding } from '../helpers/test-game';
import { BuildingType } from '@/game/entity';
import type { GameState } from '@/game/game-state';

const TEST_HUB_TYPE = BuildingType.ResidenceSmall;

describe('ServiceAreaManager', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should create service areas with default/custom radius and clamp to valid range', () => {
        const area = manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE);
        expect(area.radius).toBe(DEFAULT_SERVICE_RADIUS);

        manager.removeServiceArea(1);
        const custom = manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 20);
        expect(custom.radius).toBe(20);

        manager.removeServiceArea(1);
        const tooSmall = manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 0);
        expect(tooSmall.radius).toBe(MIN_SERVICE_RADIUS);

        manager.removeServiceArea(1);
        const tooLarge = manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 100);
        expect(tooLarge.radius).toBe(MAX_SERVICE_RADIUS);
    });

    it('should overwrite existing service area for same building', () => {
        manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 10);
        manager.createServiceArea(1, 1, 100, 100, TEST_HUB_TYPE, 25);

        expect(manager.getServiceArea(1)?.centerX).toBe(100);
        expect(manager.getServiceArea(1)?.playerId).toBe(1);
        expect(manager.size).toBe(1);
    });

    it('should filter service areas by player', () => {
        manager.createServiceArea(1, 0, 10, 10, TEST_HUB_TYPE);
        manager.createServiceArea(2, 0, 20, 20, TEST_HUB_TYPE);
        manager.createServiceArea(3, 1, 30, 30, TEST_HUB_TYPE);

        expect(manager.getServiceAreasForPlayer(0)).toHaveLength(2);
        expect(manager.getServiceAreasForPlayer(1)).toHaveLength(1);
    });
});

describe('isPositionInServiceArea — hex distance', () => {
    it('should use hex distance for boundary and diagonal calculations', () => {
        const area = createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 10);

        // At center
        expect(isPositionInServiceArea(50, 50, area)).toBe(true);
        // At boundary (EAST direction)
        expect(isPositionInServiceArea(60, 50, area)).toBe(true);
        // Beyond boundary
        expect(isPositionInServiceArea(61, 50, area)).toBe(false);

        // Diagonal: hex distance = max(|q|, |r|, |s|) where s=-(dx+dy)
        // (55,55): q=5, r=5, s=-10 -> max=10 (at boundary)
        expect(isPositionInServiceArea(55, 55, area)).toBe(true);
        // (60,60): q=10, r=10, s=-20 -> max=20 > 10
        expect(isPositionInServiceArea(60, 60, area)).toBe(false);
    });
});

describe('Service area spatial queries', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should find buildings within a service area and filter by player', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const nearby = addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        const enemy = addBuilding(state, 48, 48, BuildingType.Sawmill, 1);
        const farAway = addBuilding(state, 100, 100, BuildingType.Mill, 0);

        const area = manager.createServiceArea(hub.id, 0, 50, 50, 10);
        const allBuildings = getBuildingsInServiceArea(area, state);

        expect(allBuildings).toContain(hub.id);
        expect(allBuildings).toContain(nearby.id);
        expect(allBuildings).toContain(enemy.id);
        expect(allBuildings).not.toContain(farAway.id);

        // Player filter
        const player0Only = getBuildingsInServiceArea(area, state, { playerId: 0 });
        expect(player0Only).not.toContain(enemy.id);

        // Exclude self
        const withoutSelf = getBuildingsInServiceArea(area, state, { includeSelf: false });
        expect(withoutSelf).not.toContain(hub.id);
    });

    it('should find hubs serving a position and return nearest one', () => {
        const hub1 = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const hub2 = addBuilding(state, 55, 55, BuildingType.ResidenceSmall, 0);
        const hub3 = addBuilding(state, 100, 100, BuildingType.ResidenceSmall, 0);

        manager.createServiceArea(hub1.id, 0, 50, 50, 10);
        manager.createServiceArea(hub2.id, 0, 55, 55, 10);
        manager.createServiceArea(hub3.id, 0, 100, 100, 10);

        // Position at 53, 53 within range of both hub1 and hub2
        const hubIds = getHubsServingPosition(53, 53, manager);
        expect(hubIds).toContain(hub1.id);
        expect(hubIds).toContain(hub2.id);
        expect(hubIds).not.toContain(hub3.id);

        // Nearest hub from (56, 56) should be hub2
        expect(getNearestHubForPosition(56, 56, manager, state)).toBe(hub2.id);
        // No hub serves (100, 0)
        expect(getNearestHubForPosition(100, 0, manager, state)).toBeUndefined();
    });

    it('should find hubs serving both source and destination positions', () => {
        manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 20); // Covers both
        manager.createServiceArea(2, 0, 55, 55, TEST_HUB_TYPE, 5); // Only source area
        manager.createServiceArea(3, 0, 100, 100, TEST_HUB_TYPE, 10); // Covers neither

        const hubIds = getHubsServingBothPositions(52, 52, 60, 50, manager);
        expect(hubIds).toContain(1);
        expect(hubIds).not.toContain(2);
        expect(hubIds).not.toContain(3);
    });

    it('should handle deleted hub entity gracefully', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        manager.createServiceArea(hub.id, 0, 50, 50, 15);
        state.removeEntity(hub.id);

        expect(getNearestHubForPosition(52, 52, manager, state)).toBeUndefined();
    });
});

describe('isPositionInAnyServiceArea — player filtering', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should check coverage across all areas and respect player filter', () => {
        manager.createServiceArea(1, 0, 50, 50, TEST_HUB_TYPE, 5);
        manager.createServiceArea(2, 1, 100, 100, TEST_HUB_TYPE, 5);

        // Position covered by player 0 only
        expect(isPositionInAnyServiceArea(52, 50, manager)).toBe(true);
        expect(isPositionInAnyServiceArea(52, 50, manager, { playerId: 0 })).toBe(true);
        expect(isPositionInAnyServiceArea(52, 50, manager, { playerId: 1 })).toBe(false);

        // Position covered by player 1 only
        expect(isPositionInAnyServiceArea(102, 100, manager, { playerId: 0 })).toBe(false);
        expect(isPositionInAnyServiceArea(102, 100, manager, { playerId: 1 })).toBe(true);

        // Position not covered by anyone
        expect(isPositionInAnyServiceArea(75, 75, manager)).toBe(false);
    });
});
