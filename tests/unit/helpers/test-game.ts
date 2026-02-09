/**
 * Shared test helpers for creating GameState test fixtures.
 *
 * Reduces boilerplate in game-state, movement, command, and
 * pathfinding tests that need entities with valid state.
 */

import { GameState, UnitStateView } from '@/game/game-state';
import { EntityType, BuildingType, type Entity } from '@/game/entity';
import { type TestMap } from './test-map';

// ─── GameState factory ──────────────────────────────────────────────

export function createGameState(): GameState {
    return new GameState();
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

/**
 * Initialize animation state on an entity.
 * Required before using CarrierAnimationController or other animation APIs.
 */
export function initializeAnimationState(
    entity: Entity,
    options: { sequenceKey?: string; direction?: number } = {},
): void {
    entity.animationState = {
        sequenceKey: options.sequenceKey ?? 'default',
        currentFrame: 0,
        elapsedMs: 0,
        direction: options.direction ?? 0,
        playing: false,
    };
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

// ─── Command execution helpers ──────────────────────────────────────

import { executeCommand } from '@/game/commands';
import { EventBus } from '@/game/event-bus';
import { BuildingConstructionSystem } from '@/game/features/building-construction';

/**
 * Create an EventBus wired up with a BuildingConstructionSystem for terrain restoration.
 * Used by test helpers that need building removal to restore terrain.
 */
export function createTestEventBus(state: GameState, map: TestMap): EventBus {
    const eventBus = new EventBus();
    const system = new BuildingConstructionSystem(state);
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
