/**
 * Shared test helpers for creating GameState test fixtures.
 *
 * Reduces boilerplate in game-state, movement, command, and
 * pathfinding tests that need entities with valid state.
 */

import { GameState, UnitStateView } from '@/game/game-state';
import { EntityType, BuildingType, type Entity } from '@/game/entity';
import { createTestMap, type TestMap } from './test-map';
import { EventBus } from '@/game/event-bus';
import {
    BuildingConstructionPhase,
    BuildingConstructionSystem,
    BuildingStateManager,
    type BuildingState,
    type TerrainContext,
} from '@/game/features/building-construction';
import { CarrierManager } from '@/game/features/carriers';
import { BuildingInventoryManager } from '@/game/features/inventory';
import { ServiceAreaManager } from '@/game/features/service-areas';
import { RequestManager } from '@/game/features/logistics';

// ─── GameState factory ──────────────────────────────────────────────

export function createGameState(): GameState {
    // GameState now requires EventBus in constructor
    const eventBus = new EventBus();
    return new GameState(eventBus);
}

// ─── Unified test context ───────────────────────────────────────────

/**
 * Complete test context with all common test objects.
 * Reduces boilerplate in test files that need multiple objects.
 *
 * @example
 * ```ts
 * let ctx: TestContext;
 * beforeEach(() => { ctx = createTestContext(); });
 *
 * it('test', () => {
 *     const building = addBuilding(ctx.state, 5, 5, BuildingType.WoodcutterHut);
 *     // ...
 * });
 * ```
 */
export interface TestContext {
    state: GameState;
    map: TestMap;
    eventBus: EventBus;
    // Managers (created by tests, not from GameState)
    carrierManager: CarrierManager;
    inventoryManager: BuildingInventoryManager;
    serviceAreaManager: ServiceAreaManager;
    requestManager: RequestManager;
    buildingStateManager: BuildingStateManager;
}

/**
 * Create a complete test context with GameState, TestMap, EventBus, and managers.
 * The state is initialized with terrain data from the map.
 * Building states are created by the buildingStateManager when buildings are added.
 *
 * @param mapWidth - Map width (default: 64)
 * @param mapHeight - Map height (default: 64)
 */
export function createTestContext(mapWidth = 64, mapHeight = 64): TestContext {
    const map = createTestMap(mapWidth, mapHeight);
    const eventBus = new EventBus();
    // GameState now requires EventBus in constructor (MovementSystem gets it automatically)
    const state = new GameState(eventBus);

    // Create managers with required dependencies via constructor
    const carrierManager = new CarrierManager({
        entityProvider: state,
        eventBus,
    });
    const inventoryManager = new BuildingInventoryManager();
    const serviceAreaManager = new ServiceAreaManager();
    const requestManager = new RequestManager();
    const buildingStateManager = new BuildingStateManager({
        entityProvider: state,
        eventBus,
    });

    // Initialize terrain data on state
    state.setTerrainData(map.groundType, map.groundHeight, map.mapSize.width, map.mapSize.height);

    // Subscribe to building creation events for building state initialization
    eventBus.on('building:created', ({ entityId, buildingType, x, y }) => {
        buildingStateManager.createBuildingState(entityId, buildingType, x, y);
    });

    return {
        state,
        map,
        eventBus,
        carrierManager,
        inventoryManager,
        serviceAreaManager,
        requestManager,
        buildingStateManager,
    };
}

// ─── Entity creation helpers ────────────────────────────────────────

/** Add a unit and return both the entity and its UnitStateView (asserted non-null). */
export function addUnit(
    state: GameState,
    x: number,
    y: number,
    options: { player?: number; subType?: number } = {}
): { entity: Entity; unitState: UnitStateView } {
    const entity = state.addEntity(EntityType.Unit, options.subType ?? 0, x, y, options.player ?? 0);
    const unitState = state.unitStates.get(entity.id);
    if (!unitState) throw new Error(`UnitState not created for unit ${entity.id}`);
    return { entity, unitState };
}

/** Add a building entity and return it. */
export function addBuilding(
    state: GameState,
    x: number,
    y: number,
    buildingType: BuildingType | number = BuildingType.WoodcutterHut,
    player = 0
): Entity {
    return state.addEntity(EntityType.Building, buildingType, x, y, player);
}

/**
 * Add a building with its inventory initialized.
 * Without GameLoop, we need to manually create the inventory.
 */
export function addBuildingWithInventory(
    ctx: TestContext,
    x: number,
    y: number,
    buildingType: BuildingType | number = BuildingType.WoodcutterHut,
    player = 0
): Entity {
    const building = ctx.state.addEntity(EntityType.Building, buildingType, x, y, player);
    ctx.inventoryManager.createInventory(building.id, buildingType as BuildingType);
    return building;
}

/** Set up a unit with a pre-assigned path for movement testing. */
export function addUnitWithPath(
    state: GameState,
    startX: number,
    startY: number,
    path: Array<{ x: number; y: number }>,
    speed = 2
): { entity: Entity; unitState: UnitStateView } {
    const { entity, unitState } = addUnit(state, startX, startY);
    // Use the MovementController to set up the path and speed
    const controller = state.movement.getController(entity.id);
    if (controller) {
        controller.setSpeed(speed);
        controller.startPath(path);
    }
    return { entity, unitState };
}

// ─── Test data builders ─────────────────────────────────────────────

import { EMaterialType } from '@/game/economy/material-type';
import type { CarrierJob } from '@/game/features/carriers';

/** Create a pickup job for carrier testing. */
export function createPickupJob(
    fromBuilding: number,
    material: EMaterialType = EMaterialType.LOG,
    amount = 1
): CarrierJob {
    return { type: 'pickup', fromBuilding, material, amount };
}

/** Create a deliver job for carrier testing. */
export function createDeliverJob(
    toBuilding: number,
    material: EMaterialType = EMaterialType.LOG,
    amount = 1
): CarrierJob {
    return { type: 'deliver', toBuilding, material, amount };
}

/** Create a return_home job for carrier testing. */
export function createReturnHomeJob(): CarrierJob {
    return { type: 'return_home' };
}

// ─── Building construction helpers ──────────────────────────────────

/**
 * Create a BuildingState object for testing building construction.
 * Useful for testing terrain leveling and construction phases.
 */
export function makeBuildingState(
    tileX: number,
    tileY: number,
    buildingType: BuildingType,
    overrides: Partial<BuildingState> = {}
): BuildingState {
    return {
        entityId: 1,
        buildingType,
        phase: BuildingConstructionPhase.TerrainLeveling,
        phaseProgress: 0,
        totalDuration: 30,
        elapsedTime: 0,
        tileX,
        tileY,
        originalTerrain: null,
        terrainModified: false,
        ...overrides,
    };
}

/**
 * Create a BuildingConstructionSystem with terrain context and tick it.
 * Used for testing construction progression.
 */
export function tickConstruction(
    gameState: GameState,
    buildingStateManager: BuildingStateManager,
    dt: number,
    ctx: TerrainContext
): void {
    const system = new BuildingConstructionSystem({
        gameState,
        buildingStateManager,
    });
    system.setTerrainContext(ctx);
    system.registerEvents(new EventBus());
    system.tick(dt);
}

// ─── Command execution helpers ──────────────────────────────────────

import { executeCommand } from '@/game/commands';

/**
 * Create an EventBus wired up with a BuildingConstructionSystem for terrain restoration.
 * Used by test helpers that need building removal to restore terrain.
 */
export function createTestEventBus(
    state: GameState,
    map: TestMap,
    buildingStateManager: BuildingStateManager
): EventBus {
    const eventBus = new EventBus();
    const system = new BuildingConstructionSystem({
        gameState: state,
        buildingStateManager,
    });
    system.setTerrainContext({
        groundType: map.groundType,
        groundHeight: map.groundHeight,
        mapSize: map.mapSize,
    });
    system.registerEvents(eventBus);
    return eventBus;
}

/** Execute a place_building command. Returns success boolean. */
export function placeBuilding(
    ctx: TestContext,
    x: number,
    y: number,
    buildingType: number = BuildingType.WoodcutterHut,
    player = 0
): boolean {
    return executeCommand(
        ctx.state,
        { type: 'place_building', buildingType, x, y, player },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        ctx.eventBus,
        undefined,
        ctx.buildingStateManager
    );
}

/** Execute a spawn_unit command. Returns success boolean. */
export function spawnUnit(ctx: TestContext, x: number, y: number, unitType = 0, player = 0): boolean {
    return executeCommand(
        ctx.state,
        { type: 'spawn_unit', unitType, x, y, player },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        ctx.eventBus,
        undefined,
        ctx.buildingStateManager
    );
}

/** Execute a move_unit command. Returns success boolean. */
export function moveUnit(ctx: TestContext, entityId: number, targetX: number, targetY: number): boolean {
    // Ensure terrain data is set for the movement system
    ctx.state.setTerrainData(ctx.map.groundType, ctx.map.groundHeight, ctx.map.mapSize.width, ctx.map.mapSize.height);
    return executeCommand(
        ctx.state,
        { type: 'move_unit', entityId, targetX, targetY },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        ctx.eventBus,
        undefined,
        ctx.buildingStateManager
    );
}

/** Execute a select command. Returns success boolean. */
export function selectEntity(ctx: TestContext, entityId: number | null): boolean {
    return executeCommand(
        ctx.state,
        { type: 'select', entityId },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        ctx.eventBus,
        undefined,
        ctx.buildingStateManager
    );
}

/** Execute a remove_entity command. Returns success boolean. */
export function removeEntity(ctx: TestContext, entityId: number): boolean {
    const bus = createTestEventBus(ctx.state, ctx.map, ctx.buildingStateManager);
    return executeCommand(
        ctx.state,
        { type: 'remove_entity', entityId },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        bus,
        undefined,
        ctx.buildingStateManager
    );
}

/** Execute a place_resource command. Returns success boolean. */
export function placeResource(ctx: TestContext, x: number, y: number, materialType: number, amount = 1): boolean {
    return executeCommand(
        ctx.state,
        { type: 'place_resource', materialType, amount, x, y },
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize,
        ctx.eventBus,
        undefined,
        ctx.buildingStateManager
    );
}

// ─── Terrain query helpers ───────────────────────────────────────────

/**
 * Check if terrain at (x, y) is passable for units.
 * Water types (0-8) are impassable.
 */
export function isTerrainPassable(map: TestMap, x: number, y: number): boolean {
    const index = map.mapSize.toIndex(x, y);
    const terrainType = map.groundType[index];
    return terrainType > 8; // Water types are 0-8
}

/**
 * Check if terrain at (x, y) is water.
 */
export function isTerrainWater(map: TestMap, x: number, y: number): boolean {
    const index = map.mapSize.toIndex(x, y);
    const terrainType = map.groundType[index];
    return terrainType <= 8;
}

/**
 * Find a passable tile on the map near center.
 * Returns null if no passable tile found.
 */
export function findPassableTile(map: TestMap): { x: number; y: number } | null {
    const cx = Math.floor(map.mapSize.width / 2);
    const cy = Math.floor(map.mapSize.height / 2);

    // Spiral out from center to find passable tile
    for (let r = 0; r < 20; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // Only check perimeter
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < map.mapSize.width && y >= 0 && y < map.mapSize.height) {
                    if (isTerrainPassable(map, x, y)) {
                        return { x, y };
                    }
                }
            }
        }
    }
    return null;
}

/**
 * Find a buildable tile on the map near center.
 * Buildable terrain is grass (16) or desert (64).
 */
export function findBuildableTile(map: TestMap): { x: number; y: number } | null {
    const cx = Math.floor(map.mapSize.width / 2);
    const cy = Math.floor(map.mapSize.height / 2);
    const BUILDABLE = [16, 64]; // GRASS, DESERT

    // Spiral out from center
    for (let r = 0; r < 20; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < map.mapSize.width && y >= 0 && y < map.mapSize.height) {
                    const index = map.mapSize.toIndex(x, y);
                    if (BUILDABLE.includes(map.groundType[index])) {
                        return { x, y };
                    }
                }
            }
        }
    }
    return null;
}
