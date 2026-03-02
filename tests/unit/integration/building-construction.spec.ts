/**
 * Integration tests for building construction and unit spawning.
 * Uses the full simulation harness with real game data.
 *
 * Tests both instant placement (completed=true) and full construction
 * flow where diggers/builders do the actual work.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, Simulation } from '../helpers/test-simulation';
import { installRealGameData } from '../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/race';
import { TERRAIN } from '../helpers/test-map';

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

        // Fill a region with water, leaving only footprint + door corridor as grass
        const cx = 30;
        const cy = 30;
        for (let y = cy - 10; y <= cy + 10; y++) {
            for (let x = cx - 10; x <= cx + 10; x++) {
                sim.map.groundType[sim.map.mapSize.toIndex(x, y)] = 0; // water
            }
        }
        // Keep footprint area (3x3 to include door) as grass for valid placement
        for (let dy = -1; dy <= 2; dy++) {
            for (let dx = -1; dx <= 2; dx++) {
                sim.map.groundType[sim.map.mapSize.toIndex(cx + dx, cy + dy)] = TERRAIN.GRASS;
            }
        }
        // Now block everything outside the footprint so no units can spawn
        for (let dy = -1; dy <= 2; dy++) {
            for (let dx = -1; dx <= 2; dx++) {
                if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue; // keep footprint
                sim.map.groundType[sim.map.mapSize.toIndex(cx + dx, cy + dy)] = 0; // water
            }
        }

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.ResidenceSmall,
            x: cx,
            y: cy,
            player: 0,
            race: Race.Roman,
            completed: true,
            spawnWorker: true,
        });
        expect(result.success).toBe(true);

        // Carriers can't spawn — all surrounding tiles are water
        expect(sim.countEntities(EntityType.Unit)).toBe(0);
    });

    // ─── Full construction flow ──────────────────────────────────────

    it('WoodcutterHut: full construction → worker spawned', { timeout: 30_000 }, () => {
        sim = createSimulation({ buildingSpacing: 20 });

        // Residence provides carriers (instant placement skips builders)
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        // Manually spawn digger and builder (instant placement doesn't spawn construction workers)
        sim.spawnUnitNear(residenceId, UnitType.Digger);
        sim.spawnUnitNear(residenceId, UnitType.Builder);

        // StorageArea provides materials for construction via logistics
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Place WoodcutterHut as construction site
        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Run until construction completes (full flow: dig → deliver materials → build)
        sim.runUntil(() => !sim.services.constructionSiteManager.hasSite(hutId), { maxTicks: 50_000 });

        // Diagnostics on failure only
        if (sim.services.constructionSiteManager.hasSite(hutId)) {
            const s = sim.services.constructionSiteManager.getSite(hutId)!;
            const remaining = sim.services.constructionSiteManager.getRemainingCosts(hutId);
            console.log(
                `[stuck] phase=${s.phase}, progress=${s.constructionProgress}, remaining=${JSON.stringify(remaining)}`
            );
            console.log(
                `[stuck] delivered=${s.deliveredAmount}, consumed=${s.consumedAmount}, leveling=${s.levelingComplete}`
            );
        }

        expect(sim.services.constructionSiteManager.hasSite(hutId)).toBe(false);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});
