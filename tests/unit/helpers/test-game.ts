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
    type BuildingState,
    type TerrainContext,
} from '@/game/features/building-construction';

// ─── GameState factory ──────────────────────────────────────────────

export function createGameState(): GameState {
    return new GameState();
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
}

/**
 * Create a complete test context with GameState, TestMap, and EventBus.
 * The state is initialized with terrain data from the map.
 * Building states are automatically created by GameState.addEntity().
 *
 * @param mapWidth - Map width (default: 64)
 * @param mapHeight - Map height (default: 64)
 */
export function createTestContext(mapWidth = 64, mapHeight = 64): TestContext {
    const state = new GameState();
    const map = createTestMap(mapWidth, mapHeight);
    const eventBus = new EventBus();

    // Initialize terrain data on state
    state.setTerrainData(
        map.groundType,
        map.groundHeight,
        map.mapSize.width,
        map.mapSize.height,
    );

    return { state, map, eventBus };
}

// ─── Entity creation helpers ────────────────────────────────────────

/** Add a unit and return both the entity and its UnitStateView (asserted non-null). */
export function addUnit(
    state: GameState,
    x: number,
    y: number,
    options: { player?: number; subType?: number } = {},
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
    player = 0,
): Entity {
    return state.addEntity(EntityType.Building, buildingType, x, y, player);
}

/**
 * Add a building with its inventory initialized.
 * Without GameLoop, we need to manually create the inventory.
 */
export function addBuildingWithInventory(
    state: GameState,
    x: number,
    y: number,
    buildingType: BuildingType | number = BuildingType.WoodcutterHut,
    player = 0,
): Entity {
    const building = state.addEntity(EntityType.Building, buildingType, x, y, player);
    state.inventoryManager.createInventory(building.id, buildingType as BuildingType);
    return building;
}

/** Set up a unit with a pre-assigned path for movement testing. */
export function addUnitWithPath(
    state: GameState,
    startX: number,
    startY: number,
    path: Array<{ x: number; y: number }>,
    speed = 2,
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
    amount = 1,
): CarrierJob {
    return { type: 'pickup', fromBuilding, material, amount };
}

/** Create a deliver job for carrier testing. */
export function createDeliverJob(
    toBuilding: number,
    material: EMaterialType = EMaterialType.LOG,
    amount = 1,
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
    overrides: Partial<BuildingState> = {},
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
export function tickConstruction(gameState: GameState, dt: number, ctx: TerrainContext): void {
    const system = new BuildingConstructionSystem({
        gameState,
        buildingStateManager: gameState.buildingStateManager,
    });
    system.setTerrainContext(ctx);
    system.tick(dt);
}

// ─── Command execution helpers ──────────────────────────────────────

import { executeCommand } from '@/game/commands';

/**
 * Create an EventBus wired up with a BuildingConstructionSystem for terrain restoration.
 * Used by test helpers that need building removal to restore terrain.
 */
export function createTestEventBus(state: GameState, map: TestMap): EventBus {
    const eventBus = new EventBus();
    const system = new BuildingConstructionSystem({
        gameState: state,
        buildingStateManager: state.buildingStateManager,
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
    state: GameState,
    map: TestMap,
    x: number,
    y: number,
    buildingType: number = BuildingType.WoodcutterHut,
    player = 0,
    eventBus: EventBus = new EventBus(),
): boolean {
    return executeCommand(
        state,
        { type: 'place_building', buildingType, x, y, player },
        map.groundType,
        map.groundHeight,
        map.mapSize,
        eventBus,
    );
}

/** Execute a spawn_unit command. Returns success boolean. */
export function spawnUnit(
    state: GameState,
    map: TestMap,
    x: number,
    y: number,
    unitType = 0,
    player = 0,
    eventBus: EventBus = new EventBus(),
): boolean {
    return executeCommand(
        state,
        { type: 'spawn_unit', unitType, x, y, player },
        map.groundType,
        map.groundHeight,
        map.mapSize,
        eventBus,
    );
}

/** Execute a move_unit command. Returns success boolean. */
export function moveUnit(
    state: GameState,
    map: TestMap,
    entityId: number,
    targetX: number,
    targetY: number,
    eventBus: EventBus = new EventBus(),
): boolean {
    // Ensure terrain data is set for the movement system
    state.setTerrainData(
        map.groundType,
        map.groundHeight,
        map.mapSize.width,
        map.mapSize.height
    );
    return executeCommand(
        state,
        { type: 'move_unit', entityId, targetX, targetY },
        map.groundType,
        map.groundHeight,
        map.mapSize,
        eventBus,
    );
}

/** Execute a select command. Returns success boolean. */
export function selectEntity(
    state: GameState,
    map: TestMap,
    entityId: number | null,
    eventBus: EventBus = new EventBus(),
): boolean {
    return executeCommand(
        state,
        { type: 'select', entityId },
        map.groundType,
        map.groundHeight,
        map.mapSize,
        eventBus,
    );
}

/** Execute a remove_entity command. Returns success boolean. */
export function removeEntity(
    state: GameState,
    map: TestMap,
    entityId: number,
    eventBus?: EventBus,
): boolean {
    const bus = eventBus ?? createTestEventBus(state, map);
    return executeCommand(
        state,
        { type: 'remove_entity', entityId },
        map.groundType,
        map.groundHeight,
        map.mapSize,
        bus,
    );
}
