/**
 * Shared test helpers for creating GameState test fixtures.
 *
 * Reduces boilerplate in game-state, movement, command, and
 * pathfinding tests that need entities with valid state.
 */

import { GameState } from '@/game/game-state';
import { EntityType, BuildingType, type Entity, type UnitState } from '@/game/entity';
import { type TestMap } from './test-map';

// ─── GameState factory ──────────────────────────────────────────────

export function createGameState(): GameState {
    return new GameState();
}

// ─── Entity creation helpers ────────────────────────────────────────

/** Add a unit and return both the entity and its UnitState (asserted non-null). */
export function addUnit(
    state: GameState,
    x: number,
    y: number,
    options: { player?: number; subType?: number } = {},
): { entity: Entity; unitState: UnitState } {
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
    buildingType: BuildingType | number = BuildingType.Lumberjack,
    player = 0,
): Entity {
    return state.addEntity(EntityType.Building, buildingType, x, y, player);
}

/** Set up a unit with a pre-assigned path for movement testing. */
export function addUnitWithPath(
    state: GameState,
    startX: number,
    startY: number,
    path: Array<{ x: number; y: number }>,
    speed = 2,
): { entity: Entity; unitState: UnitState } {
    const { entity, unitState } = addUnit(state, startX, startY);
    unitState.path = path;
    unitState.speed = speed;
    return { entity, unitState };
}

// ─── Command execution helpers ──────────────────────────────────────

import { executeCommand } from '@/game/commands/command';

/** Execute a place_building command. Returns success boolean. */
export function placeBuilding(
    state: GameState,
    map: TestMap,
    x: number,
    y: number,
    buildingType: number = BuildingType.Lumberjack,
    player = 0,
): boolean {
    return executeCommand(
        state,
        { type: 'place_building', buildingType, x, y, player },
        map.groundType,
        map.groundHeight,
        map.mapSize,
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
): boolean {
    return executeCommand(
        state,
        { type: 'spawn_unit', unitType, x, y, player },
        map.groundType,
        map.groundHeight,
        map.mapSize,
    );
}

/** Execute a move_unit command. Returns success boolean. */
export function moveUnit(
    state: GameState,
    map: TestMap,
    entityId: number,
    targetX: number,
    targetY: number,
): boolean {
    return executeCommand(
        state,
        { type: 'move_unit', entityId, targetX, targetY },
        map.groundType,
        map.groundHeight,
        map.mapSize,
    );
}

/** Execute a select command. Returns success boolean. */
export function selectEntity(
    state: GameState,
    map: TestMap,
    entityId: number | null,
): boolean {
    return executeCommand(
        state,
        { type: 'select', entityId },
        map.groundType,
        map.groundHeight,
        map.mapSize,
    );
}

/** Execute a remove_entity command. Returns success boolean. */
export function removeEntity(
    state: GameState,
    map: TestMap,
    entityId: number,
): boolean {
    return executeCommand(
        state,
        { type: 'remove_entity', entityId },
        map.groundType,
        map.groundHeight,
        map.mapSize,
    );
}
