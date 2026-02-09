import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    getBuildingsInServiceAreaByDistance,
    getHubsServingBothPositions,
    createServiceArea,
} from '@/game/features/service-areas';
import { createGameState, addBuilding } from '../helpers/test-game';
import { BuildingType } from '@/game/entity';
import type { GameState } from '@/game/game-state';

describe('ServiceAreaManager', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    describe('createServiceArea', () => {
        it('should create a service area with default radius', () => {
            const area = manager.createServiceArea(1, 0, 50, 50);

            expect(area.buildingId).toBe(1);
            expect(area.playerId).toBe(0);
            expect(area.centerX).toBe(50);
            expect(area.centerY).toBe(50);
            expect(area.radius).toBe(DEFAULT_SERVICE_RADIUS);
        });

        it('should create a service area with custom radius', () => {
            const area = manager.createServiceArea(1, 0, 50, 50, 20);

            expect(area.radius).toBe(20);
        });

        it('should clamp radius to valid range', () => {
            const tooSmall = manager.createServiceArea(1, 0, 50, 50, 0);
            expect(tooSmall.radius).toBe(MIN_SERVICE_RADIUS);

            manager.removeServiceArea(1);

            const tooLarge = manager.createServiceArea(1, 0, 50, 50, 100);
            expect(tooLarge.radius).toBe(MAX_SERVICE_RADIUS);
        });

        it('should overwrite existing service area for same building', () => {
            manager.createServiceArea(1, 0, 50, 50, 10);
            manager.createServiceArea(1, 1, 100, 100, 25);

            expect(manager.getServiceArea(1)?.centerX).toBe(100);
            expect(manager.getServiceArea(1)?.radius).toBe(25);
            expect(manager.getServiceArea(1)?.playerId).toBe(1);
            expect(manager.size).toBe(1);
        });
    });

    describe('removeServiceArea', () => {
        it('should remove an existing service area', () => {
            manager.createServiceArea(1, 0, 50, 50);

            expect(manager.removeServiceArea(1)).toBe(true);
            expect(manager.getServiceArea(1)).toBeUndefined();
        });

        it('should return false when removing non-existent service area', () => {
            expect(manager.removeServiceArea(999)).toBe(false);
        });
    });

    describe('setRadius', () => {
        it('should update the radius of an existing service area', () => {
            manager.createServiceArea(1, 0, 50, 50, 10);

            expect(manager.setRadius(1, 25)).toBe(true);
            expect(manager.getServiceArea(1)?.radius).toBe(25);
        });

        it('should clamp radius to valid range', () => {
            manager.createServiceArea(1, 0, 50, 50, 10);

            manager.setRadius(1, 0);
            expect(manager.getServiceArea(1)?.radius).toBe(MIN_SERVICE_RADIUS);

            manager.setRadius(1, 100);
            expect(manager.getServiceArea(1)?.radius).toBe(MAX_SERVICE_RADIUS);
        });

        it('should return false for non-existent service area', () => {
            expect(manager.setRadius(999, 25)).toBe(false);
        });
    });

    describe('setCenter', () => {
        it('should update the center of an existing service area', () => {
            manager.createServiceArea(1, 0, 50, 50);

            expect(manager.setCenter(1, 100, 100)).toBe(true);
            expect(manager.getServiceArea(1)?.centerX).toBe(100);
            expect(manager.getServiceArea(1)?.centerY).toBe(100);
        });

        it('should return false for non-existent service area', () => {
            expect(manager.setCenter(999, 100, 100)).toBe(false);
        });
    });

    describe('getAllServiceAreas', () => {
        it('should iterate over all service areas', () => {
            manager.createServiceArea(1, 0, 10, 10);
            manager.createServiceArea(2, 0, 20, 20);
            manager.createServiceArea(3, 1, 30, 30);

            const areas = Array.from(manager.getAllServiceAreas());
            expect(areas).toHaveLength(3);
            expect(areas.map(a => a.buildingId).sort()).toEqual([1, 2, 3]);
        });
    });

    describe('getServiceAreasForPlayer', () => {
        it('should return only service areas for the specified player', () => {
            manager.createServiceArea(1, 0, 10, 10);
            manager.createServiceArea(2, 0, 20, 20);
            manager.createServiceArea(3, 1, 30, 30);

            const player0Areas = manager.getServiceAreasForPlayer(0);
            expect(player0Areas).toHaveLength(2);
            expect(player0Areas.map(a => a.buildingId).sort()).toEqual([1, 2]);

            const player1Areas = manager.getServiceAreasForPlayer(1);
            expect(player1Areas).toHaveLength(1);
            expect(player1Areas[0].buildingId).toBe(3);
        });
    });

    describe('events', () => {
        it('should emit created event when service area is created', () => {
            const listener = vi.fn();
            manager.on('created', listener);

            const area = manager.createServiceArea(1, 0, 50, 50);

            expect(listener).toHaveBeenCalledWith({ serviceArea: area });
        });

        it('should emit removed event when service area is removed', () => {
            const listener = vi.fn();
            manager.createServiceArea(1, 0, 50, 50);
            manager.on('removed', listener);

            manager.removeServiceArea(1);

            expect(listener).toHaveBeenCalledWith({ buildingId: 1 });
        });

        it('should emit radiusChanged event when radius changes', () => {
            const listener = vi.fn();
            manager.createServiceArea(1, 0, 50, 50, 10);
            manager.on('radiusChanged', listener);

            manager.setRadius(1, 20);

            expect(listener).toHaveBeenCalledWith({
                buildingId: 1,
                oldRadius: 10,
                newRadius: 20,
            });
        });

        it('should emit centerChanged event when center changes', () => {
            const listener = vi.fn();
            manager.createServiceArea(1, 0, 50, 50);
            manager.on('centerChanged', listener);

            manager.setCenter(1, 100, 100);

            expect(listener).toHaveBeenCalledWith({
                buildingId: 1,
                oldX: 50,
                oldY: 50,
                newX: 100,
                newY: 100,
            });
        });

        it('should allow unsubscribing from events', () => {
            const listener = vi.fn();
            manager.on('created', listener);
            manager.off('created', listener);

            manager.createServiceArea(1, 0, 50, 50);

            expect(listener).not.toHaveBeenCalled();
        });
    });
});

describe('isPositionInServiceArea', () => {
    it('should return true for position at center', () => {
        const area = createServiceArea(1, 0, 50, 50, 10);

        expect(isPositionInServiceArea(50, 50, area)).toBe(true);
    });

    it('should return true for position exactly at radius boundary', () => {
        const area = createServiceArea(1, 0, 50, 50, 10);

        // Hex distance of 10 in the EAST direction
        expect(isPositionInServiceArea(60, 50, area)).toBe(true);
    });

    it('should return false for position beyond radius', () => {
        const area = createServiceArea(1, 0, 50, 50, 10);

        // Hex distance of 11
        expect(isPositionInServiceArea(61, 50, area)).toBe(false);
    });

    it('should handle diagonal positions correctly using hex distance', () => {
        const area = createServiceArea(1, 0, 50, 50, 10);

        // Hex distance formula: max(|q|, |r|, |s|) where q=dx, r=dy, s=-(dx+dy)
        // From (50,50) to (55,55): q=5, r=5, s=-10 → max(5, 5, 10) = 10
        expect(isPositionInServiceArea(55, 55, area)).toBe(true);

        // From (50,50) to (60,60): q=10, r=10, s=-20 → max(10, 10, 20) = 20 > 10
        expect(isPositionInServiceArea(60, 60, area)).toBe(false);

        // From (50,50) to (53,53): q=3, r=3, s=-6 → max(3, 3, 6) = 6
        expect(isPositionInServiceArea(53, 53, area)).toBe(true);
    });
});

describe('getBuildingsInServiceArea', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return buildings within the service area', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const nearby1 = addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        const nearby2 = addBuilding(state, 48, 48, BuildingType.Sawmill, 0);
        const farAway = addBuilding(state, 100, 100, BuildingType.Mill, 0);

        const area = manager.createServiceArea(hub.id, 0, 50, 50, 10);
        const buildingIds = getBuildingsInServiceArea(area, state);

        expect(buildingIds).toContain(hub.id);
        expect(buildingIds).toContain(nearby1.id);
        expect(buildingIds).toContain(nearby2.id);
        expect(buildingIds).not.toContain(farAway.id);
    });

    it('should return empty array when no buildings in service area', () => {
        const area = manager.createServiceArea(1, 0, 50, 50, 5);
        addBuilding(state, 100, 100, BuildingType.WoodcutterHut, 0);

        const buildingIds = getBuildingsInServiceArea(area, state);
        expect(buildingIds).toHaveLength(0);
    });

    it('should filter by player when specified', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        addBuilding(state, 48, 48, BuildingType.Sawmill, 1); // Different player

        const area = manager.createServiceArea(hub.id, 0, 50, 50, 10);

        const allBuildings = getBuildingsInServiceArea(area, state);
        expect(allBuildings).toHaveLength(3);

        const player0Buildings = getBuildingsInServiceArea(area, state, { playerId: 0 });
        expect(player0Buildings).toHaveLength(2);
    });

    it('should exclude self when includeSelf is false', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);

        const area = manager.createServiceArea(hub.id, 0, 50, 50, 10);

        const withSelf = getBuildingsInServiceArea(area, state);
        expect(withSelf).toContain(hub.id);

        const withoutSelf = getBuildingsInServiceArea(area, state, { includeSelf: false });
        expect(withoutSelf).not.toContain(hub.id);
    });
});

describe('getHubsServingPosition', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return all hubs serving a position', () => {
        const hub1 = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const hub2 = addBuilding(state, 55, 55, BuildingType.ResidenceSmall, 0);
        const hub3 = addBuilding(state, 100, 100, BuildingType.ResidenceSmall, 0);

        manager.createServiceArea(hub1.id, 0, 50, 50, 10);
        manager.createServiceArea(hub2.id, 0, 55, 55, 10);
        manager.createServiceArea(hub3.id, 0, 100, 100, 10);

        // Position at 53, 53 should be within range of both hub1 and hub2
        const hubIds = getHubsServingPosition(53, 53, manager);

        expect(hubIds).toContain(hub1.id);
        expect(hubIds).toContain(hub2.id);
        expect(hubIds).not.toContain(hub3.id);
    });

    it('should return empty array when no hubs serve the position', () => {
        manager.createServiceArea(1, 0, 50, 50, 5);

        const hubIds = getHubsServingPosition(100, 100, manager);
        expect(hubIds).toHaveLength(0);
    });

    it('should filter by player when specified', () => {
        const hub1 = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const hub2 = addBuilding(state, 55, 55, BuildingType.ResidenceSmall, 1);

        manager.createServiceArea(hub1.id, 0, 50, 50, 15);
        manager.createServiceArea(hub2.id, 1, 55, 55, 15);

        // Both cover position 52, 52
        const allHubs = getHubsServingPosition(52, 52, manager);
        expect(allHubs).toHaveLength(2);

        const player0Hubs = getHubsServingPosition(52, 52, manager, { playerId: 0 });
        expect(player0Hubs).toHaveLength(1);
        expect(player0Hubs[0]).toBe(hub1.id);
    });
});

describe('getNearestHubForPosition', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return the nearest hub serving the position', () => {
        const hub1 = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        const hub2 = addBuilding(state, 55, 55, BuildingType.ResidenceSmall, 0);

        manager.createServiceArea(hub1.id, 0, 50, 50, 20);
        manager.createServiceArea(hub2.id, 0, 55, 55, 20);

        // Position at 56, 56 is closer to hub2
        const nearestId = getNearestHubForPosition(56, 56, manager, state);
        expect(nearestId).toBe(hub2.id);

        // Position at 51, 51 is closer to hub1
        const nearestId2 = getNearestHubForPosition(51, 51, manager, state);
        expect(nearestId2).toBe(hub1.id);
    });

    it('should return undefined when no hubs serve the position', () => {
        addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        manager.createServiceArea(1, 0, 50, 50, 5);

        const nearestId = getNearestHubForPosition(100, 100, manager, state);
        expect(nearestId).toBeUndefined();
    });

    it('should handle single hub correctly', () => {
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        manager.createServiceArea(hub.id, 0, 50, 50, 15);

        const nearestId = getNearestHubForPosition(55, 55, manager, state);
        expect(nearestId).toBe(hub.id);
    });
});

describe('isPositionInAnyServiceArea', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should return true when position is in at least one service area', () => {
        manager.createServiceArea(1, 0, 50, 50, 10);
        manager.createServiceArea(2, 0, 100, 100, 10);

        expect(isPositionInAnyServiceArea(55, 55, manager)).toBe(true);
        expect(isPositionInAnyServiceArea(105, 105, manager)).toBe(true);
    });

    it('should return false when position is in no service area', () => {
        manager.createServiceArea(1, 0, 50, 50, 10);
        manager.createServiceArea(2, 0, 100, 100, 10);

        expect(isPositionInAnyServiceArea(75, 75, manager)).toBe(false);
    });

    it('should return false when no service areas exist', () => {
        expect(isPositionInAnyServiceArea(50, 50, manager)).toBe(false);
    });

    it('should filter by player when specified', () => {
        manager.createServiceArea(1, 0, 50, 50, 5);
        manager.createServiceArea(2, 1, 100, 100, 5);

        // Position 52, 50 is only covered by player 0
        expect(isPositionInAnyServiceArea(52, 50, manager)).toBe(true);
        expect(isPositionInAnyServiceArea(52, 50, manager, { playerId: 0 })).toBe(true);
        expect(isPositionInAnyServiceArea(52, 50, manager, { playerId: 1 })).toBe(false);

        // Position 102, 100 is only covered by player 1
        expect(isPositionInAnyServiceArea(102, 100, manager)).toBe(true);
        expect(isPositionInAnyServiceArea(102, 100, manager, { playerId: 0 })).toBe(false);
        expect(isPositionInAnyServiceArea(102, 100, manager, { playerId: 1 })).toBe(true);
    });
});

describe('getBuildingsInServiceAreaByDistance', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return buildings sorted by distance', () => {
        // Create buildings at varying distances using EAST direction (pure x offset)
        // which gives simpler hex distance calculations
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        // Distance 3 (EAST direction)
        addBuilding(state, 53, 50, BuildingType.WoodcutterHut, 0);
        // Distance 7 (EAST direction)
        addBuilding(state, 57, 50, BuildingType.Sawmill, 0);
        // Distance 12 (EAST direction)
        addBuilding(state, 62, 50, BuildingType.Mill, 0);

        const area = manager.createServiceArea(hub.id, 0, 50, 50, 15);
        const buildings = getBuildingsInServiceAreaByDistance(area, state);

        // All 4 buildings should be within radius 15
        expect(buildings.length).toBe(4);
        expect(buildings[0].buildingId).toBe(hub.id);
        expect(buildings[0].distance).toBe(0);

        // Verify sorting by distance (ascending)
        for (let i = 1; i < buildings.length; i++) {
            expect(buildings[i].distance).toBeGreaterThanOrEqual(buildings[i - 1].distance);
        }
    });

    it('should exclude buildings outside service area', () => {
        const area = manager.createServiceArea(1, 0, 50, 50, 5);
        addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        const farAway = addBuilding(state, 100, 100, BuildingType.Mill, 0);

        const buildings = getBuildingsInServiceAreaByDistance(area, state);

        expect(buildings.find(b => b.buildingId === farAway.id)).toBeUndefined();
    });
});

describe('getHubsServingBothPositions', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should return hubs covering both source and destination', () => {
        manager.createServiceArea(1, 0, 50, 50, 20); // Covers both
        manager.createServiceArea(2, 0, 55, 55, 5);  // Only covers source area
        manager.createServiceArea(3, 0, 100, 100, 10); // Covers neither

        // Source at 52, 52, destination at 60, 50
        const hubIds = getHubsServingBothPositions(52, 52, 60, 50, manager);

        expect(hubIds).toContain(1);
        expect(hubIds).not.toContain(2);
        expect(hubIds).not.toContain(3);
    });

    it('should return empty array when no hub covers both positions', () => {
        manager.createServiceArea(1, 0, 50, 50, 5);
        manager.createServiceArea(2, 0, 100, 100, 5);

        const hubIds = getHubsServingBothPositions(52, 52, 98, 98, manager);
        expect(hubIds).toHaveLength(0);
    });

    it('should handle overlapping service areas', () => {
        manager.createServiceArea(1, 0, 50, 50, 15);
        manager.createServiceArea(2, 0, 55, 55, 15);

        // Both hubs cover the region between them
        const hubIds = getHubsServingBothPositions(52, 50, 56, 50, manager);

        expect(hubIds).toContain(1);
        expect(hubIds).toContain(2);
    });
});

describe('Edge cases', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should handle even Y row positions correctly (hex grid)', () => {
        const area = createServiceArea(1, 0, 50, 50, 10);

        // Even row
        expect(isPositionInServiceArea(55, 50, area)).toBe(true);
    });

    it('should handle odd Y row positions correctly (hex grid)', () => {
        const area = createServiceArea(1, 0, 50, 51, 10);

        // Odd row
        expect(isPositionInServiceArea(55, 51, area)).toBe(true);
    });

    it('should handle large radius values up to MAX', () => {
        const area = manager.createServiceArea(1, 0, 50, 50, MAX_SERVICE_RADIUS);

        expect(isPositionInServiceArea(50 + MAX_SERVICE_RADIUS, 50, area)).toBe(true);
        expect(isPositionInServiceArea(50 + MAX_SERVICE_RADIUS + 1, 50, area)).toBe(false);
    });

    it('should handle negative coordinates', () => {
        const area = createServiceArea(1, 0, -10, -10, 10);

        expect(isPositionInServiceArea(-5, -5, area)).toBe(true);
        expect(isPositionInServiceArea(-15, -15, area)).toBe(true);
        expect(isPositionInServiceArea(-25, -25, area)).toBe(false);
    });

    it('should handle deleted hub entity gracefully', () => {
        const state = createGameState();
        const hub = addBuilding(state, 50, 50, BuildingType.ResidenceSmall, 0);
        manager.createServiceArea(hub.id, 0, 50, 50, 15);

        // Remove the hub entity
        state.removeEntity(hub.id);

        // getNearestHubForPosition should return undefined since entity doesn't exist
        const nearestId = getNearestHubForPosition(52, 52, manager, state);
        expect(nearestId).toBeUndefined();
    });
});
