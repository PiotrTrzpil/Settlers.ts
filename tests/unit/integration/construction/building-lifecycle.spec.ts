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

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Building construction (real game data)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ─── Instant placement (completed=true) ──────────────────────────

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

        // Instant placement skips construction workers (builders/diggers)
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

        // Flood the area, keep only footprint tiles as grass
        sim.fillTerrain(cx, cy, 10, TERRAIN.WATER);
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                sim.map.groundType[sim.map.mapSize.toIndex(cx + dx, cy + dy)] = TERRAIN.GRASS;
            }
        }

        sim.placeBuildingAt(cx, cy, BuildingType.ResidenceSmall);

        // Carriers can't spawn — all surrounding tiles are water
        expect(sim.countEntities(EntityType.Unit)).toBe(0);
    });

    // ─── Full construction flow (pre-spawned specialists) ──────────────

    it('WoodcutterHut: pre-spawned digger+builders complete construction', { timeout: 30_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        sim.waitForConstructionComplete(s.siteId);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Full construction flow (auto-recruited from carriers) ───────

    it(
        'WoodcutterHut: carriers auto-recruit into digger+builders and complete construction',
        { timeout: 30_000 },
        () => {
            sim = createSimulation();

            // Residence for carrier supply
            sim.placeBuilding(BuildingType.ResidenceSmall);

            // Storage with construction materials
            const storageId = sim.placeBuilding(BuildingType.StorageArea);
            sim.injectOutput(storageId, EMaterialType.BOARD, 8);
            sim.injectOutput(storageId, EMaterialType.STONE, 8);

            // Tools as free piles (ToolSourceResolver only finds free piles)
            sim.placeGoods(EMaterialType.SHOVEL, 4);
            sim.placeGoods(EMaterialType.HAMMER, 4);

            // No pre-spawned specialists — only carriers from residence
            expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(0);
            expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(0);
            expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBeGreaterThan(0);

            // Place as construction site (not completed)
            const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

            sim.waitForConstructionComplete(siteId);

            expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
            expect(sim.errors).toHaveLength(0);
        }
    );

    // ─── Edge cases: destruction during construction ─────────────────

    it('removing building before construction starts cleans up site and restores terrain', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        // No diggers spawned — flat terrain completes leveling instantly → WaitingForBuilders
        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        expect(sim.services.constructionSiteManager.getSite(hutId)!.phase).toBe(
            BuildingConstructionPhase.WaitingForBuilders
        );

        // Footprint should be DustyWay
        const hut = sim.state.getEntityOrThrow(hutId, 'test');
        const idx = sim.map.mapSize.toIndex(hut.x, hut.y);
        expect(sim.map.groundType[idx]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

        sim.removeBuilding(hutId);

        expect(sim.services.constructionSiteManager.hasSite(hutId)).toBe(false);
        expect(sim.map.groundType[idx]).not.toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        expect(sim.errors).toHaveLength(0);
    });

    it('removing building after leveling complete releases digger without errors', { timeout: 10_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Wait until terrain leveling is done (flat terrain → completes instantly on first digger cycle)
        sim.waitForPhase(s.siteId, BuildingConstructionPhase.WaitingForBuilders);

        expect(sim.services.constructionSiteManager.getSite(s.siteId)!.terrain.complete).toBe(true);

        // Digger should still exist
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(1);

        sim.removeBuilding(s.siteId);

        expect(sim.services.constructionSiteManager.hasSite(s.siteId)).toBe(false);

        // Workers survive building removal
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(2);

        // No crashes when workers discover their target is gone
        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    it('removing building during ConstructionRising releases builder and carriers', { timeout: 30_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Wait for builder to start constructing — check each tick, remove mid-progress
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
        // All workers survive
        expect(sim.countEntities(EntityType.Unit)).toBe(unitsBefore);
        // No woodcutter spawned (building never completed)
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);

        // No crashes when carriers/builders discover their target is gone
        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Edge cases: evacuation from construction site ──────────────

    it('carriers on footprint are evacuated when leveling completes', { timeout: 30_000 }, () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        // Plenty of carriers to deliver materials — some will be on the footprint
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        // Storage with lots of materials right next to the future farm
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Create uneven terrain so leveling takes many ticks
        createSlope(sim.map, 20, 20, 80, 80, 0, 40);

        // Tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Place a large farm as construction site — big footprint, many carriers delivering
        const siteId = sim.placeBuildingAt(40, 40, BuildingType.GrainFarm, 0, false);

        // Wait for leveling to complete and check that evacuation happened
        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 80_000);

        // After evacuation, no VISIBLE unit should be on the building's block area
        const building = sim.state.getEntityOrThrow(siteId, 'test');
        const blockArea = getBuildingBlockArea(building.x, building.y, BuildingType.GrainFarm, building.race);
        const footprintKeys = new Set(blockArea.map(t => `${t.x},${t.y}`));

        // Give a few ticks for evacuation moves to execute
        sim.runTicks(60);

        const unitsOnFootprint = sim.state.entities.filter(
            e => e.type === EntityType.Unit && !e.hidden && footprintKeys.has(`${e.x},${e.y}`)
        );

        expect(unitsOnFootprint).toHaveLength(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Edge cases: material shortage ───────────────────────────────

    it('construction pauses when materials run out, resumes on resupply', { timeout: 30_000 }, () => {
        // Only 1 of each material — not enough to finish
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 1],
            [EMaterialType.STONE, 1],
        ]);
        sim = s;

        // Run until builder consumes available materials and stalls
        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                return (
                    !!site &&
                    site.materials.consumedAmount > 0 &&
                    !sim.services.constructionSiteManager.hasAvailableMaterials(s.siteId)
                );
            },
            { maxTicks: 50_000, label: 'materials exhausted' }
        );

        const stalledSite = sim.services.constructionSiteManager.getSite(s.siteId)!;
        expect(stalledSite.building.progress).toBeGreaterThan(0);
        expect(stalledSite.building.progress).toBeLessThan(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);

        const progressBeforeResupply = stalledSite.building.progress;

        // Resupply
        sim.injectOutput(s.storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(s.storageId, EMaterialType.STONE, 8);

        sim.waitForConstructionComplete(s.siteId);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(progressBeforeResupply).toBeLessThan(1);
        expect(sim.errors).toHaveLength(0);
    });
});
