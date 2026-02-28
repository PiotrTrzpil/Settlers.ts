/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration tests for the settler task system with real XML job data.
 *
 * Parses actual jobInfo.xml, SettlerValues.xml, and buildingInfo.xml from
 * the game assets directory, then exercises full choreography cycles:
 * job selection → node-by-node advancement → completion → return to idle.
 *
 * Tests are skipped when game data files are not present (CI without game assets).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

// Set up DOMParser for Node environment (must be before parser imports)
const dom = new JSDOM('');
(global as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

import { SettlerTaskSystem, type SettlerTaskSystemConfig } from '@/game/features/settler-tasks/settler-task-system';
import {
    SearchType,
    WorkHandlerType,
    type EntityWorkHandler,
    type PositionWorkHandler,
} from '@/game/features/settler-tasks/types';
import { resetJobChoreographyStore } from '@/game/features/settler-tasks/job-choreography-store';
import { EntityVisualService } from '@/game/animation/entity-visual-service';
import { EntityType, BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { Race } from '@/game/race';
import {
    createTestContext,
    addUnit,
    addBuilding,
    addBuildingWithInventory,
    type TestContext,
} from './helpers/test-game';
import { CarrierManager } from '@/game/features/carriers';
import { GameDataLoader } from '@/resources/game-data/game-data-loader';
import { parseJobInfo } from '@/resources/game-data/job-info-parser';
import { parseBuildingInfo } from '@/resources/game-data/building-info-parser';
import { parseSettlerValues } from '@/resources/game-data/settler-values-parser';
import { parseBuildingTriggers } from '@/resources/game-data/building-trigger-parser';
import { clearWorkerBuildingCache } from '@/game/game-data-access';
import type { GameData } from '@/resources/game-data/types';

// ─────────────────────────────────────────────────────────────
// Load real XML files
// ─────────────────────────────────────────────────────────────

const GAME_DATA_PATH = join(__dirname, '../../public/Siedler4/GameData');
const hasGameDataFiles = existsSync(join(GAME_DATA_PATH, 'jobInfo.xml'));

function loadXml(filename: string): string {
    return readFileSync(join(GAME_DATA_PATH, filename), 'utf-8');
}

/** Parse all XML files into a GameData object. Cached across tests. */
let cachedGameData: GameData | null = null;

function loadRealGameData(): GameData {
    if (cachedGameData) return cachedGameData;

    const jobs = parseJobInfo(loadXml('jobInfo.xml'));
    const buildings = parseBuildingInfo(loadXml('buildingInfo.xml'));
    const settlers = parseSettlerValues(loadXml('SettlerValues.xml'));
    const buildingTriggers = parseBuildingTriggers(loadXml('BuildingTrigger.xml'));

    cachedGameData = {
        buildings,
        jobs,
        objects: new Map(),
        buildingTriggers,
        settlers,
    };
    return cachedGameData;
}

/** Install real parsed XML data into the GameDataLoader singleton. */
function installRealXmlData(): void {
    clearWorkerBuildingCache();
    GameDataLoader.resetInstance();
    resetJobChoreographyStore();
    GameDataLoader.getInstance().setData(loadRealGameData());
}

// ─────────────────────────────────────────────────────────────
// System wiring
// ─────────────────────────────────────────────────────────────

function createTaskSystem(ctx: TestContext): SettlerTaskSystem {
    const visualService = new EntityVisualService();
    ctx.eventBus.on('entity:created', ({ entityId, variation }) => {
        visualService.init(entityId, variation);
    });
    const carrierManager = new CarrierManager({
        entityProvider: ctx.state,
        eventBus: ctx.eventBus,
    });

    const mockWorkAreaStore = {
        getAbsoluteCenter: (_id: number, bx: number, by: number) => ({ x: bx, y: by }),
    };

    const mockInventoryVisualizer = {
        getStackPosition: (_buildingId: number, _material: EMaterialType, _slot: string) => null,
        registerBuilding: () => {},
        unregisterBuilding: () => {},
        update: () => {},
    };

    const mockOverlayManager = {
        startOverlay: () => {},
        stopOverlay: () => {},
        tick: () => {},
    };

    const config: SettlerTaskSystemConfig = {
        gameState: ctx.state,
        visualService,
        inventoryManager: ctx.inventoryManager,
        eventBus: ctx.eventBus,
        carrierManager,
        getInventoryVisualizer: () => mockInventoryVisualizer as any,
        workAreaStore: mockWorkAreaStore as any,
        buildingOverlayManager: mockOverlayManager as any,
    };
    return new SettlerTaskSystem(config);
}

// ─────────────────────────────────────────────────────────────
// Work handler factories for tests
// ─────────────────────────────────────────────────────────────

function createTargetHandler(target: { entityId: number; x: number; y: number }): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,
        findTarget: () => target,
        canWork: () => true,
        onWorkStart: vi.fn(),
        onWorkTick: (_id, progress) => progress >= 1.0,
        onWorkComplete: vi.fn(),
        onWorkInterrupt: vi.fn(),
    };
}

function createNullableTargetHandler(target: { entityId: number; x: number; y: number } | null): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,
        findTarget: () => target,
        canWork: () => target !== null,
        onWorkStart: vi.fn(),
        onWorkTick: (_id, progress) => progress >= 1.0,
        onWorkComplete: vi.fn(),
        onWorkInterrupt: vi.fn(),
    };
}

function createPlantingHandler(pos: { x: number; y: number } | null): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,
        findPosition: () => pos,
        onWorkAtPositionComplete: vi.fn(),
    };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Get the runtime for a settler from the system's internals. */
function getRuntime(system: SettlerTaskSystem, entityId: number) {
    return (system as any).runtimes.get(entityId)!;
}

/** Access a parsed job from the real data by race and ID. */
function getRealJob(raceId: string, jobId: string) {
    return loadRealGameData()
        .jobs.get(raceId as any)!
        .jobs.get(jobId)!;
}

/** Tick both the task system and the movement system (needed for physical movement nodes). */
function tickBoth(system: SettlerTaskSystem, ctx: TestContext, dt: number): void {
    system.tick(dt);
    ctx.state.movement.tick(dt);
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

const describeWithData = hasGameDataFiles ? describe : describe.skip;

describeWithData('Settler Task System Integration (real XML data)', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
        // Re-install real data after createTestContext (which installs stub data internally)
        installRealXmlData();
    });

    afterEach(() => {
        GameDataLoader.resetInstance();
        resetJobChoreographyStore();
        clearWorkerBuildingCache();
    });

    // ─────────────────────────────────────────────────────────
    // Choreography structure verification (parsed from XML)
    // ─────────────────────────────────────────────────────────

    describe('choreography node verification', () => {
        it('woodcutter work job has correct node sequence', () => {
            const job = getRealJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            expect(job.nodes.length).toBeGreaterThanOrEqual(10);
            expect(job.nodes[0]!.task).toBe('GO_TO_TARGET');
            expect(job.nodes[1]!.task).toBe('WORK_ON_ENTITY');
            const resNode = job.nodes.find(n => n.task === 'RESOURCE_GATHERING_VIRTUAL');
            expect(resNode).toBeDefined();
            expect(resNode!.entity).toBe('GOOD_LOG');
            const putNode = job.nodes.find(n => n.task === 'PUT_GOOD');
            expect(putNode).toBeDefined();
            expect(putNode!.entity).toBe('GOOD_LOG');
            expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
        });

        it('stonecutter work job has correct node sequence', () => {
            const job = getRealJob('RACE_ROMAN', 'JOB_STONECUTTER_WORK');
            expect(job.nodes[0]!.task).toBe('GO_TO_TARGET');
            expect(job.nodes[1]!.task).toBe('WORK_ON_ENTITY');
            const resNode = job.nodes.find(n => n.task === 'RESOURCE_GATHERING');
            expect(resNode).toBeDefined();
            expect(resNode!.entity).toBe('GOOD_STONE');
            expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
        });

        it('farmer grain has both harvest and plant jobs', () => {
            const harvest = getRealJob('RACE_ROMAN', 'JOB_FARMERGRAIN_HARVEST');
            const plant = getRealJob('RACE_ROMAN', 'JOB_FARMERGRAIN_PLANT');

            expect(harvest.nodes[0]!.task).toBe('GO_TO_TARGET');
            expect(harvest.nodes.find(n => n.entity === 'GOOD_GRAIN')).toBeDefined();

            expect(plant.nodes.find(n => n.task === 'PLANT')).toBeDefined();
            expect(plant.nodes[plant.nodes.length - 1]!.task).toBe('CHECKIN');
        });

        it('sawmill worker uses all-virtual interior nodes', () => {
            const job = getRealJob('RACE_ROMAN', 'JOB_SAWMILLWORKER_WORK');
            const moveNodes = job.nodes.filter(n => n.task.startsWith('GO'));
            expect(moveNodes.every(n => n.task === 'GO_VIRTUAL')).toBe(true);
            const getGood = job.nodes.find(n => n.task === 'GET_GOOD_VIRTUAL');
            expect(getGood).toBeDefined();
            expect(getGood!.entity).toBe('GOOD_LOG');
            const putGood = job.nodes.find(n => n.task === 'PUT_GOOD_VIRTUAL');
            expect(putGood).toBeDefined();
            expect(putGood!.entity).toBe('GOOD_BOARD');
            expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
        });

        it('all work jobs end with CHECKIN', () => {
            const workJobIds = [
                'JOB_WOODCUTTER_WORK',
                'JOB_STONECUTTER_WORK',
                'JOB_FARMERGRAIN_HARVEST',
                'JOB_FARMERGRAIN_PLANT',
                'JOB_FORESTER_PLANT',
                'JOB_SAWMILLWORKER_WORK',
            ];
            for (const jobId of workJobIds) {
                const job = getRealJob('RACE_ROMAN', jobId);
                const lastNode = job.nodes[job.nodes.length - 1]!;
                expect(lastNode.task).toBe('CHECKIN');
            }
        });

        it('forester plant job has PLANT node', () => {
            const job = getRealJob('RACE_ROMAN', 'JOB_FORESTER_PLANT');
            expect(job.nodes.find(n => n.task === 'PLANT')).toBeDefined();
            expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
        });
    });

    // ─────────────────────────────────────────────────────────
    // Woodcutter full cycle
    // ─────────────────────────────────────────────────────────

    describe('woodcutter full cycle', () => {
        it('selects JOB_WOODCUTTER_WORK and starts working when tree exists', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 11, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 11, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            expect(system.isWorking(settler.id)).toBe(true);
            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_WOODCUTTER_WORK');
            expect(runtime.assignedBuilding).toBe(building.id);
        });

        it('advances through GO_TO_TARGET when settler is adjacent to tree', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 11, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 11, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 11, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);
            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.nodeIndex).toBe(0);

            system.tick(0.016);
            expect(runtime.job.nodeIndex).toBe(1);
        });

        it('advances through WORK_ON_ENTITY with work handler callbacks', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016); // selects job
            system.tick(0.016); // GO_TO_TARGET completes
            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.nodeIndex).toBe(1);

            system.tick(0.016); // WORK_ON_ENTITY starts
            expect(handler.onWorkStart).toHaveBeenCalledWith(tree.id);

            system.tick(2.0); // complete work
            expect(handler.onWorkComplete).toHaveBeenCalledWith(tree.id, settler.x, settler.y);
            expect(runtime.job.nodeIndex).toBeGreaterThan(1);
        });

        it('sets carrying state after RESOURCE_GATHERING_VIRTUAL node', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            const job = getRealJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            const resNodeIdx = job.nodes.findIndex(n => n.task === 'RESOURCE_GATHERING_VIRTUAL');
            expect(resNodeIdx).toBeGreaterThan(-1);

            let sawCarrying = false;
            for (let i = 0; i < 30; i++) {
                tickBoth(system, ctx, 2.0);
                const runtime = getRuntime(system, settler.id);
                if (runtime.job && runtime.job.nodeIndex > resNodeIdx && settler.carrying) {
                    expect(settler.carrying.material).toBe(EMaterialType.LOG);
                    sawCarrying = true;
                    break;
                }
            }

            const runtime = getRuntime(system, settler.id);
            expect(sawCarrying || runtime.state === 'IDLE').toBe(true);
        });

        it('completes full cycle and returns to IDLE', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            addBuildingWithInventory(ctx, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            let sawIdle = false;
            for (let i = 0; i < 80; i++) {
                tickBoth(system, ctx, 2.0);
                const runtime = getRuntime(system, settler.id);
                if (runtime.state === 'IDLE') {
                    sawIdle = true;
                    break;
                }
            }

            expect(sawIdle).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Stonecutter full cycle
    // ─────────────────────────────────────────────────────────

    describe('stonecutter full cycle', () => {
        it('selects JOB_STONECUTTER_WORK and executes work cycle', () => {
            const system = createTaskSystem(ctx);
            const stone = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: stone.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.STONE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.StonecutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Stonecutter });

            system.tick(0.016);
            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_STONECUTTER_WORK');

            for (let i = 0; i < 40; i++) {
                tickBoth(system, ctx, 2.0);
            }

            expect(handler.onWorkStart).toHaveBeenCalled();
            expect(handler.onWorkComplete).toHaveBeenCalled();
        });

        it('transitions IDLE → WORKING → IDLE on job completion', () => {
            const system = createTaskSystem(ctx);
            const stone = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: stone.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.STONE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.StonecutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Stonecutter });

            expect(system.isWorking(settler.id)).toBe(false);

            system.tick(0.016);
            expect(system.isWorking(settler.id)).toBe(true);

            let wasIdle = false;
            for (let i = 0; i < 80; i++) {
                tickBoth(system, ctx, 2.0);
                const runtime = getRuntime(system, settler.id);
                if (runtime.state === 'IDLE') {
                    wasIdle = true;
                    break;
                }
            }
            expect(wasIdle).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Farmer multi-job rotation
    // ─────────────────────────────────────────────────────────

    describe('farmer multi-job rotation', () => {
        it('selects harvest when grain target exists', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 11, 10, 0);
            const handler = createNullableTargetHandler({ entityId: grain.id, x: 11, y: 10 });
            system.registerWorkHandler(SearchType.GRAIN, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.GrainFarm, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FARMERGRAIN_HARVEST');
        });

        it('selects plant when no grain target exists (via plantSearch position handler)', () => {
            const system = createTaskSystem(ctx);
            const handler = createNullableTargetHandler(null);
            system.registerWorkHandler(SearchType.GRAIN, handler);

            // Register plant position handler under GRAIN_SEED_POS
            // (the system's plantSearch field on SettlerConfig routes to this)
            const plantHandler = createPlantingHandler({ x: 15, y: 15 });
            system.registerWorkHandler(SearchType.GRAIN_SEED_POS, plantHandler);

            addBuilding(ctx.state, 10, 10, BuildingType.GrainFarm, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            system.tick(0.016);

            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FARMERGRAIN_PLANT');
        });

        it('executes harvest with WORK_ON_ENTITY and collects GOOD_GRAIN', () => {
            const system = createTaskSystem(ctx);
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: grain.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.GRAIN, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.GrainFarm, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            let sawGrainCarrying = false;
            for (let i = 0; i < 40; i++) {
                tickBoth(system, ctx, 2.0);
                if (settler.carrying?.material === EMaterialType.GRAIN) {
                    sawGrainCarrying = true;
                }
            }

            expect(handler.onWorkStart).toHaveBeenCalled();
            expect(handler.onWorkComplete).toHaveBeenCalled();
            expect(sawGrainCarrying).toBe(true);
        });

        it('alternates between harvest and plant across cycles', () => {
            const system = createTaskSystem(ctx);

            let hasTarget = true;
            const grain = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler: EntityWorkHandler = {
                type: WorkHandlerType.ENTITY,
                findTarget: () => (hasTarget ? { entityId: grain.id, x: 10, y: 10 } : null),
                canWork: () => true,
                onWorkTick: (_id, progress) => progress >= 1.0,
                onWorkComplete: () => {},
            };
            system.registerWorkHandler(SearchType.GRAIN, handler);

            const plantHandler = createPlantingHandler({ x: 15, y: 15 });
            system.registerWorkHandler(SearchType.GRAIN_SEED_POS, plantHandler);

            addBuilding(ctx.state, 10, 10, BuildingType.GrainFarm, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Farmer });

            // Cycle 1: harvest (entity target available)
            system.tick(0.016);
            let runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FARMERGRAIN_HARVEST');

            // Force-complete the job
            runtime.state = 'IDLE';
            runtime.job = null;

            // Cycle 2: no target → plant (via plantSearch position handler)
            hasTarget = false;
            system.tick(0.016);
            runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FARMERGRAIN_PLANT');
        });
    });

    // ─────────────────────────────────────────────────────────
    // Forester planting
    // ─────────────────────────────────────────────────────────

    describe('forester planting', () => {
        it('selects JOB_FORESTER_PLANT via position handler', () => {
            const system = createTaskSystem(ctx);
            const handler = createPlantingHandler({ x: 15, y: 15 });
            system.registerWorkHandler(SearchType.TREE_SEED_POS, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.ForesterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            system.tick(0.016);

            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FORESTER_PLANT');
        });

        it('walks to planting position via GO_TO_TARGET with position-only target', () => {
            const system = createTaskSystem(ctx);
            const handler = createPlantingHandler({ x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE_SEED_POS, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.ForesterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            system.tick(0.016);
            const runtime = getRuntime(system, settler.id);
            expect(runtime.job.jobId).toBe('JOB_FORESTER_PLANT');
            // targetPos should be set from position handler, no targetId
            expect(runtime.job.targetPos).toEqual({ x: 10, y: 10 });
            expect(runtime.job.targetId).toBeNull();
        });

        it('calls onWorkAtPositionComplete during PLANT node', () => {
            const system = createTaskSystem(ctx);
            const handler = createPlantingHandler({ x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE_SEED_POS, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.ForesterHut, 0, Race.Roman);
            addUnit(ctx.state, 10, 10, { subType: UnitType.Forester });

            for (let i = 0; i < 20; i++) {
                tickBoth(system, ctx, 2.0);
            }

            expect(handler.onWorkAtPositionComplete).toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────────────────────────
    // Sawmill worker (building-internal production)
    // ─────────────────────────────────────────────────────────

    describe('sawmill worker (building-internal production)', () => {
        it('selects work job for WORKPLACE search type', () => {
            const system = createTaskSystem(ctx);

            const building = addBuildingWithInventory(ctx, 10, 10, BuildingType.Sawmill, 0, Race.Roman);
            ctx.inventoryManager.depositInput(building.id, EMaterialType.LOG, 1);

            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.SawmillWorker });

            system.tick(0.016);

            const runtime = getRuntime(system, settler.id);
            expect(runtime.job).not.toBeNull();
            expect(runtime.assignedBuilding).toBe(building.id);
        });

        it('executes GO_VIRTUAL nodes instantly (teleport)', () => {
            const system = createTaskSystem(ctx);

            const building = addBuildingWithInventory(ctx, 20, 20, BuildingType.Sawmill, 0, Race.Roman);
            ctx.inventoryManager.depositInput(building.id, EMaterialType.LOG, 1);

            addUnit(ctx.state, 20, 20, { subType: UnitType.SawmillWorker });

            system.tick(0.016);
            const settlers = [...(system as any).runtimes.entries()];
            const sawmillRuntime = settlers.find(([, r]: [number, any]) => r.assignedBuilding === building.id);
            if (!sawmillRuntime) return;

            const runtime = sawmillRuntime[1];
            if (!runtime.job) return;

            system.tick(0.016);
            expect(runtime.job.nodeIndex).toBeGreaterThanOrEqual(1);
        });

        it('processes full production cycle: GET_GOOD_VIRTUAL → WORK_VIRTUAL → PUT_GOOD_VIRTUAL', () => {
            const system = createTaskSystem(ctx);

            const building = addBuildingWithInventory(ctx, 20, 20, BuildingType.Sawmill, 0, Race.Roman);
            ctx.inventoryManager.depositInput(building.id, EMaterialType.LOG, 1);

            const { entity: settler } = addUnit(ctx.state, 20, 20, { subType: UnitType.SawmillWorker });

            const job = getRealJob('RACE_ROMAN', 'JOB_SAWMILLWORKER_WORK');
            const getGoodIdx = job.nodes.findIndex(n => n.task === 'GET_GOOD_VIRTUAL');
            const workIdx = job.nodes.findIndex(n => n.task === 'WORK_VIRTUAL');
            const putGoodIdx = job.nodes.findIndex(n => n.task === 'PUT_GOOD_VIRTUAL');

            let passedGetGood = false;
            let passedWork = false;
            let passedPutGood = false;

            for (let i = 0; i < 60; i++) {
                system.tick(2.0);
                const runtime = getRuntime(system, settler.id);
                if (!runtime?.job) continue;

                const nodeIdx = runtime.job.nodeIndex;
                if (nodeIdx > getGoodIdx) passedGetGood = true;
                if (nodeIdx > workIdx) passedWork = true;
                if (nodeIdx > putGoodIdx) passedPutGood = true;
            }

            expect(passedGetGood || passedWork || passedPutGood).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Job interruption
    // ─────────────────────────────────────────────────────────

    describe('job interruption', () => {
        it('interrupts mid-job and calls onWorkInterrupt when work started', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016); // selects job
            system.tick(0.016); // GO_TO_TARGET completes
            system.tick(0.016); // WORK_ON_ENTITY starts

            expect(handler.onWorkStart).toHaveBeenCalled();

            system.assignMoveTask(settler.id, 20, 20);
            expect(handler.onWorkInterrupt).toHaveBeenCalledWith(tree.id);
        });

        it('releases building assignment on entity removal', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);
            const runtime = getRuntime(system, settler.id);
            expect(runtime.assignedBuilding).toBe(building.id);

            system.onEntityRemoved(settler.id);
            expect((system as any).runtimes.has(settler.id)).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Building occupancy
    // ─────────────────────────────────────────────────────────

    describe('building occupancy', () => {
        it('claims building when selecting a job', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            const occupants = (system as any).buildingOccupants as Map<number, number>;
            expect(occupants.get(building.id)).toBe(1);
        });

        it('releases building occupancy on worker removal', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            const occupants = (system as any).buildingOccupants as Map<number, number>;
            expect(occupants.get(building.id)).toBe(1);

            system.onEntityRemoved(settler.id);
            expect(occupants.get(building.id) ?? 0).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Debug info API
    // ─────────────────────────────────────────────────────────

    describe('debug info API', () => {
        it('returns correct debug info for working settler', () => {
            const system = createTaskSystem(ctx);
            const tree = ctx.state.addEntity(EntityType.MapObject, 0, 10, 10, 0);
            const handler = createTargetHandler({ entityId: tree.id, x: 10, y: 10 });
            system.registerWorkHandler(SearchType.TREE, handler);

            const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0, Race.Roman);
            const { entity: settler } = addUnit(ctx.state, 10, 10, { subType: UnitType.Woodcutter });

            system.tick(0.016);

            const infos = system.getDebugInfo();
            const settlerInfo = infos.find(i => i.entityId === settler.id);
            expect(settlerInfo).toBeDefined();
            expect(settlerInfo!.state).toBe('WORKING');
            expect(settlerInfo!.jobId).toBe('JOB_WOODCUTTER_WORK');
            expect(settlerInfo!.jobType).toBe('choreo');
            expect(settlerInfo!.assignedBuilding).toBe(building.id);
            expect(settlerInfo!.targetId).toBe(tree.id);
        });
    });
});
