/**
 * Integration tests for mine mountain placement and no-dig construction.
 *
 * Verifies:
 * - Mines can be placed on steep rock terrain (slope check bypassed)
 * - Mine construction skips digging phases (starts at WaitingForBuilders)
 * - Full mine construction flow completes without dispatching a digger
 * - Cancelling a mine under construction leaves rock terrain unchanged
 * - Non-mine buildings are still rejected on equivalent steep slopes
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { TERRAIN, createSlope } from '../../helpers/test-map';
import { MAX_SLOPE_DIFF } from '@/game/systems/placement/slope';

installRealGameData();

// ─── Test coordinates ─────────────────────────────────────────────────────
// Fixed region used across tests: rock square at (50, 50) with steep slope
const ROCK_CX = 50;
const ROCK_CY = 50;
const ROCK_RADIUS = 8;
// Slope from height 0 to height > MAX_SLOPE_DIFF within 2 adjacent tiles
const STEEP_START_HEIGHT = 0;
const STEEP_END_HEIGHT = MAX_SLOPE_DIFF + 10; // well above the limit

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Set up a rock region centered at (ROCK_CX, ROCK_CY) with a steep slope.
 * Height difference between adjacent tiles exceeds MAX_SLOPE_DIFF.
 */
function setupSteepRockTerrain(sim: Simulation): void {
    sim.fillTerrain(ROCK_CX, ROCK_CY, ROCK_RADIUS, TERRAIN.ROCK);
    // Steep slope: left half at 0, right half at STEEP_END_HEIGHT
    // The tiles at x=ROCK_CX and x=ROCK_CX+1 are adjacent with diff > 12
    createSlope(sim.map, ROCK_CX, ROCK_CY - 4, ROCK_CX + 1, ROCK_CY + 4, STEEP_START_HEIGHT, STEEP_END_HEIGHT);
}

/**
 * Place a mine building directly at the steep rock position.
 * Returns the entity ID on success, throws on failure.
 */
function placeMineAtSteepRock(sim: Simulation, buildingType: BuildingType, completed = true): number {
    return sim.placeBuildingAt(ROCK_CX, ROCK_CY, buildingType, 0, completed);
}

// ─── Test 1: Steep slope placement succeeds for mines ─────────────────────

describe('Mine placement: steep slope allowed', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('mine placement succeeds on rock with height diff > MAX_SLOPE_DIFF', () => {
        sim = createSimulation();
        setupSteepRockTerrain(sim);

        // Should NOT throw — mine placement ignores slope check
        expect(() => placeMineAtSteepRock(sim, BuildingType.CoalMine)).not.toThrow();
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Test 2: Mine skips digging phase ─────────────────────────────────────

describe('Mine construction: skips digging phase', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('mine site starts at WaitingForBuilders with terrain.complete=true immediately after placement', () => {
        sim = createSimulation();
        setupSteepRockTerrain(sim);

        const mineId = placeMineAtSteepRock(sim, BuildingType.CoalMine, false);

        const site = sim.services.constructionSiteManager.getSite(mineId);
        expect(site).toBeDefined();
        expect(site!.phase).toBe(BuildingConstructionPhase.WaitingForBuilders);
        expect(site!.terrain.complete).toBe(true);
        expect(site!.terrain.progress).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Test 3: Full mine construction flow (no digger dispatched) ────────────

describe('Mine construction: full flow without digger', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('mine completes construction without ever dispatching a digger', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        // Infrastructure: residence + storage with materials
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);
        sim.placeGoods(EMaterialType.HAMMER, 4);

        // Pre-spawn 2 builders (mines need builders, not diggers)
        const residenceId = sim.state.entities.find(
            e => e.type === EntityType.Building && e.subType === BuildingType.ResidenceSmall
        )!.id;
        sim.spawnUnitNear(residenceId, UnitType.Builder, 2);

        // Set up mine site on steep rock terrain
        setupSteepRockTerrain(sim);

        // Track: no digging event should fire for mine construction
        let diggingStartedFired = false;
        sim.eventBus.on('construction:diggingStarted', () => {
            diggingStartedFired = true;
        });

        const diggersBefore = sim.countEntities(EntityType.Unit, UnitType.Digger);
        const mineId = placeMineAtSteepRock(sim, BuildingType.CoalMine, false);

        // Run until construction completes
        sim.waitForConstructionComplete(mineId);

        expect(diggingStartedFired).toBe(false);
        // No new diggers should have been spawned
        expect(sim.countEntities(EntityType.Unit, UnitType.Digger)).toBe(diggersBefore);
        // Building should now be operational (mine worker unit spawned)
        expect(sim.countEntities(EntityType.Building)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Test 4: Cancellation leaves rock terrain unchanged ───────────────────

describe('Mine construction: cancellation does not restore terrain', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('cancelling a mine under construction leaves rock terrain intact (no DustyWay artifacts)', () => {
        sim = createSimulation();
        setupSteepRockTerrain(sim);

        const mineId = placeMineAtSteepRock(sim, BuildingType.CoalMine, false);

        // Capture terrain type at mine location before removal
        const mineEntity = sim.state.getEntityOrThrow(mineId, 'test');
        const idx = sim.map.mapSize.toIndex(mineEntity.x, mineEntity.y);
        const terrainBefore = sim.map.groundType[idx];

        sim.removeBuilding(mineId);

        expect(sim.services.constructionSiteManager.hasSite(mineId)).toBe(false);
        // Rock terrain should still be rock — no DustyWay artifacts
        expect(sim.map.groundType[idx]).toBe(terrainBefore);
        expect(sim.map.groundType[idx]).toBe(TERRAIN.ROCK);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Test 5: Non-mine building still rejected on steep slope ──────────────

describe('Mine placement: non-mine unaffected by slope bypass', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('normal building placement fails on steep slope that a mine would accept', () => {
        sim = createSimulation();

        // Create a grass region with the same steep slope (non-mine terrain)
        const cx = 50;
        const cy = 50;
        sim.fillTerrain(cx, cy, ROCK_RADIUS, TERRAIN.GRASS);
        createSlope(sim.map, cx, cy - 4, cx + 1, cy + 4, STEEP_START_HEIGHT, STEEP_END_HEIGHT);

        // WoodcutterHut is a normal building — should be rejected due to steep slope
        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: cx,
            y: cy,
            player: 0,
            completed: true,
            spawnWorker: false,
        });

        expect(result.success).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });
});
