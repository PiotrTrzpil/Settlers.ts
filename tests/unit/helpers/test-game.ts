/**
 * Lightweight test helpers for GameState unit tests.
 *
 * Provides a minimal GameState factory (no managers, no command registry)
 * and entity creation helpers for movement and state-invariant tests.
 *
 * For integration tests with full game systems, use TestSimulation instead.
 */

import { GameState, UnitStateView } from '@/game/game-state';
import { EntityType, BuildingType, UnitType, getUnitTypeSpeed, type Entity, Tile } from '@/game/entity';
import { Race } from '@/game/core/race';
import { createTestMap } from './test-map';
import { EventBus } from '@/game/event-bus';
import { MovementSystem } from '@/game/systems/movement/index';
import { SpatialGrid } from '@/game/spatial-grid';
import { installTestGameData } from './test-game-data';

// ─── GameState factory ──────────────────────────────────────────────

const DEFAULT_TEST_MAP_SIZE = 256;

export function createGameState(): GameState {
    installTestGameData();
    const eventBus = new EventBus();
    eventBus.strict = true;
    const state = new GameState(eventBus, () => 0);
    state.playerRaces = new Map([
        [0, Race.Roman],
        [1, Race.Roman],
    ]);

    // SpatialGrid must be initialized before any entities are added.
    // In tests, all tiles are "owned" by player 0 so nearbyForPlayer works.
    const spatialIndex = new SpatialGrid(
        DEFAULT_TEST_MAP_SIZE,
        DEFAULT_TEST_MAP_SIZE,
        4,
        id => state.getEntity(id),
        () => 0 // all tiles owned by player 0
    );
    state.initSpatialIndex(spatialIndex);
    spatialIndex.rebuildAllCells();

    const movement = new MovementSystem({
        eventBus,
        updatePosition: (id, newPos) => {
            state.updateEntityPosition(id, newPos);
            return true;
        },
        getEntity: id => state.getEntity(id),
        unitOccupancy: state.unitOccupancy,
        buildingOccupancy: state.buildingOccupancy,
        buildingFootprint: state.buildingFootprint,
    });
    state.initMovement(movement);

    // Set terrain data so pathfinding and bump validation work in tests
    const map = createTestMap(DEFAULT_TEST_MAP_SIZE, DEFAULT_TEST_MAP_SIZE);
    movement.setTerrainData(map.groundType, map.groundHeight, map.mapSize.width, map.mapSize.height);

    // Wire entity lifecycle events (mirrors GameServices subscriptions)
    wireEntityLifecycleEvents(eventBus, movement, state);
    return state;
}

/**
 * Wire entity:created / entity:removed event subscriptions.
 * Mirrors the production wiring done by GameServices — creates movement controllers
 * for units and resource state for stacked resources.
 */
function wireEntityLifecycleEvents(eventBus: EventBus, movement: MovementSystem, _state: GameState): void {
    eventBus.on('entity:created', ({ entityId, entityType: type, subType, x, y, hidden }) => {
        if (type === EntityType.Unit && !hidden) {
            const speed = getUnitTypeSpeed(subType as UnitType);
            movement.createController(entityId, { x, y }, speed);
        }
    });
    eventBus.on('entity:removed', ({ entityId }) => {
        movement.removeController(entityId);
    });
}

// ─── Entity creation helpers ────────────────────────────────────────

/** Add a unit and return both the entity and its UnitStateView (asserted non-null). */
export function addUnit(
    state: GameState,
    x: number,
    y: number,
    options: { player?: number; subType?: UnitType; race?: Race } = {}
): { entity: Entity; unitState: UnitStateView } {
    const entity = state.addEntity(
        EntityType.Unit,
        options.subType ?? UnitType.Carrier,
        { x, y },
        options.player ?? 0,
        {
            race: options.race ?? Race.Roman,
        }
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
    return state.addEntity(EntityType.Building, buildingType, { x, y }, player, { race });
}

/** Set up a unit with a pre-assigned path for movement testing. */
export function addUnitWithPath(
    state: GameState,
    startX: number,
    startY: number,
    path: Array<Tile>,
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
