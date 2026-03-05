/**
 * Shared test helpers for creating GameState test fixtures.
 *
 * Reduces boilerplate in game-state, movement, command, and
 * pathfinding tests that need entities with valid state.
 */

import { GameState, UnitStateView } from '@/game/game-state';
import { EntityType, BuildingType, UnitType, getUnitTypeSpeed, type Entity } from '@/game/entity';
import { Race } from '@/game/race';
import { createTestMap, type TestMap } from './test-map';
import { EventBus } from '@/game/event-bus';
import { spiralSearch } from '@/game/utils/spiral-search';
import { MovementSystem } from '@/game/systems/movement/index';
import {
    BuildingConstructionSystem,
    ConstructionSiteManager,
    ResidenceSpawnerSystem,
} from '@/game/features/building-construction';
import { CarrierManager } from '@/game/features/carriers';
import { BuildingInventoryManager } from '@/game/features/inventory';
import { ServiceAreaManager } from '@/game/features/service-areas';
import { RequestManager } from '@/game/features/logistics';
import { GameSettingsManager, type GameSettings } from '@/game/game-settings';
import { EntityCleanupRegistry } from '@/game/systems';
import { installTestGameData } from './test-game-data';

// ─── GameState factory ──────────────────────────────────────────────

export function createGameState(): GameState {
    installTestGameData();
    const eventBus = new EventBus();
    eventBus.strict = true;
    const state = new GameState(eventBus);
    const movement = new MovementSystem({
        eventBus,
        rng: state.rng,
        updatePosition: (id, x, y) => {
            state.updateEntityPosition(id, x, y);
            return true;
        },
        getEntity: id => state.getEntity(id),
        tileOccupancy: state.tileOccupancy,
        buildingOccupancy: state.buildingOccupancy,
    });
    state.initMovement(movement);

    // Wire entity lifecycle events (mirrors GameServices subscriptions)
    wireEntityLifecycleEvents(eventBus, movement, state);
    return state;
}

/**
 * Wire entity:created / entity:removed event subscriptions.
 * Mirrors the production wiring done by GameServices — creates movement controllers
 * for units and resource state for stacked resources.
 */
function wireEntityLifecycleEvents(eventBus: EventBus, movement: MovementSystem, state: GameState): void {
    eventBus.on('entity:created', ({ entityId, type, subType, x, y }) => {
        if (type === EntityType.Unit) {
            const speed = getUnitTypeSpeed(subType as UnitType);
            movement.createController(entityId, x, y, speed);
        } else if (type === EntityType.StackedPile) {
            state.piles.createState(entityId);
        }
    });
    eventBus.on('entity:removed', ({ entityId }) => {
        movement.removeController(entityId);
        state.piles.removeState(entityId);
    });
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
    /** Per-test GameSettings (reactive state) — isolated from other tests */
    settings: GameSettings;
    // Managers (created by tests, not from GameState)
    carrierManager: CarrierManager;
    inventoryManager: BuildingInventoryManager;
    serviceAreaManager: ServiceAreaManager;
    requestManager: RequestManager;
    constructionSiteManager: ConstructionSiteManager;
    // System for construction events
    buildingConstructionSystem: BuildingConstructionSystem;
    /** Residence spawner wired in immediate mode for tests */
    residenceSpawner: ResidenceSpawnerSystem;
}

/**
 * Create a complete test context with GameState, TestMap, EventBus, and managers.
 * The state is initialized with terrain data from the map.
 *
 * Operational buildings (completed): just create the entity — absence of a ConstructionSite
 * record means the building is operational.
 * Buildings under construction: create the entity AND call
 * `constructionSiteManager.registerSite(...)` to register a construction site.
 *
 * The BuildingConstructionSystem is registered to handle building:completed events.
 *
 * @param mapWidth - Map width (default: 64)
 * @param mapHeight - Map height (default: 64)
 */
export function createTestContext(mapWidth = 64, mapHeight = 64): TestContext {
    // Ensure game data is available for XML-derived lookups (getBuildingWorkerInfo, etc.)
    installTestGameData();

    const map = createTestMap(mapWidth, mapHeight);
    const eventBus = new EventBus();
    eventBus.strict = true;
    const state = new GameState(eventBus);
    const settingsManager = new GameSettingsManager();
    settingsManager.resetToDefaults();

    // Create MovementSystem (owned externally, set on GameState)
    const movement = new MovementSystem({
        eventBus,
        rng: state.rng,
        updatePosition: (id, x, y) => {
            state.updateEntityPosition(id, x, y);
            return true;
        },
        getEntity: id => state.getEntity(id),
        tileOccupancy: state.tileOccupancy,
        buildingOccupancy: state.buildingOccupancy,
    });
    state.initMovement(movement);

    // Create managers with required dependencies via constructor
    const carrierManager = new CarrierManager({
        entityProvider: state,
        eventBus,
    });
    const inventoryManager = new BuildingInventoryManager();
    const serviceAreaManager = new ServiceAreaManager();
    const requestManager = new RequestManager(eventBus);
    const constructionSiteManager = new ConstructionSiteManager(eventBus);

    // Pre-declare context variable so the lazy executor closure can capture it
    // eslint-disable-next-line prefer-const -- must be let: assigned after construction system captures it in a closure
    let context: TestContext;

    // Create and register BuildingConstructionSystem for event handling
    // Uses a lazy command executor so it references the returned context
    const buildingConstructionSystem = new BuildingConstructionSystem({
        gameState: state,
        eventBus,
        constructionSiteManager,
        executeCommand: cmd => executeCommand(toCommandContext(context), cmd),
    });
    buildingConstructionSystem.setTerrainContext({
        terrain: map.terrain,
    });

    // Wire a ResidenceSpawnerSystem in immediate mode so tests can verify
    // carrier spawning without driving the timed interval loop.
    const residenceSpawner = new ResidenceSpawnerSystem({
        gameState: state,
        executeCommand: cmd => executeCommand(toCommandContext(context), cmd),
    });
    residenceSpawner.setTerrain(map.terrain);
    residenceSpawner.immediateMode = true;
    buildingConstructionSystem.setResidenceSpawner(residenceSpawner);

    buildingConstructionSystem.registerEvents();

    // Mirror game-services.ts wiring: register construction site on placement, remove on completion
    eventBus.on('building:placed', ({ entityId, buildingType, x, y, player }) => {
        const entity = state.getEntity(entityId);
        if (!entity) return;
        constructionSiteManager.registerSite(entityId, buildingType, entity.race, player, x, y);
    });
    eventBus.on('building:completed', ({ entityId }) => {
        constructionSiteManager.removeSite(entityId);
    });

    // Initialize terrain data on movement system
    movement.setTerrainData(map.groundType, map.groundHeight, map.mapSize.width, map.mapSize.height);

    // Wire entity lifecycle events (movement controllers, resource state)
    wireEntityLifecycleEvents(eventBus, movement, state);
    const cleanupRegistry = new EntityCleanupRegistry();
    cleanupRegistry.registerEvents(eventBus);

    context = {
        state,
        map,
        eventBus,
        settings: settingsManager.state,
        carrierManager,
        inventoryManager,
        serviceAreaManager,
        requestManager,
        constructionSiteManager,
        buildingConstructionSystem,
        residenceSpawner,
    };
    return context;
}

// ─── Entity creation helpers ────────────────────────────────────────

/** Add a unit and return both the entity and its UnitStateView (asserted non-null). */
export function addUnit(
    state: GameState,
    x: number,
    y: number,
    options: { player?: number; subType?: number; race?: Race } = {}
): { entity: Entity; unitState: UnitStateView } {
    const entity = state.addEntity(
        EntityType.Unit,
        options.subType ?? 0,
        x,
        y,
        options.player ?? 0,
        undefined,
        undefined,
        options.race ?? Race.Roman
    );
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
    race = Race.Roman
): Entity {
    return state.addEntity(EntityType.Building, buildingType, x, y, player, undefined, undefined, race);
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
    player = 0,
    race = Race.Roman
): Entity {
    const building = ctx.state.addEntity(EntityType.Building, buildingType, x, y, player, undefined, undefined, race);
    ctx.inventoryManager.createInventory(building.id, buildingType as BuildingType, race);
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

// ─── Building construction helpers ──────────────────────────────────

/**
 * Register a construction site for testing building construction.
 * Useful for testing terrain leveling and construction phases.
 * After registration the building is considered "under construction" by all systems.
 *
 * To simulate a completed/operational building, simply do NOT call this —
 * the absence of a ConstructionSite record means the building is operational.
 */
export function registerConstructionSite(
    ctx: TestContext,
    buildingId: number,
    buildingType: BuildingType,
    tileX: number,
    tileY: number,
    player = 0,
    race = Race.Roman
): void {
    ctx.constructionSiteManager.registerSite(buildingId, buildingType, race, player, tileX, tileY);
}

// ─── Construction helpers ───────────────────────────────────────────

/**
 * Fast-forward a building to construction completion using event-driven phase progression.
 * Emits all construction events to drive through WaitingForDiggers → TerrainLeveling →
 * WaitingForBuilders → ConstructionRising → CompletedRising, then ticks to finish the
 * CompletedRising countdown (0.5s) and emit building:completed.
 */
export function completeConstruction(ctx: TestContext, entityId: number): void {
    // Register a construction site if one doesn't already exist (tests that create entities
    // directly via addEntity bypass the place_building command that normally registers sites)
    if (!ctx.constructionSiteManager.hasSite(entityId)) {
        const entity = ctx.state.getEntityOrThrow(entityId, 'completeConstruction');
        ctx.constructionSiteManager.registerSite(
            entityId,
            entity.subType as BuildingType,
            entity.race,
            entity.player,
            entity.x,
            entity.y
        );
    }
    // Drive through event-based phase transitions
    ctx.eventBus.emit('construction:diggingStarted', { buildingId: entityId });
    ctx.eventBus.emit('construction:levelingComplete', { buildingId: entityId });
    ctx.eventBus.emit('construction:buildingStarted', { buildingId: entityId });
    ctx.eventBus.emit('construction:progressComplete', { buildingId: entityId });
    // Tick past the CompletedRising countdown (COMPLETED_RISING_DURATION = 0.5s)
    ctx.buildingConstructionSystem.tick(0.6);
}

// ─── Command execution helpers ──────────────────────────────────────

import { executeCommand, commandSuccess, type CommandResult, type CommandContext } from '@/game/commands';

/** Build a CommandContext from a TestContext (optionally override eventBus). */
export function toCommandContext(ctx: TestContext, eventBus?: EventBus): CommandContext {
    return {
        state: ctx.state,
        terrain: ctx.map.terrain,
        eventBus: eventBus ?? ctx.eventBus,
        settings: ctx.settings,
        constructionSiteManager: ctx.constructionSiteManager,
        // Stubs for systems not wired in unit-test contexts.
        // Tests that exercise tree/crop/production commands should use TestSimulation instead.
        settlerTaskSystem: {
            assignMoveTask: (id: number, x: number, y: number) => ctx.state.movement.moveUnit(id, x, y),
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
        combatSystem: {
            releaseFromCombat: () => {},
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
        treeSystem: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
        cropSystem: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
        productionControlManager: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
        storageFilterManager: undefined as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
    };
}

/** Execute a place_building command. Returns CommandResult. */
export function placeBuilding(
    ctx: TestContext,
    x: number,
    y: number,
    buildingType: number = BuildingType.WoodcutterHut,
    player = 0,
    opts: { completed?: boolean; spawnWorker?: boolean } = {}
): CommandResult {
    return executeCommand(toCommandContext(ctx), {
        type: 'place_building',
        buildingType,
        x,
        y,
        player,
        race: 10,
        ...opts,
    });
}

/**
 * Place a building via command with worker spawned at the door.
 * Uses the place_building command with `spawnWorker: true` (bypasses the
 * settings-based event cascade so the worker appears in the command effects).
 * Returns both the building entity and the worker entity.
 */
export function placeBuildingWithWorker(
    ctx: TestContext,
    x: number,
    y: number,
    buildingType: BuildingType,
    race = Race.Roman
): { building: Entity; worker: Entity } {
    const result = executeCommand(toCommandContext(ctx), {
        type: 'place_building',
        buildingType,
        x,
        y,
        player: 0,
        race,
        spawnWorker: true,
    });

    if (!result.success) {
        throw new Error(`Failed to place ${BuildingType[buildingType]} at (${x}, ${y}): ${result.error}`);
    }
    const effects = result.effects!;
    const buildingEffect = effects.find(e => e.type === 'building_placed');
    const workerEffect = effects.find(e => e.type === 'unit_spawned');
    if (!buildingEffect) throw new Error(`No building_placed effect for ${BuildingType[buildingType]}`);
    if (!workerEffect) throw new Error(`No unit_spawned effect for ${BuildingType[buildingType]}`);

    return {
        building: ctx.state.getEntityOrThrow(buildingEffect.entityId, 'placeBuildingWithWorker building'),
        worker: ctx.state.getEntityOrThrow(workerEffect.entityId, 'placeBuildingWithWorker worker'),
    };
}

/** Execute a spawn_unit command. Returns CommandResult. */
export function spawnUnit(ctx: TestContext, x: number, y: number, unitType = 0, player = 0): CommandResult {
    return executeCommand(toCommandContext(ctx), { type: 'spawn_unit', unitType, x, y, player, race: 10 });
}

/** Execute a move_unit command. Returns CommandResult. */
export function moveUnit(ctx: TestContext, entityId: number, targetX: number, targetY: number): CommandResult {
    // Ensure terrain data is set for the movement system
    ctx.state.movement.setTerrainData(
        ctx.map.groundType,
        ctx.map.groundHeight,
        ctx.map.mapSize.width,
        ctx.map.mapSize.height
    );
    return executeCommand(toCommandContext(ctx), { type: 'move_unit', entityId, targetX, targetY });
}

/** Execute a select command. Returns CommandResult. */
export function selectEntity(ctx: TestContext, entityId: number | null): CommandResult {
    return executeCommand(toCommandContext(ctx), { type: 'select', entityId });
}

/** Execute a remove_entity command. Returns CommandResult. */
export function removeEntity(ctx: TestContext, entityId: number): CommandResult {
    return executeCommand(toCommandContext(ctx), { type: 'remove_entity', entityId });
}

/** Execute a place_pile command. Returns CommandResult. */
export function placeResource(ctx: TestContext, x: number, y: number, materialType: number, amount = 1): CommandResult {
    return executeCommand(toCommandContext(ctx), { type: 'place_pile', materialType, amount, x, y });
}

// ─── Terrain query helpers ───────────────────────────────────────────

/**
 * Check if terrain at (x, y) is passable for units.
 * Water types (0-8) are impassable.
 */
export function isTerrainPassable(map: TestMap, x: number, y: number): boolean {
    const index = map.mapSize.toIndex(x, y);
    const terrainType = map.groundType[index]!;
    return terrainType > 8; // Water types are 0-8
}

/**
 * Check if terrain at (x, y) is water.
 */
export function isTerrainWater(map: TestMap, x: number, y: number): boolean {
    const index = map.mapSize.toIndex(x, y);
    const terrainType = map.groundType[index]!;
    return terrainType <= 8;
}

/**
 * Find a passable tile on the map near center.
 * Returns null if no passable tile found.
 */
export function findPassableTile(map: TestMap): { x: number; y: number } | null {
    const { width, height } = map.mapSize;
    return spiralSearch(Math.floor(width / 2), Math.floor(height / 2), width, height, (x, y) =>
        isTerrainPassable(map, x, y)
    );
}

/**
 * Find a buildable tile on the map near center.
 * Buildable terrain is grass (16) or desert (64).
 */
export function findBuildableTile(map: TestMap): { x: number; y: number } | null {
    const { width, height } = map.mapSize;
    const BUILDABLE = [16, 64]; // GRASS, DESERT
    return spiralSearch(Math.floor(width / 2), Math.floor(height / 2), width, height, (x, y) => {
        const index = map.mapSize.toIndex(x, y);
        return BUILDABLE.includes(map.groundType[index]!);
    });
}

// ─── InputContext test helper ────────────────────────────────────────

import type { InputContext } from '@/game/input/input-mode';

/** Create a mock InputContext for input mode tests. */
export function createTestInputContext(overrides?: Partial<InputContext>): {
    ctx: InputContext;
    commands: Record<string, unknown>[];
    getSwitchedMode: () => string | null;
    getModeData: () => unknown;
} {
    let modeData: unknown;
    const commands: Record<string, unknown>[] = [];
    let switchedTo: string | null = null;

    const ctx: InputContext = {
        state: {
            pointer: { value: { x: 0, y: 0, tileX: 10, tileY: 10 } },
            keys: { value: new Set() },
            drag: { value: null },
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal InputState stub
        currentTile: { x: 10, y: 10 },
        getModeData: <T>() => modeData as T,
        setModeData: <T>(data: T) => {
            modeData = data;
        },
        switchMode: (name: string) => {
            switchedTo = name;
        },
        executeCommand: cmd => {
            commands.push(cmd);
            return commandSuccess();
        },
        localPlayerRace: null,
        ...overrides,
    };

    return { ctx, commands, getSwitchedMode: () => switchedTo, getModeData: () => modeData };
}
