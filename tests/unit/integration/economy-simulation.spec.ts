/**
 * Headless economy simulation — runs the full production pipeline
 * without a browser using real XML game data. Asserts on observable
 * outcomes only: inventory counts, entity existence, material flow.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  ECONOMY RULES & INVARIANTS
 * ═══════════════════════════════════════════════════════════════════
 *
 * BUILDING CATEGORIES
 * ───────────────────
 * Buildings fall into three economic roles:
 *
 *   Producers — gather raw resources directly from the map.
 *     • Simple gatherers (have work areas):
 *       WoodcutterHut (LOG from trees), StonecutterHut (STONE from rocks),
 *       FisherHut (FISH), HunterHut (MEAT), WaterworkHut (WATER)
 *     • Farmer/planters — dual-role workers that both plant and harvest
 *       within their work area (plant when nothing to harvest, harvest
 *       when crops are mature):
 *       GrainFarm (GRAIN), AgaveFarmerHut (AGAVE),
 *       SunflowerFarmerHut (SUNFLOWER), BeekeeperHut (HONEY),
 *       Vinyard (WINE)
 *     • Pure planter — ForesterHut plants trees but produces no material
 *       output; woodcutters harvest the trees instead.
 *     • Mines — require food input (BREAD, MEAT, or FISH) to produce
 *       ore/minerals: CoalMine, IronMine, GoldMine, StoneMine, SulfurMine
 *       (unique: only buildings that consume input yet still "produce from map")
 *
 *   Transformers — consume input materials and produce output materials.
 *     • Single-input:  Sawmill (LOG→BOARD), Mill (GRAIN→FLOUR),
 *       Slaughterhouse (PIG→MEAT), AnimalRanch (GRAIN→PIG),
 *       MeadMakerHut (HONEY→MEAD), TequilaMakerHut (AGAVE→TEQUILA),
 *       SunflowerOilMakerHut (SUNFLOWER→SUNFLOWEROIL)
 *     • Dual-input:  Bakery (FLOUR+WATER→BREAD),
 *       IronSmelter (IRONORE+COAL→IRONBAR), SmeltGold (GOLDORE+COAL→GOLDBAR),
 *       WeaponSmith (IRONBAR+COAL→SWORD), ToolSmith (IRONBAR+COAL→AXE)
 *     • Consumers (no material output):
 *       Barrack (SWORD → spawns soldiers),
 *       SmallTemple (consumes mana/resources for spells)
 *
 *   Non-production — residences, towers, storage areas, temples, etc.
 *     StorageArea is special: accepts/provides any material dynamically.
 *
 * WORK AREAS
 * ──────────
 * Only ~9 building types have circular work areas that limit where their
 * worker searches for resources (radius 20–30 tiles, adjustable per instance):
 *   WoodcutterHut, StonecutterHut, GrainFarm, FisherHut, HunterHut,
 *   ForesterHut, AgaveFarmerHut, BeekeeperHut, SunflowerFarmerHut
 *
 * Resources outside the work area radius are invisible to the worker.
 * The work area center defaults to dy:4 from the building anchor but can
 * be repositioned by the player. Building footprint (2×2 or 3×3) and
 * work area are independent systems.
 *
 * PRODUCTION & MATERIAL FLOW
 * ──────────────────────────
 * Production is atomic: 1 input set → 1 output unit, no partial cycles.
 * Each building has separate input and output slots. Carriers move
 * materials between buildings:
 *
 *   Producer → [output slot] → Carrier → [input slot] → Transformer
 *
 * If output is full, the worker waits — production never fails silently.
 *
 * KEY INVARIANTS
 * ──────────────
 * • Workers default to 1 per building (configurable per type).
 * • Mines are the only "producers" that also require input (any food).
 * • ForesterHut is the only pure planter — no material output.
 * • Farmer-type buildings alternate: plant when idle, harvest when ripe.
 * • Work area limits are strict: resources outside the radius are ignored.
 *
 * SIMULATION HELPERS (used in these tests)
 * ────────────────────────────────────────
 * • placeBuilding() — auto-positions on a grid, instantly completed,
 *   auto-spawns workers and carriers as configured
 * • plantTreesNear/Far(), placeStonesNear/Far() — place resources
 *   inside or outside a building's work area radius
 * • runUntil(pred, {maxTicks}) — tick until condition or timeout
 * • runTicks(n) — advance simulation by n ticks
 * • getOutput/getInput(buildingId, material) — query inventory counts
 * • countEntities(type) — count spawned entities
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../helpers/test-simulation';
import { installRealGameData } from '../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { OreType } from '@/game/features/ore-veins/ore-type';

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Economy simulation (real game data)', () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('woodcutter cuts only nearby trees, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // 3 reachable trees + 5 unreachable (beyond working area radius)
        sim.plantTreesNear(woodcutterId, 3);
        sim.plantTreesFar(woodcutterId, 5);

        // Wait for all 3 nearby trees, then keep running to confirm no 4th log appears
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3);
    });

    it('full production chain: trees → woodcutter → carrier → sawmill → boards', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Auto-spawned units: woodcutter worker, sawmill worker, carriers
        expect(sim.countEntities(EntityType.Unit)).toBeGreaterThanOrEqual(3);

        sim.plantTreesNear(woodcutterId, 5);

        // Wait for all 5 trees to become boards (1 tree → 1 log → 1 board), then idle
        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 5, { maxTicks: 500 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(5);
    });

    it('worker loops back to cut all nearby trees', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 5);

        // Wait for all 5, then extra idle to confirm no phantom production
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 5, { maxTicks: 500 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(5);
    });

    it('full chain: farm → grain → mill → flour + waterwork → water → bakery → bread', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256, buildingSpacing: 16 });

        // Track crop lifecycle events
        let planted = 0;
        let matured = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:matured', () => matured++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.GrainFarm);
        const waterworkId = sim.placeBuilding(BuildingType.WaterworkHut);
        sim.placeBuilding(BuildingType.Mill);
        const bakeryId = sim.placeBuilding(BuildingType.Bakery);

        // Waterworker needs river tiles within work area
        sim.placeRiverNear(waterworkId, 3);

        // Farmer plants & harvests grain autonomously, waterworker draws from river.
        // Carriers deliver grain → mill (→ flour) and flour + water → bakery (→ bread).
        // Long timeout: grain grows ~110s, then multiple transport + processing steps.
        sim.runUntil(() => sim.getOutput(bakeryId, EMaterialType.BREAD) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(bakeryId, EMaterialType.BREAD)).toBeGreaterThanOrEqual(1);

        // Verify crop lifecycle: farmer must have planted, crops must have matured and been harvested
        expect(planted).toBeGreaterThanOrEqual(1);
        expect(matured).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
        // Every harvested crop must have been planted and matured first
        expect(matured).toBeGreaterThanOrEqual(harvested);
        expect(planted).toBeGreaterThanOrEqual(matured);
    });

    it('mine chain: coal mine + iron mine → iron smelter → iron bars (with injected bread)', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256, buildingSpacing: 16 });

        // Monitor assignment failures for diagnostics
        const failures: string[] = [];
        sim.eventBus.on('carrier:assignmentFailed', e => {
            failures.push(
                `${e.reason} req=${e.requestId} src=${e.sourceBuilding} dst=${e.destBuilding} mat=${EMaterialType[e.material]}`
            );
        });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const coalMineId = sim.placeMineBuilding(BuildingType.CoalMine, OreType.Coal);
        const ironMineId = sim.placeMineBuilding(BuildingType.IronMine, OreType.Iron);
        const smelterId = sim.placeBuilding(BuildingType.IronSmelter);

        // Mines require BREAD as input — inject directly to avoid full bread chain
        sim.injectInput(coalMineId, EMaterialType.BREAD, 8);
        sim.injectInput(ironMineId, EMaterialType.BREAD, 8);

        // Mines consume bread + ore → produce COAL / IRONORE.
        // Carriers deliver COAL + IRONORE → smelter → IRONBAR.
        sim.runUntil(() => sim.getOutput(smelterId, EMaterialType.IRONBAR) >= 1, { maxTicks: 300 * 30 });
        if (sim.getOutput(smelterId, EMaterialType.IRONBAR) === 0 && failures.length > 0) {
            console.log('ASSIGNMENT FAILURES (first 10):', failures.slice(0, 10));
        }
        expect(sim.getOutput(smelterId, EMaterialType.IRONBAR)).toBeGreaterThanOrEqual(1);
    });

    it('tool & weapon chain: mines → smelter → iron bars → toolsmith → axes + weaponsmith → swords', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256, buildingSpacing: 16 });

        // Log inventory output changes to diagnose production pipeline
        sim.eventBus.on('inventory:changed', e => {
            if (e.slotType === 'output') {
                console.log(
                    `[output] building=${e.buildingId} mat=${EMaterialType[e.materialType]} ${e.previousAmount}->${e.newAmount}`
                );
            }
        });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const coalMineId = sim.placeMineBuilding(BuildingType.CoalMine, OreType.Coal);
        const ironMineId = sim.placeMineBuilding(BuildingType.IronMine, OreType.Iron);
        const smelterId = sim.placeBuilding(BuildingType.IronSmelter);
        const toolSmithId = sim.placeBuilding(BuildingType.ToolSmith);
        const weaponSmithId = sim.placeBuilding(BuildingType.WeaponSmith);

        // Inject all raw materials directly — focus is on smelting + smithing pipeline
        sim.injectInput(coalMineId, EMaterialType.BREAD, 8);
        sim.injectInput(ironMineId, EMaterialType.BREAD, 8);
        sim.injectInput(smelterId, EMaterialType.IRONORE, 8);
        sim.injectInput(smelterId, EMaterialType.COAL, 8);
        sim.injectInput(toolSmithId, EMaterialType.COAL, 8);
        sim.injectInput(toolSmithId, EMaterialType.IRONBAR, 4);
        sim.injectInput(weaponSmithId, EMaterialType.COAL, 8);
        sim.injectInput(weaponSmithId, EMaterialType.IRONBAR, 4);

        // Smelter: IRONORE+COAL → IRONBAR.
        // ToolSmith: IRONBAR+COAL → AXE, WeaponSmith: IRONBAR+COAL → SWORD.
        sim.runUntil(
            () =>
                sim.getOutput(toolSmithId, EMaterialType.AXE) >= 1 &&
                sim.getOutput(weaponSmithId, EMaterialType.SWORD) >= 1,
            { maxTicks: 600 * 30 }
        );
        expect(sim.getOutput(smelterId, EMaterialType.IRONBAR)).toBeGreaterThanOrEqual(1);
        expect(sim.getOutput(toolSmithId, EMaterialType.AXE)).toBeGreaterThanOrEqual(1);
        expect(sim.getOutput(weaponSmithId, EMaterialType.SWORD)).toBeGreaterThanOrEqual(1);
    });

    it('forester plants trees, woodcutter harvests them (no initial trees)', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256, buildingSpacing: 16 });

        // Track tree lifecycle events
        let treesPlanted = 0;
        let treesMatured = 0;
        let treesCut = 0;
        sim.eventBus.on('tree:planted', () => treesPlanted++);
        sim.eventBus.on('tree:matured', () => treesMatured++);
        sim.eventBus.on('tree:cut', () => treesCut++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const foresterId = sim.placeBuilding(BuildingType.ForesterHut);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // No trees planted — forester must plant them first, then woodcutter harvests.
        // Forester plants saplings that grow into mature trees over ~60-120s game time.
        // Woodcutter then detects mature trees within work area and cuts them.
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 2, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThanOrEqual(2);

        // ForesterHut itself produces no material output (pure planter)
        expect(sim.getOutput(foresterId, EMaterialType.LOG)).toBe(0);

        // Verify tree lifecycle: forester planted, trees grew, woodcutter cut them
        expect(treesPlanted).toBeGreaterThanOrEqual(2);
        expect(treesMatured).toBeGreaterThanOrEqual(2);
        expect(treesCut).toBeGreaterThanOrEqual(2);
        // Every cut tree must have matured, every matured tree must have been planted
        expect(treesMatured).toBeGreaterThanOrEqual(treesCut);
        expect(treesPlanted).toBeGreaterThanOrEqual(treesMatured);
    });

    it('stonecutter mines only nearby rocks, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const stonecutterId = sim.placeBuilding(BuildingType.StonecutterHut);

        // 2 reachable rocks + 3 unreachable (beyond working area radius)
        // Each rock has multiple depletion stages, yielding several stones
        sim.placeStonesNear(stonecutterId, 2);
        sim.placeStonesFar(stonecutterId, 3);

        // Wait for all nearby rocks to be fully depleted (each rock has ~4 depletion stages).
        // Use stabilization: run until output stops increasing for a sustained period.
        let lastCount = 0;
        let stableTicks = 0;
        sim.runUntil(
            () => {
                const count = sim.getOutput(stonecutterId, EMaterialType.STONE);
                if (count > lastCount) {
                    lastCount = count;
                    stableTicks = 0;
                } else {
                    stableTicks++;
                }
                return stableTicks >= 60 * 30; // stable for ~60s means all nearby rocks depleted
            },
            { maxTicks: 500 * 30 }
        );
        const stonesFromNearby = sim.getOutput(stonecutterId, EMaterialType.STONE);
        expect(stonesFromNearby).toBeGreaterThan(0);

        // Run more idle ticks — should not produce more (far rocks are out of range)
        sim.runTicks(60 * 30);
        expect(sim.getOutput(stonecutterId, EMaterialType.STONE)).toBe(stonesFromNearby);
    });
});
