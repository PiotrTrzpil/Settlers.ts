/**
 * Tests for building construction: terrain leveling and construction phases.
 *
 * Note: screenToTile height refinement and heightToWorld tests have been
 * consolidated into coordinates.spec.ts where they logically belong.
 */

import { describe, it, expect } from 'vitest';
import { BuildingType, getBuildingFootprint, EntityType } from '@/game/entity';
import {
    BuildingConstructionPhase,
    type TerrainContext,
    type BuildingState,
    getBuildingVisualState,
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import { GameState } from '@/game/game-state';
import { createTestMap, TERRAIN } from './helpers/test-map';
import { makeBuildingState, tickConstruction } from './helpers/test-game';

// ---------------------------------------------------------------------------
// Terrain Leveling
// ---------------------------------------------------------------------------

describe('Terrain Leveling', () => {
    describe('captureOriginalTerrain', () => {
        it('should capture all 4 footprint tiles for a 2x2 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            const footprintCoords = footprintTiles.map(t => `${t.x},${t.y}`).sort();
            expect(footprintCoords).toEqual(['10,10', '10,11', '11,10', '11,11']);
        });

        it('should capture all 9 footprint tiles for a 3x3 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.StorageArea);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(9);
        });

        it('should capture 1 footprint tile for a 1x1 decoration', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Decoration);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(1);
            expect(footprintTiles[0].x).toBe(10);
            expect(footprintTiles[0].y).toBe(10);
        });

        it('should capture cardinal neighbors of the footprint', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const neighborTiles = captured.tiles.filter(t => !t.isFootprint);
            expect(neighborTiles.length).toBeGreaterThanOrEqual(8);
        });

        it('should not create duplicate tiles for shared neighbors', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const coordKeys = captured.tiles.map(t => `${t.x},${t.y}`);
            const uniqueKeys = new Set(coordKeys);
            expect(uniqueKeys.size).toBe(coordKeys.length);
        });

        it('should preserve original ground types and heights', () => {
            const map = createTestMap();
            map.groundType[map.mapSize.toIndex(10, 10)] = TERRAIN.DESERT;
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 80;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 90;

            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const tile1010 = captured.tiles.find(t => t.x === 10 && t.y === 10);
            expect(tile1010).toBeDefined();
            expect(tile1010!.originalGroundType).toBe(TERRAIN.DESERT);
            expect(tile1010!.originalGroundHeight).toBe(100);

            const tile1110 = captured.tiles.find(t => t.x === 11 && t.y === 10);
            expect(tile1110!.originalGroundHeight).toBe(120);
        });

        it('should compute target height as average of all captured tiles', () => {
            const map = createTestMap(64, 64, { flatHeight: 100 });
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            expect(captured.targetHeight).toBe(100);
        });

        it('should handle building at map edge', () => {
            const map = createTestMap();
            const bs = makeBuildingState(0, 0, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            for (const tile of captured.tiles) {
                expect(tile.x).toBeGreaterThanOrEqual(0);
                expect(tile.y).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe('applyTerrainLeveling', () => {
        it('should not modify terrain at progress 0', () => {
            const map = createTestMap(64, 64, { flatHeight: 100 });
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const modified = applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 0);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(modified).toBe(false);
        });

        it('should NOT change ground type for neighbor tiles', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            expect(map.groundType[map.mapSize.toIndex(9, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(12, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(10, 9)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(10, 12)]).toBe(TERRAIN.GRASS);
        });

        it('should interpolate heights toward target at partial progress', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 200;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 0;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 0;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 0;

            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 0.5);

            const h1010 = map.groundHeight[map.mapSize.toIndex(10, 10)];
            const expected1010 = Math.round(200 + (target - 200) * 0.5);
            expect(h1010).toBe(expected1010);
        });

        it('should level all heights to target at progress 1.0', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 200;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 50;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 150;

            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            for (const tile of getBuildingFootprint(10, 10, BuildingType.WoodcutterHut)) {
                expect(map.groundHeight[map.mapSize.toIndex(tile.x, tile.y)]).toBe(target);
            }
        });

        it('should change ground type on all tiles of a 3x3 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.StorageArea);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            const footprint = getBuildingFootprint(10, 10, BuildingType.StorageArea);
            expect(footprint).toHaveLength(9);
            for (const tile of footprint) {
                expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }
        });
    });

    describe('restoreOriginalTerrain', () => {
        it('should restore ground types and heights for all tiles', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;

            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);
            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            const modified = restoreOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(true);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(11, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundHeight[map.mapSize.toIndex(10, 10)]).toBe(100);
            expect(map.groundHeight[map.mapSize.toIndex(11, 10)]).toBe(120);
        });

        it('should return false when no original terrain is captured', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut);

            const modified = restoreOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// Building Construction Phases
// ---------------------------------------------------------------------------

describe('Building Construction Phases', () => {
    describe('getBuildingVisualState', () => {
        it('should return completed state for undefined building state', () => {
            const state = getBuildingVisualState(undefined);
            expect(state.isCompleted).toBe(true);
            expect(state.verticalProgress).toBe(1.0);
        });

        it('should return zero vertical progress during Poles phase', () => {
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut, {
                phase: BuildingConstructionPhase.Poles,
                phaseProgress: 0.5,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.0);
        });

        it('should return zero vertical progress during TerrainLeveling phase', () => {
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut, {
                phase: BuildingConstructionPhase.TerrainLeveling,
                phaseProgress: 0.5,
            });
            const state = getBuildingVisualState(bs);
            expect(state.verticalProgress).toBe(0.0);
        });

        it('should use construction sprite with rising progress during ConstructionRising', () => {
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut, {
                phase: BuildingConstructionPhase.ConstructionRising,
                phaseProgress: 0.6,
                elapsedTime: 15,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.6);
        });

        it('should use completed sprite during CompletedRising', () => {
            const bs = makeBuildingState(10, 10, BuildingType.WoodcutterHut, {
                phase: BuildingConstructionPhase.CompletedRising,
                phaseProgress: 0.8,
                elapsedTime: 25,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(false);
            expect(state.verticalProgress).toBe(0.8);
        });
    });

    describe('BuildingConstructionSystem with terrain', () => {
        it('should transition through all phases and modify terrain', () => {
            const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
            groundType.fill(TERRAIN.GRASS);
            groundHeight.fill(100);

            const gameState = new GameState();
            gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 10, 10, 0);
            const bs = gameState.buildingStateManager.buildingStates.values().next().value as BuildingState;
            bs.totalDuration = 10; // 10 seconds total

            let terrainNotified = false;
            const ctx: TerrainContext = {
                groundType,
                groundHeight,
                mapSize,
                onTerrainModified: () => { terrainNotified = true },
            };

            // Phase 1: TerrainLeveling starts immediately (0-20% = 0-2s)
            // First tick captures terrain and starts leveling
            tickConstruction(gameState, 0.5, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
            expect(bs.originalTerrain).not.toBeNull();
            expect(terrainNotified).toBe(true);

            // All footprint tiles should have construction ground type
            const footprint = getBuildingFootprint(10, 10, BuildingType.WoodcutterHut);
            for (const tile of footprint) {
                expect(groundType[mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }

            // Phase 2: ConstructionRising (20-55% = 2-5.5s)
            tickConstruction(gameState, 2.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.ConstructionRising);

            // Phase 3: CompletedRising (55-100% = 5.5-10s)
            tickConstruction(gameState, 4.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.CompletedRising);

            // Phase 4: Completed
            tickConstruction(gameState, 5.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        });
    });
});

// ---------------------------------------------------------------------------
// Barracks unit spawning on construction complete
// ---------------------------------------------------------------------------

describe('Barracks unit spawning on construction complete', () => {
    it('should spawn swordsmen when barrack construction completes', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const barrack = gameState.addEntity(EntityType.Building, BuildingType.Barrack, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(barrack.id)!;

        // Initially should have only the building
        expect(gameState.entities.filter(e => e.type === EntityType.Unit)).toHaveLength(0);

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        // Fast-forward to just before completion
        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        // Building should now be completed
        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);

        // Should have spawned 3 swordsmen (BUILDING_SPAWN_ON_COMPLETE for Barrack)
        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(3);
        for (const unit of units) {
            expect(unit.subType).toBe(2); // UnitType.Swordsman = 2
            expect(unit.player).toBe(0);
        }
    });

    it('should spawn units adjacent to the building', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const barrack = gameState.addEntity(EntityType.Building, BuildingType.Barrack, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(barrack.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        // Complete the building
        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        for (const unit of units) {
            const dist = Math.abs(unit.x - 10) + Math.abs(unit.y - 10);
            expect(dist).toBeLessThanOrEqual(3); // Within EXTENDED_OFFSETS range
        }
    });

    it('should not spawn units for non-barrack buildings', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const lj = gameState.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(lj.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        // Lumberjack auto-spawns at placement time (via BUILDING_UNIT_TYPE), not on completion
        // No additional unit should be spawned by the construction system
        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(0);
    });

    it('should handle limited space around the building gracefully', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const barrack = gameState.addEntity(EntityType.Building, BuildingType.Barrack, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(barrack.id)!;

        // Block tiles in expanding rings with water (radius up to 4), leave only 2 free
        for (let y = 6; y <= 15; y++) {
            for (let x = 6; x <= 15; x++) {
                if (x >= 10 && x <= 11 && y >= 10 && y <= 11) continue; // skip footprint
                groundType[mapSize.toIndex(x, y)] = 0; // water
            }
        }
        // Open up exactly 2 passable tiles
        groundType[mapSize.toIndex(9, 10)] = TERRAIN.GRASS;
        groundType[mapSize.toIndex(12, 10)] = TERRAIN.GRASS;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        // Complete the building
        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        // Should have spawned fewer than 3 units (only 2 free tiles available)
        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBeGreaterThan(0);
        expect(units.length).toBeLessThanOrEqual(2);
    });

    it('should not spawn units on water tiles', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const barrack = gameState.addEntity(EntityType.Building, BuildingType.Barrack, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(barrack.id)!;

        // Surround the building with water in a wide area (radius 4 search area)
        for (let y = 6; y <= 15; y++) {
            for (let x = 6; x <= 15; x++) {
                // Skip the barrack's own footprint tiles (2x2 at 10,10)
                if (x >= 10 && x <= 11 && y >= 10 && y <= 11) continue;
                groundType[mapSize.toIndex(x, y)] = 0; // water
            }
        }

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        // No units should spawn since all surrounding tiles are water
        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(0);
    });

    it('should spawn unselectable carriers from SmallHouse', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const house = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(house.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(2); // SmallHouse spawns 2
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn unselectable carriers from MediumHouse', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const house = gameState.addEntity(EntityType.Building, BuildingType.ResidenceMedium, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(house.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(4); // MediumHouse spawns 4
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn unselectable carriers from LargeHouse', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const house = gameState.addEntity(EntityType.Building, BuildingType.ResidenceBig, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(house.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(6); // LargeHouse spawns 6
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn selectable swordsmen from Barrack', () => {
        const { mapSize, groundType, groundHeight } = createTestMap(64, 64);
        const gameState = new GameState();
        const barrack = gameState.addEntity(EntityType.Building, BuildingType.Barrack, 10, 10, 0);
        const bs = gameState.buildingStateManager.getBuildingState(barrack.id)!;

        const ctx: TerrainContext = {
            groundType,
            groundHeight,
            mapSize,
        };

        bs.elapsedTime = bs.totalDuration - 0.1;
        tickConstruction(gameState, 0.2, ctx);

        const units = gameState.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(3);
        for (const unit of units) {
            expect(unit.selectable).toBe(true); // Barrack units ARE selectable
        }
    });
});
