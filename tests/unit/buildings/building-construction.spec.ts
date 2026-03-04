/**
 * Tests for building construction: terrain leveling and construction phases.
 *
 * Note: screenToTile height refinement and heightToWorld tests have been
 * consolidated into coordinates.spec.ts where they logically belong.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuildingType, getBuildingFootprint, EntityType } from '@/game/entity';
import { Race } from '@/game/race';
import { UnitType } from '@/game/unit-types';
import {
    BuildingConstructionPhase,
    type ConstructionSite,
    getBuildingVisualState,
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import type { TerrainBuildingParams } from '@/game/features/building-construction/terrain';
import { createTestMap, TERRAIN } from '../helpers/test-map';
import { createTestContext, completeConstruction, type TestContext } from '../helpers/test-game';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';

/**
 * Create a minimal TerrainBuildingParams object for testing terrain functions.
 * The new terrain functions accept a narrow params interface (not ConstructionSite).
 */
function makeTerrainParams(
    tileX: number,
    tileY: number,
    buildingType: BuildingType,
    race = Race.Roman
): TerrainBuildingParams {
    return { buildingType, race, tileX, tileY };
}

// ---------------------------------------------------------------------------
// Terrain Leveling
// ---------------------------------------------------------------------------

describe('Terrain Leveling', () => {
    beforeEach(() => {
        installTestGameData();
    });
    afterEach(() => {
        resetTestGameData();
    });

    describe('captureOriginalTerrain', () => {
        it('should capture all 4 footprint tiles for a 2x2 building', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            const footprintCoords = footprintTiles.map(t => `${t.x},${t.y}`).sort();
            expect(footprintCoords).toEqual(['10,10', '10,11', '11,10', '11,11']);
        });

        it('should capture all 9 footprint tiles for a 3x3 building', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.StorageArea);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(9);
        });

        it('should capture 1 footprint tile for a 1x1 decoration', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.Eyecatcher01);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(1);
            expect(footprintTiles[0]!.x).toBe(10);
            expect(footprintTiles[0]!.y).toBe(10);
        });

        it('should capture cardinal neighbors of the footprint', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const neighborTiles = captured.tiles.filter(t => !t.isFootprint);
            expect(neighborTiles.length).toBeGreaterThanOrEqual(8);
        });

        it('should not create duplicate tiles for shared neighbors', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

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

            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const tile1010 = captured.tiles.find(t => t.x === 10 && t.y === 10);
            expect(tile1010).toBeDefined();
            expect(tile1010!.originalGroundType).toBe(TERRAIN.DESERT);
            expect(tile1010!.originalGroundHeight).toBe(100);

            const tile1110 = captured.tiles.find(t => t.x === 11 && t.y === 10);
            expect(tile1110!.originalGroundHeight).toBe(120);
        });

        it('should compute target height as average of all captured tiles', () => {
            const map = createTestMap(64, 64, { flatHeight: 100 });
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            expect(captured.targetHeight).toBe(100);
        });

        it('should handle building at map edge', () => {
            const map = createTestMap();
            const params = makeTerrainParams(0, 0, BuildingType.WoodcutterHut);

            const captured = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

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
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            const modified = applyTerrainLeveling(
                params,
                map.groundType,
                map.groundHeight,
                map.mapSize,
                0,
                originalTerrain
            );

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(modified).toBe(false);
        });

        it('should NOT change ground type for neighbor tiles', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);

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

            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);
            const target = originalTerrain.targetHeight;

            applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 0.5, originalTerrain);

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

            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);
            const target = originalTerrain.targetHeight;

            applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);

            for (const tile of getBuildingFootprint(10, 10, BuildingType.WoodcutterHut, Race.Roman)) {
                expect(map.groundHeight[map.mapSize.toIndex(tile.x, tile.y)]).toBe(target);
            }
        });

        it('should change ground type on all tiles of a 3x3 building', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.StorageArea);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);

            const footprint = getBuildingFootprint(10, 10, BuildingType.StorageArea, Race.Roman);
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

            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(params, map.groundType, map.groundHeight, map.mapSize, 1.0, originalTerrain);
            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            const modified = restoreOriginalTerrain(originalTerrain, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(true);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(11, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundHeight[map.mapSize.toIndex(10, 10)]).toBe(100);
            expect(map.groundHeight[map.mapSize.toIndex(11, 10)]).toBe(120);
        });

        it('should return false when no terrain has been modified from the original', () => {
            const map = createTestMap();
            const params = makeTerrainParams(10, 10, BuildingType.WoodcutterHut);
            const originalTerrain = captureOriginalTerrain(params, map.groundType, map.groundHeight, map.mapSize);

            // Restore without any prior leveling — terrain hasn't changed so nothing to undo
            const modified = restoreOriginalTerrain(originalTerrain, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// Building Construction Phases
// ---------------------------------------------------------------------------

describe('Building Construction Phases', () => {
    describe('getBuildingVisualState', () => {
        it('should return completed state for undefined construction site', () => {
            const state = getBuildingVisualState(undefined);
            expect(state.isCompleted).toBe(true);
            expect(state.verticalProgress).toBe(1.0);
        });

        it('should return zero vertical progress during WaitingForDiggers phase', () => {
            const site = {
                phase: BuildingConstructionPhase.WaitingForDiggers,
                terrain: { progress: 0.5 },
                building: { progress: 0 },
                completedRisingProgress: 0,
            } as Partial<ConstructionSite> as ConstructionSite;
            const state = getBuildingVisualState(site);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.0);
        });

        it('should use construction sprite with rising progress during ConstructionRising', () => {
            const site = {
                phase: BuildingConstructionPhase.ConstructionRising,
                terrain: { progress: 1.0 },
                building: { progress: 0.6 },
                completedRisingProgress: 0,
            } as Partial<ConstructionSite> as ConstructionSite;
            const state = getBuildingVisualState(site);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.6);
        });

        it('should use completed sprite during CompletedRising', () => {
            const site = {
                phase: BuildingConstructionPhase.CompletedRising,
                terrain: { progress: 1.0 },
                building: { progress: 1.0 },
                completedRisingProgress: 0.8,
            } as Partial<ConstructionSite> as ConstructionSite;
            const state = getBuildingVisualState(site);
            expect(state.useConstructionSprite).toBe(false);
            expect(state.verticalProgress).toBe(0.8);
        });
    });

    describe('BuildingConstructionSystem with terrain', () => {
        let ctx: TestContext;

        beforeEach(() => {
            ctx = createTestContext();
            ctx.map.groundType.fill(TERRAIN.GRASS);
            ctx.map.groundHeight.fill(100);
            // Make some tiles uneven so per-tile leveling has work to do
            const footprint = getBuildingFootprint(10, 10, BuildingType.WoodcutterHut, Race.Roman);
            for (const tile of footprint) {
                ctx.map.groundHeight[ctx.map.mapSize.toIndex(tile.x, tile.y)] = 110;
            }
        });

        it('should transition through all phases and modify terrain', () => {
            let terrainNotified = false;
            ctx.buildingConstructionSystem.setTerrainContext({
                terrain: ctx.map.terrain,
                onTerrainModified: () => {
                    terrainNotified = true;
                },
            });

            const building = ctx.state.addEntity(
                EntityType.Building,
                BuildingType.WoodcutterHut,
                10,
                10,
                0,
                undefined,
                undefined,
                Race.Roman
            );

            // Register a construction site so the system can track it
            ctx.constructionSiteManager.registerSite(building.id, BuildingType.WoodcutterHut, Race.Roman, 0, 10, 10);
            const site = ctx.constructionSiteManager.getSiteOrThrow(building.id, 'test');

            // Phase 0: starts in WaitingForDiggers
            expect(site.phase).toBe(BuildingConstructionPhase.WaitingForDiggers);

            // Phase 1: diggingStarted → TerrainLeveling (captures terrain + populates per-tile set)
            ctx.eventBus.emit('construction:diggingStarted', { buildingId: building.id });
            expect(site.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
            expect(site.terrain.originalTerrain).not.toBeNull();
            expect(site.terrain.unleveledTiles).not.toBeNull();
            expect(site.terrain.unleveledTiles!.size).toBeGreaterThan(0);

            // Complete all tiles one by one (per-tile leveling)
            while (site.terrain.unleveledTiles!.size > 0) {
                ctx.constructionSiteManager.completeNextTile(building.id);
            }

            // Phase 2: levelingComplete fires automatically → WaitingForBuilders
            expect(site.terrain.complete).toBe(true);
            expect(site.phase).toBe(BuildingConstructionPhase.WaitingForBuilders);
            expect(terrainNotified).toBe(true);

            // All footprint tiles should have construction ground type
            const footprint = getBuildingFootprint(10, 10, BuildingType.WoodcutterHut, Race.Roman);
            for (const tile of footprint) {
                expect(ctx.map.groundType[ctx.map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }

            // Phase 3: buildingStarted → ConstructionRising
            ctx.eventBus.emit('construction:buildingStarted', { buildingId: building.id });
            expect(site.phase).toBe(BuildingConstructionPhase.ConstructionRising);

            // Phase 4: progressComplete → CompletedRising (starts countdown timer)
            ctx.eventBus.emit('construction:progressComplete', { buildingId: building.id });
            expect(site.phase).toBe(BuildingConstructionPhase.CompletedRising);

            // Phase 5: tick past CompletedRising countdown (COMPLETED_RISING_DURATION = 0.5s)
            ctx.buildingConstructionSystem.tick(0.6);
            // After completion, the site is removed — building is now operational
            expect(ctx.constructionSiteManager.hasSite(building.id)).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// Unit spawning on construction complete
// ---------------------------------------------------------------------------

describe('Unit spawning on construction complete', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('should not spawn soldiers when barrack construction completes (trained via barracks system)', () => {
        const barrack = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.Barrack,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );

        completeConstruction(ctx, barrack.id);

        // After completion, construction site is removed — building is operational
        expect(ctx.constructionSiteManager.hasSite(barrack.id)).toBe(false);

        // Barracks no longer spawn soldiers on construction — training pipeline handles this
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(0);
    });

    it('should spawn dedicated worker for production buildings', () => {
        const lj = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.WoodcutterHut,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );

        completeConstruction(ctx, lj.id);

        // After completion, construction site is removed — building is operational
        expect(ctx.constructionSiteManager.hasSite(lj.id)).toBe(false);
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(1);
        expect(units[0]!.subType).toBe(UnitType.Woodcutter);
    });

    it('should handle limited space around the building gracefully', () => {
        const house = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.ResidenceSmall,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );

        // Block tiles in expanding rings with water, leave only 1 free
        for (let y = 6; y <= 15; y++) {
            for (let x = 6; x <= 15; x++) {
                if (x >= 10 && x <= 11 && y >= 10 && y <= 11) continue; // skip footprint
                ctx.map.groundType[ctx.map.mapSize.toIndex(x, y)] = 0; // water
            }
        }
        ctx.map.groundType[ctx.map.mapSize.toIndex(9, 10)] = TERRAIN.GRASS;
        ctx.map.groundType[ctx.map.mapSize.toIndex(12, 10)] = TERRAIN.GRASS;

        completeConstruction(ctx, house.id);

        // ResidenceSmall tries 1 builder + 2 carriers = 3 units, but only 2 land tiles available
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBeGreaterThan(0);
        expect(units.length).toBeLessThanOrEqual(3);
    });

    it('should not spawn units on water tiles', () => {
        const house = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.ResidenceSmall,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );

        // Surround the building with water in a wide area
        for (let y = 6; y <= 15; y++) {
            for (let x = 6; x <= 15; x++) {
                if (x >= 10 && x <= 11 && y >= 10 && y <= 11) continue;
                ctx.map.groundType[ctx.map.mapSize.toIndex(x, y)] = 0; // water
            }
        }

        completeConstruction(ctx, house.id);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(0);
    });

    it('should spawn unselectable units from SmallHouse', () => {
        const house = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.ResidenceSmall,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );
        completeConstruction(ctx, house.id);

        // 1 builder (immediate) + 2 carriers (residence spawner immediate mode)
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(3);
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn unselectable units from MediumHouse', () => {
        const house = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.ResidenceMedium,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );
        completeConstruction(ctx, house.id);

        // 1 builder + 1 digger (immediate) + 4 carriers (residence spawner immediate mode)
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(6);
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn unselectable units from LargeHouse', () => {
        const house = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.ResidenceBig,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );
        completeConstruction(ctx, house.id);

        // 2 builders + 1 digger (immediate) + 6 carriers (residence spawner immediate mode)
        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(9);
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it('should spawn no units from Barrack on completion (soldiers come from training)', () => {
        const barrack = ctx.state.addEntity(
            EntityType.Building,
            BuildingType.Barrack,
            10,
            10,
            0,
            undefined,
            undefined,
            Race.Roman
        );
        completeConstruction(ctx, barrack.id);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units).toHaveLength(0);
    });
});
