/**
 * Integration tests for building construction and unit spawning.
 * Uses the full simulation harness with real game data.
 *
 * Tests both instant placement (completed=true) and full construction
 * flow where diggers/builders do the actual work.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, createScenario, cleanupSimulation, Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { getBuildingBlockArea } from '@/game/buildings/types';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase, CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import { TERRAIN, createSlope } from '../../helpers/test-map';

installRealGameData();

// ─── Instant placement (completed=true) ──────────────────────────

describe('Building construction: instant placement', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('production building spawns its dedicated worker on instant completion', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.WoodcutterHut);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
    });

    it('barrack does not spawn soldiers on instant completion', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.Barrack);

        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman1)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Bowman1)).toBe(0);
    });

    it('ResidenceSmall spawns 2 carriers on instant completion (no construction workers)', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(2);
    });

    it('ResidenceMedium spawns 4 carriers on instant completion (no construction workers)', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceMedium);

        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(4);
    });

    it('ResidenceBig spawns 6 carriers on instant completion (no construction workers)', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceBig);

        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(6);
    });

    it('spawned units are not selectable', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const units = sim.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBeGreaterThan(0);
        for (const unit of units) {
            expect(unit.selectable).toBe(false);
        }
    });

    it.skip('no units spawn when building is surrounded by water', () => {
        sim = createSimulation();
        const cx = 30;
        const cy = 30;

        sim.fillTerrain(cx, cy, 10, TERRAIN.WATER);
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                sim.map.groundType[sim.map.mapSize.toIndex({ x: cx + dx, y: cy + dy })] = TERRAIN.GRASS;
            }
        }

        sim.placeBuildingAt(cx, cy, BuildingType.ResidenceSmall);

        expect(sim.countEntities(EntityType.Unit)).toBe(0);
    });
});

// ─── Full construction flow ──────────────────────────────────────

describe('Building construction: full flow', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('WoodcutterHut: pre-spawned digger+builders complete construction', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        sim.waitForConstructionComplete(s.siteId);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('WoodcutterHut: carriers auto-recruit into digger+builders and complete construction', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 4);
        sim.placeGoods(EMaterialType.HAMMER, 4);

        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBeGreaterThan(0);

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForConstructionComplete(siteId);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('free ground piles are usable by non-zero player for construction recruitment', () => {
        sim = createSimulation({ skipTerritory: true });
        const player = 1;

        // Establish territory for player 1 so buildings can be placed
        sim.establishTerritory(player);

        sim.placeBuilding(BuildingType.ResidenceSmall, player);

        const storageId = sim.placeBuilding(BuildingType.StorageArea, player);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 4);
        sim.placeGoods(EMaterialType.HAMMER, 4);

        // Free piles must belong to the territory owner, not player 0
        const shovels = sim.state.entities.filter(
            e => e.type === EntityType.StackedPile && e.subType === EMaterialType.SHOVEL
        );
        expect(shovels.length).toBeGreaterThan(0);
        for (const pile of shovels) {
            expect(pile.player, `SHOVEL pile ${pile.id} should belong to player ${player}`).toBe(player);
        }

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, player, false);

        sim.waitForConstructionComplete(siteId, 80_000);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Edge cases ──────────────────────────────────────────────────

describe('Building construction: edge cases', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('removing building before construction starts cleans up site and restores terrain', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        expect(sim.services.constructionSiteManager.getSite(hutId)!.phase).toBe(
            BuildingConstructionPhase.WaitingForBuilders
        );

        const hut = sim.state.getEntityOrThrow(hutId, 'test');
        const idx = sim.map.mapSize.toIndex(hut);
        expect(sim.map.groundType[idx]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

        sim.removeBuilding(hutId);

        expect(sim.services.constructionSiteManager.hasSite(hutId)).toBe(false);
        expect(sim.map.groundType[idx]).not.toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        expect(sim.errors).toHaveLength(0);
    });

    it('removing building after leveling complete releases digger without errors', { timeout: 10_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        sim.waitForPhase(s.siteId, BuildingConstructionPhase.WaitingForBuilders);

        expect(sim.services.constructionSiteManager.getSite(s.siteId)!.terrain.complete).toBe(true);
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(1);

        sim.removeBuilding(s.siteId);

        expect(sim.services.constructionSiteManager.hasSite(s.siteId)).toBe(false);
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(2);

        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    it('removing building during ConstructionRising releases builder and carriers', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                return (
                    !!site && site.phase >= BuildingConstructionPhase.ConstructionRising && site.building.progress > 0
                );
            },
            { maxTicks: 50_000, label: 'builder makes progress' }
        );

        const site = sim.services.constructionSiteManager.getSite(s.siteId);
        expect(site).toBeDefined();
        expect(site!.building.progress).toBeGreaterThan(0);

        const unitsBefore = sim.countEntities(EntityType.Unit);

        sim.removeBuilding(s.siteId);

        expect(sim.services.constructionSiteManager.hasSite(s.siteId)).toBe(false);
        expect(sim.countEntities(EntityType.Unit)).toBe(unitsBefore);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);

        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    it('carriers on footprint are evacuated when leveling completes', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        createSlope(sim.map, 110, 110, 150, 150, 0, 40);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        const siteId = sim.placeBuilding(BuildingType.GrainFarm, 0, false);

        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 80_000);

        const building = sim.state.getEntityOrThrow(siteId, 'test');
        const blockArea = getBuildingBlockArea({ x: building.x, y: building.y }, BuildingType.GrainFarm, building.race);
        const footprintKeys = new Set(blockArea.map(t => `${t.x},${t.y}`));

        sim.runTicks(60);

        const unitsOnFootprint = sim.state.entities.filter(
            e => e.type === EntityType.Unit && !e.hidden && footprintKeys.has(`${e.x},${e.y}`)
        );

        expect(unitsOnFootprint).toHaveLength(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('construction pauses when materials run out, resumes on resupply', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 1],
            [EMaterialType.STONE, 1],
        ]);
        sim = s;

        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                if (!site) {
                    return false;
                }
                const totalOut = site.materials.costs.reduce(
                    (sum, c) => sum + sim.services.inventoryManager.getThroughput(s.siteId, c.material).totalOut,
                    0
                );
                return totalOut > 0 && !sim.services.constructionSiteManager.hasAvailableMaterials(s.siteId);
            },
            { maxTicks: 50_000, label: 'materials exhausted' }
        );

        const stalledSite = sim.services.constructionSiteManager.getSite(s.siteId)!;
        expect(stalledSite.building.progress).toBeGreaterThan(0);
        expect(stalledSite.building.progress).toBeLessThan(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);

        const progressBeforeResupply = stalledSite.building.progress;

        sim.injectOutput(s.storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(s.storageId, EMaterialType.STONE, 8);

        sim.waitForConstructionComplete(s.siteId);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(progressBeforeResupply).toBeLessThan(1);
        expect(sim.errors).toHaveLength(0);
    });
});
