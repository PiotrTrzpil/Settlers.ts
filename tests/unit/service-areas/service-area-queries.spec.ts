import { describe, it, expect, beforeEach } from 'vitest';
import {
    ServiceAreaManager,
    DEFAULT_SERVICE_RADIUS,
    isPositionInServiceArea,
    getBuildingsInServiceArea,
    getTavernsServingBuilding,
    getNearestTavernForBuilding,
    isPositionInAnyServiceArea,
    getBuildingsInServiceAreaByDistance,
    getTavernsServingBothPositions,
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
            const area = manager.createServiceArea(1, 50, 50);

            expect(area.tavernId).toBe(1);
            expect(area.centerX).toBe(50);
            expect(area.centerY).toBe(50);
            expect(area.radius).toBe(DEFAULT_SERVICE_RADIUS);
        });

        it('should create a service area with custom radius', () => {
            const area = manager.createServiceArea(1, 50, 50, 20);

            expect(area.radius).toBe(20);
        });

        it('should overwrite existing service area for same tavern', () => {
            manager.createServiceArea(1, 50, 50, 10);
            const area = manager.createServiceArea(1, 100, 100, 25);

            expect(manager.getServiceArea(1)?.centerX).toBe(100);
            expect(manager.getServiceArea(1)?.radius).toBe(25);
            expect(manager.size).toBe(1);
        });
    });

    describe('removeServiceArea', () => {
        it('should remove an existing service area', () => {
            manager.createServiceArea(1, 50, 50);

            expect(manager.removeServiceArea(1)).toBe(true);
            expect(manager.getServiceArea(1)).toBeUndefined();
        });

        it('should return false when removing non-existent service area', () => {
            expect(manager.removeServiceArea(999)).toBe(false);
        });
    });

    describe('setRadius', () => {
        it('should update the radius of an existing service area', () => {
            manager.createServiceArea(1, 50, 50, 10);

            expect(manager.setRadius(1, 25)).toBe(true);
            expect(manager.getServiceArea(1)?.radius).toBe(25);
        });

        it('should enforce minimum radius of 1', () => {
            manager.createServiceArea(1, 50, 50, 10);

            manager.setRadius(1, 0);
            expect(manager.getServiceArea(1)?.radius).toBe(1);

            manager.setRadius(1, -5);
            expect(manager.getServiceArea(1)?.radius).toBe(1);
        });

        it('should return false for non-existent service area', () => {
            expect(manager.setRadius(999, 25)).toBe(false);
        });
    });

    describe('setCenter', () => {
        it('should update the center of an existing service area', () => {
            manager.createServiceArea(1, 50, 50);

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
            manager.createServiceArea(1, 10, 10);
            manager.createServiceArea(2, 20, 20);
            manager.createServiceArea(3, 30, 30);

            const areas = Array.from(manager.getAllServiceAreas());
            expect(areas).toHaveLength(3);
            expect(areas.map(a => a.tavernId).sort()).toEqual([1, 2, 3]);
        });
    });
});

describe('isPositionInServiceArea', () => {
    it('should return true for position at center', () => {
        const area = createServiceArea(1, 50, 50, 10);

        expect(isPositionInServiceArea(50, 50, area)).toBe(true);
    });

    it('should return true for position exactly at radius boundary', () => {
        const area = createServiceArea(1, 50, 50, 10);

        // Hex distance of 10 in the EAST direction
        expect(isPositionInServiceArea(60, 50, area)).toBe(true);
    });

    it('should return false for position beyond radius', () => {
        const area = createServiceArea(1, 50, 50, 10);

        // Hex distance of 11
        expect(isPositionInServiceArea(61, 50, area)).toBe(false);
    });

    it('should handle diagonal positions correctly using hex distance', () => {
        const area = createServiceArea(1, 50, 50, 10);

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
        const tavern = addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);
        const nearby1 = addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        const nearby2 = addBuilding(state, 48, 48, BuildingType.Sawmill, 0);
        const farAway = addBuilding(state, 100, 100, BuildingType.Mill, 0);

        const area = manager.createServiceArea(tavern.id, 50, 50, 10);
        const buildingIds = getBuildingsInServiceArea(area, state);

        expect(buildingIds).toContain(tavern.id);
        expect(buildingIds).toContain(nearby1.id);
        expect(buildingIds).toContain(nearby2.id);
        expect(buildingIds).not.toContain(farAway.id);
    });

    it('should return empty array when no buildings in service area', () => {
        const area = manager.createServiceArea(1, 50, 50, 5);
        addBuilding(state, 100, 100, BuildingType.WoodcutterHut, 0);

        const buildingIds = getBuildingsInServiceArea(area, state);
        expect(buildingIds).toHaveLength(0);
    });

    it('should include building exactly at boundary', () => {
        const area = manager.createServiceArea(1, 50, 50, 10);
        const atBoundary = addBuilding(state, 60, 50, BuildingType.WoodcutterHut, 0);

        const buildingIds = getBuildingsInServiceArea(area, state);
        expect(buildingIds).toContain(atBoundary.id);
    });
});

describe('getTavernsServingBuilding', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return all taverns serving a building position', () => {
        const tavern1 = addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);
        const tavern2 = addBuilding(state, 55, 55, BuildingType.LivingHouse, 0);
        const tavern3 = addBuilding(state, 100, 100, BuildingType.LivingHouse, 0);

        manager.createServiceArea(tavern1.id, 50, 50, 10);
        manager.createServiceArea(tavern2.id, 55, 55, 10);
        manager.createServiceArea(tavern3.id, 100, 100, 10);

        // Building at 53, 53 should be within range of both tavern1 and tavern2
        const tavernIds = getTavernsServingBuilding(53, 53, manager, state);

        expect(tavernIds).toContain(tavern1.id);
        expect(tavernIds).toContain(tavern2.id);
        expect(tavernIds).not.toContain(tavern3.id);
    });

    it('should return empty array when no taverns serve the position', () => {
        manager.createServiceArea(1, 50, 50, 5);

        const tavernIds = getTavernsServingBuilding(100, 100, manager, state);
        expect(tavernIds).toHaveLength(0);
    });
});

describe('getNearestTavernForBuilding', () => {
    let state: GameState;
    let manager: ServiceAreaManager;

    beforeEach(() => {
        state = createGameState();
        manager = new ServiceAreaManager();
    });

    it('should return the nearest tavern serving the building', () => {
        const tavern1 = addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);
        const tavern2 = addBuilding(state, 55, 55, BuildingType.LivingHouse, 0);

        manager.createServiceArea(tavern1.id, 50, 50, 20);
        manager.createServiceArea(tavern2.id, 55, 55, 20);

        // Building at 56, 56 is closer to tavern2
        const nearestId = getNearestTavernForBuilding(56, 56, manager, state);
        expect(nearestId).toBe(tavern2.id);

        // Building at 51, 51 is closer to tavern1
        const nearestId2 = getNearestTavernForBuilding(51, 51, manager, state);
        expect(nearestId2).toBe(tavern1.id);
    });

    it('should return undefined when no taverns serve the position', () => {
        manager.createServiceArea(1, 50, 50, 5);
        addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);

        const nearestId = getNearestTavernForBuilding(100, 100, manager, state);
        expect(nearestId).toBeUndefined();
    });

    it('should handle single tavern correctly', () => {
        const tavern = addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);
        manager.createServiceArea(tavern.id, 50, 50, 15);

        const nearestId = getNearestTavernForBuilding(55, 55, manager, state);
        expect(nearestId).toBe(tavern.id);
    });
});

describe('isPositionInAnyServiceArea', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should return true when position is in at least one service area', () => {
        manager.createServiceArea(1, 50, 50, 10);
        manager.createServiceArea(2, 100, 100, 10);

        expect(isPositionInAnyServiceArea(55, 55, manager)).toBe(true);
        expect(isPositionInAnyServiceArea(105, 105, manager)).toBe(true);
    });

    it('should return false when position is in no service area', () => {
        manager.createServiceArea(1, 50, 50, 10);
        manager.createServiceArea(2, 100, 100, 10);

        expect(isPositionInAnyServiceArea(75, 75, manager)).toBe(false);
    });

    it('should return false when no service areas exist', () => {
        expect(isPositionInAnyServiceArea(50, 50, manager)).toBe(false);
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
        const tavern = addBuilding(state, 50, 50, BuildingType.LivingHouse, 0);
        // Distance 3 (EAST direction)
        addBuilding(state, 53, 50, BuildingType.WoodcutterHut, 0);
        // Distance 7 (EAST direction)
        addBuilding(state, 57, 50, BuildingType.Sawmill, 0);
        // Distance 12 (EAST direction)
        addBuilding(state, 62, 50, BuildingType.Mill, 0);

        const area = manager.createServiceArea(tavern.id, 50, 50, 15);
        const buildings = getBuildingsInServiceAreaByDistance(area, state);

        // All 4 buildings should be within radius 15
        expect(buildings.length).toBe(4);
        expect(buildings[0].buildingId).toBe(tavern.id);
        expect(buildings[0].distance).toBe(0);

        // Verify sorting by distance (ascending)
        for (let i = 1; i < buildings.length; i++) {
            expect(buildings[i].distance).toBeGreaterThanOrEqual(buildings[i - 1].distance);
        }
    });

    it('should exclude buildings outside service area', () => {
        const area = manager.createServiceArea(1, 50, 50, 5);
        addBuilding(state, 52, 52, BuildingType.WoodcutterHut, 0);
        const farAway = addBuilding(state, 100, 100, BuildingType.Mill, 0);

        const buildings = getBuildingsInServiceAreaByDistance(area, state);

        expect(buildings.find(b => b.buildingId === farAway.id)).toBeUndefined();
    });
});

describe('getTavernsServingBothPositions', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should return taverns covering both source and destination', () => {
        manager.createServiceArea(1, 50, 50, 20); // Covers both
        manager.createServiceArea(2, 55, 55, 5);  // Only covers source area
        manager.createServiceArea(3, 100, 100, 10); // Covers neither

        // Source at 52, 52, destination at 60, 60
        const tavernIds = getTavernsServingBothPositions(52, 52, 60, 60, manager);

        expect(tavernIds).toContain(1);
        expect(tavernIds).not.toContain(2);
        expect(tavernIds).not.toContain(3);
    });

    it('should return empty array when no tavern covers both positions', () => {
        manager.createServiceArea(1, 50, 50, 5);
        manager.createServiceArea(2, 100, 100, 5);

        const tavernIds = getTavernsServingBothPositions(52, 52, 98, 98, manager);
        expect(tavernIds).toHaveLength(0);
    });

    it('should handle overlapping service areas', () => {
        manager.createServiceArea(1, 50, 50, 15);
        manager.createServiceArea(2, 55, 55, 15);

        // Both taverns cover the region between them
        const tavernIds = getTavernsServingBothPositions(52, 52, 56, 56, manager);

        expect(tavernIds).toContain(1);
        expect(tavernIds).toContain(2);
    });
});

describe('Edge cases', () => {
    let manager: ServiceAreaManager;

    beforeEach(() => {
        manager = new ServiceAreaManager();
    });

    it('should handle even Y row positions correctly (hex grid)', () => {
        const area = createServiceArea(1, 50, 50, 10);

        // Even row
        expect(isPositionInServiceArea(55, 50, area)).toBe(true);
    });

    it('should handle odd Y row positions correctly (hex grid)', () => {
        const area = createServiceArea(1, 50, 51, 10);

        // Odd row
        expect(isPositionInServiceArea(55, 51, area)).toBe(true);
    });

    it('should handle zero radius service area', () => {
        manager.createServiceArea(1, 50, 50, 0);
        manager.setRadius(1, 0); // Will be clamped to 1

        expect(manager.getServiceArea(1)?.radius).toBe(1);
    });

    it('should handle large radius values', () => {
        const area = manager.createServiceArea(1, 50, 50, 1000);

        expect(isPositionInServiceArea(500, 500, area)).toBe(true);
    });

    it('should handle negative coordinates', () => {
        const area = createServiceArea(1, -10, -10, 10);

        expect(isPositionInServiceArea(-5, -5, area)).toBe(true);
        expect(isPositionInServiceArea(-15, -15, area)).toBe(true);
        expect(isPositionInServiceArea(-25, -25, area)).toBe(false);
    });
});
