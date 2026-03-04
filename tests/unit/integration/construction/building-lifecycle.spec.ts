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
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase, CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import { TERRAIN } from '../../helpers/test-map';

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

        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Bowman)).toBe(0);
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

    // ─── Full construction flow ──────────────────────────────────────

    it('WoodcutterHut: full construction → worker spawned', { timeout: 30_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        sim.waitForConstructionComplete(s.siteId);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Edge cases: destruction during construction ─────────────────

    it('removing building during WaitingForDiggers cleans up site and restores terrain', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        // No diggers spawned — stays in WaitingForDiggers
        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        expect(sim.services.constructionSiteManager.getSite(hutId)!.phase).toBe(
            BuildingConstructionPhase.WaitingForDiggers
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
        expect(sim.countEntities(EntityType.Unit, UnitType.Builder)).toBe(1);

        // No crashes when workers discover their target is gone
        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    it('removing building during ConstructionRising releases builder and carriers', { timeout: 30_000 }, () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Wait for builder to start constructing
        const site = sim.waitForPhase(s.siteId, BuildingConstructionPhase.ConstructionRising);
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
