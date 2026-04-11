import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameState } from '@/game/game-state';
import { EntityType, UnitType, getUnitTypeSpeed, BuildingType, type Tile } from '@/game/entity';
import { Race } from '@/game/core/race';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';
import { CommandHandlerRegistry, registerAllHandlers } from '@/game/commands';
import { MapSize } from '@/utilities/map-size';
import { EventBus } from '@/game/event-bus';
import { ConstructionSiteManager } from '@/game/features/building-construction';
import { MovementSystem } from '@/game/systems/movement/index';
import { TerrainData } from '@/game/terrain';
import { GameSettingsManager } from '@/game/game-settings';

/**
 * Integration tests for unit placement, selection, and movement.
 * Tests the full pipeline: spawn_unit, select_at_tile, toggle_selection,
 * move_selected_units, multi-select, formation movement.
 */

// ─── Shared setup ────────────────────────────────────────────────────

function createTestHarness() {
    installTestGameData();
    const mapSize = new MapSize(64, 64);
    const groundType = new Uint8Array(64 * 64);
    const groundHeight = new Uint8Array(64 * 64);
    groundType.fill(16); // all grass (passable & buildable)
    const eventBus = new EventBus();
    const state = new GameState(eventBus, () => 0);
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

    eventBus.on('entity:created', ({ entityId, entityType: type, subType, x, y, hidden }) => {
        if (type === EntityType.Unit && !hidden) {
            const speed = getUnitTypeSpeed(subType as UnitType);
            movement.createController(entityId, { x, y }, speed);
        }
    });
    eventBus.on('entity:removed', ({ entityId }) => {
        movement.removeController(entityId);
    });

    const constructionSiteManager = new ConstructionSiteManager(eventBus, state.rng, {} as any);
    movement.setTerrainData(groundType, groundHeight, mapSize.width, mapSize.height);

    const terrain = new TerrainData(groundType, groundHeight, mapSize);
    const settingsManager = new GameSettingsManager();
    settingsManager.resetToDefaults();
    const registry = new CommandHandlerRegistry();
    registerAllHandlers(registry, {
        state,
        terrain,
        eventBus,
        settings: settingsManager.state,
        constructionSiteManager,
        settlerTaskSystem: {
            assignMoveTask: (id: number, target: Tile) => state.movement.moveUnit(id, target),
        } as any,
        combatSystem: { releaseFromCombat: () => {}, isInCombat: () => false, setPassive: () => {} } as any,
        storageFilterManager: undefined as any,
        inventoryManager: undefined as any,
        unitReservation: { isReserved: () => false } as any,
        recruitSystem: { enqueue: () => {}, dequeue: () => {}, getQueuedCount: () => 0, tick: () => {} } as any,
        unitTransformer: { dismissSpecialist: () => false } as any,
        getPlacementFilter: () => null,
        getOwner: () => 0,
    });

    return { state, terrain, registry };
}

// ── Unit Placement ────────────────────────────────────────────────

describe('Unit Placement (spawn_unit)', () => {
    let state: GameState;
    let terrain: TerrainData;
    let registry: CommandHandlerRegistry;

    afterEach(() => {
        resetTestGameData();
    });

    beforeEach(() => {
        const harness = createTestHarness();
        state = harness.state;
        terrain = harness.terrain;
        registry = harness.registry;
    });

    it('should spawn a unit with correct attributes and unit state', () => {
        const result = registry.execute({
            type: 'spawn_unit',
            unitType: UnitType.Carrier,
            x: 10,
            y: 10,
            player: 0,
            race: Race.Roman,
        });

        expect(result.success).toBe(true);
        expect(state.entities).toHaveLength(1);
        const entity = state.entities[0]!;
        expect(entity.type).toBe(EntityType.Unit);
        expect(entity.subType).toBe(UnitType.Carrier);
        expect(entity.x).toBe(10);
        expect(entity.y).toBe(10);

        const unitState = state.unitStates.get(entity.id);
        expect(unitState).toBeDefined();
        expect(unitState!.speed).toBe(2);
        expect(unitState!.path).toHaveLength(0);
    });

    it('should spawn adjacent when target tile is occupied', () => {
        registry.execute({
            type: 'spawn_unit',
            unitType: UnitType.Carrier,
            x: 10,
            y: 10,
            player: 0,
            race: Race.Roman,
        });

        const result = registry.execute({
            type: 'spawn_unit',
            unitType: UnitType.Swordsman1,
            x: 10,
            y: 10,
            player: 0,
            race: Race.Roman,
        });

        expect(result.success).toBe(true);
        expect(state.entities).toHaveLength(2);
        const swordsman = state.entities.find(e => e.subType === UnitType.Swordsman1)!;
        expect(swordsman.x !== 10 || swordsman.y !== 10).toBe(true);
    });

    it('should fail when spawning on water with no adjacent passable tile', () => {
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 3; x++) {
                terrain.groundType[terrain.toIndex({ x, y })] = 0;
            }
        }

        const result = registry.execute({
            type: 'spawn_unit',
            unitType: UnitType.Carrier,
            x: 1,
            y: 1,
            player: 0,
            race: Race.Roman,
        });

        expect(result.success).toBe(false);
    });
});

// ── Selection State Machine ───────────────────────────────────────

describe('Selection (select_at_tile)', () => {
    let state: GameState;
    let registry: CommandHandlerRegistry;

    afterEach(() => {
        resetTestGameData();
    });

    beforeEach(() => {
        const harness = createTestHarness();
        state = harness.state;
        registry = harness.registry;
    });

    it('should select unit, replace on normal click, and deselect on empty tile', () => {
        const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 10, y: 10 }, 0, { race: Race.Roman });
        const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 20, y: 20 }, 0, { race: Race.Roman });

        // Select unit1
        registry.execute({ type: 'select_at_tile', x: 10, y: 10, addToSelection: false });
        expect(state.selection.selectedEntityId).toBe(unit1.id);
        expect(state.selection.selectedEntityIds.size).toBe(1);

        // Click unit2 replaces selection
        registry.execute({ type: 'select_at_tile', x: 20, y: 20, addToSelection: false });
        expect(state.selection.selectedEntityId).toBe(unit2.id);
        expect(state.selection.selectedEntityIds.has(unit1.id)).toBe(false);

        // Click empty tile deselects
        registry.execute({ type: 'select_at_tile', x: 30, y: 30, addToSelection: false });
        expect(state.selection.selectedEntityId).toBe(null);
        expect(state.selection.selectedEntityIds.size).toBe(0);
    });

    it('should add/toggle with shift+click', () => {
        const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 10, y: 10 }, 0, { race: Race.Roman });
        const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 20, y: 20 }, 0, { race: Race.Roman });

        // Select unit1
        registry.execute({ type: 'select_at_tile', x: 10, y: 10, addToSelection: false });

        // Shift+click unit2 adds it
        registry.execute({ type: 'select_at_tile', x: 20, y: 20, addToSelection: true });
        expect(state.selection.selectedEntityIds.size).toBe(2);

        // Shift+click unit1 toggles it off, primary switches to unit2
        registry.execute({ type: 'select_at_tile', x: 10, y: 10, addToSelection: true });
        expect(state.selection.selectedEntityIds.size).toBe(1);
        expect(state.selection.selectedEntityIds.has(unit1.id)).toBe(false);
        expect(state.selection.selectedEntityId).toBe(unit2.id);
    });
});

// ── Toggle Selection & Move Selected Units ────────────────────────

describe('Toggle Selection & Move Selected Units', () => {
    let state: GameState;
    let registry: CommandHandlerRegistry;

    afterEach(() => {
        resetTestGameData();
    });

    beforeEach(() => {
        const harness = createTestHarness();
        state = harness.state;
        registry = harness.registry;
    });

    it('should toggle entity in/out of selection and maintain primary', () => {
        const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 10, y: 10 }, 0, { race: Race.Roman });
        const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 20, y: 20 }, 0, { race: Race.Roman });

        // Toggle on sets primary
        registry.execute({ type: 'toggle_selection', entityId: unit1.id });
        expect(state.selection.selectedEntityId).toBe(unit1.id);

        // Toggle on second keeps primary
        registry.execute({ type: 'toggle_selection', entityId: unit2.id });
        expect(state.selection.selectedEntityId).toBe(unit1.id);
        expect(state.selection.selectedEntityIds.size).toBe(2);

        // Toggle off primary — primary switches to remaining entity
        registry.execute({ type: 'toggle_selection', entityId: unit1.id });
        expect(state.selection.selectedEntityIds.has(unit1.id)).toBe(false);
        expect(state.selection.selectedEntityId).toBe(unit2.id);
    });

    it('should fail for non-existent entity', () => {
        const result = registry.execute({ type: 'toggle_selection', entityId: 999 });
        expect(result.success).toBe(false);
    });

    it('should move single selected unit and assign formation offsets for multiple', () => {
        const unit1 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        const unit2 = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 7 }, 0, { race: Race.Roman });
        state.selection.selectedEntityIds.add(unit1.id);
        state.selection.selectedEntityIds.add(unit2.id);
        state.selection.selectedEntityId = unit1.id;

        const result = registry.execute({ type: 'move_selected_units', targetX: 20, targetY: 20 });
        expect(result.success).toBe(true);

        const us1 = state.unitStates.get(unit1.id)!;
        const us2 = state.unitStates.get(unit2.id)!;
        expect(us1.path.length).toBeGreaterThan(0);
        expect(us2.path.length).toBeGreaterThan(0);

        // Formation: different targets
        const target1 = us1.path[us1.path.length - 1]!;
        const target2 = us2.path[us2.path.length - 1]!;
        expect(target1.x !== target2.x || target1.y !== target2.y).toBe(true);
    });

    it('should ignore buildings in selection and fail with empty selection', () => {
        const building = state.addEntity(EntityType.Building, BuildingType.WoodcutterHut, { x: 10, y: 10 }, 0, {
            race: Race.Roman,
        });
        state.selection.selectedEntityIds.add(building.id);
        state.selection.selectedEntityId = building.id;

        expect(registry.execute({ type: 'move_selected_units', targetX: 20, targetY: 20 }).success).toBe(false);

        // Empty selection
        state.selection.selectedEntityIds.clear();
        state.selection.selectedEntityId = null;
        expect(registry.execute({ type: 'move_selected_units', targetX: 20, targetY: 20 }).success).toBe(false);
    });

    it('should move only units when selection includes buildings', () => {
        const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        const building = state.addEntity(EntityType.Building, BuildingType.WoodcutterHut, { x: 10, y: 10 }, 0, {
            race: Race.Roman,
        });
        state.selection.selectedEntityIds.add(unit.id);
        state.selection.selectedEntityIds.add(building.id);
        state.selection.selectedEntityId = unit.id;

        const result = registry.execute({ type: 'move_selected_units', targetX: 20, targetY: 20 });
        expect(result.success).toBe(true);
        expect(state.unitStates.get(unit.id)!.path.length).toBeGreaterThan(0);
    });
});

// ── Movement Integration & Full Integration Flows ─────────────────

describe('Unit Movement Integration', () => {
    let state: GameState;
    let registry: CommandHandlerRegistry;

    afterEach(() => {
        resetTestGameData();
    });

    beforeEach(() => {
        const harness = createTestHarness();
        state = harness.state;
        registry = harness.registry;
    });

    it('should move unit along path, update occupancy, and track prev position', () => {
        const unit = state.addEntity(EntityType.Unit, UnitType.Carrier, { x: 5, y: 5 }, 0, { race: Race.Roman });
        const controller = state.movement.getController(unit.id)!;
        const unitState = state.unitStates.get(unit.id)!;

        controller.startPath([
            { x: 6, y: 5 },
            { x: 7, y: 5 },
            { x: 8, y: 5 },
        ]);

        // Speed 2, progress starts at 1. 0.5s adds 1 -> moves 2 tiles.
        state.movement.update(0.5);

        expect(unit.x).toBe(7);
        expect(state.getUnitAt({ x: 5, y: 5 })).toBeUndefined();
        expect(state.getUnitAt({ x: 7, y: 5 })!.id).toBe(unit.id);
        expect(unitState.prevX).toBe(6);
        expect(unitState.prevY).toBe(5);
    });

    it('should reset state after path completion', () => {
        const unit = state.addEntity(EntityType.Unit, UnitType.Carrier, { x: 5, y: 5 }, 0, { race: Race.Roman });
        const controller = state.movement.getController(unit.id)!;
        const unitState = state.unitStates.get(unit.id)!;
        controller.startPath([{ x: 6, y: 5 }]);
        controller.setSpeed(10);

        state.movement.update(1.0);

        expect(unitState.path).toHaveLength(0);
        expect(unitState.pathIndex).toBe(0);
        expect(unitState.moveProgress).toBe(0);
        expect(unitState.prevX).toBe(unit.x);
        expect(unitState.prevY).toBe(unit.y);
    });

    it('should spawn, select, and move a unit end-to-end', () => {
        registry.execute({
            type: 'spawn_unit',
            unitType: UnitType.Swordsman1,
            x: 5,
            y: 5,
            player: 0,
            race: Race.Roman,
        });

        const unit = state.entities[0]!;

        registry.execute({ type: 'select_at_tile', x: 5, y: 5, addToSelection: false });
        expect(state.selection.selectedEntityId).toBe(unit.id);

        registry.execute({ type: 'move_selected_units', targetX: 15, targetY: 5 });
        expect(state.unitStates.get(unit.id)!.path.length).toBeGreaterThan(0);

        for (let i = 0; i < 200; i++) {
            state.movement.update(1 / 30);
        }

        expect(unit.x).toBe(15);
        expect(unit.y).toBe(5);
    });

    it('should handle multi-unit: spawn, box select, move in formation', () => {
        for (let i = 0; i < 3; i++) {
            registry.execute({
                type: 'spawn_unit',
                unitType: UnitType.Swordsman1,
                x: 5 + i,
                y: 5,
                player: 0,
                race: Race.Roman,
            });
        }
        expect(state.entities).toHaveLength(3);

        registry.execute({ type: 'select_area', x1: 4, y1: 4, x2: 8, y2: 6 });
        expect(state.selection.selectedEntityIds.size).toBe(3);

        registry.execute({ type: 'move_selected_units', targetX: 15, targetY: 10 });

        for (const entity of state.entities) {
            expect(state.unitStates.get(entity.id)!.path.length).toBeGreaterThan(0);
        }

        const startPositions = state.entities.map(e => ({ x: e.x, y: e.y }));

        for (let i = 0; i < 600; i++) {
            state.movement.update(1 / 30);
        }

        for (let i = 0; i < state.entities.length; i++) {
            const entity = state.entities[i]!;
            const start = startPositions[i]!;
            expect(entity.x !== start.x || entity.y !== start.y).toBe(true);
        }

        for (const entity of state.entities) {
            expect(Math.abs(entity.x - 15)).toBeLessThanOrEqual(4);
            expect(Math.abs(entity.y - 10)).toBeLessThanOrEqual(4);
        }
    });
});

// ── Selection Area, Deselect/Remove & Unselectable ────────────────

describe('Selection Area, Deselect & Unselectable', () => {
    let state: GameState;
    let registry: CommandHandlerRegistry;

    afterEach(() => {
        resetTestGameData();
    });

    beforeEach(() => {
        const harness = createTestHarness();
        state = harness.state;
        registry = harness.registry;
    });

    it('should select units in rectangle, prefer units over buildings, handle reversed coords', () => {
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 7, y: 7 }, 0, { race: Race.Roman });
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 20, y: 20 }, 0, { race: Race.Roman });

        registry.execute({ type: 'select_area', x1: 4, y1: 4, x2: 8, y2: 8 });
        expect(state.selection.selectedEntityIds.size).toBe(2);
    });

    it('should prefer units over buildings in area', () => {
        state.addEntity(EntityType.Building, BuildingType.WoodcutterHut, { x: 10, y: 10 }, 0, { race: Race.Roman });
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 11, y: 10 }, 0, { race: Race.Roman });

        registry.execute({ type: 'select_area', x1: 9, y1: 9, x2: 12, y2: 11 });

        expect(state.selection.selectedEntityIds.size).toBe(1);
        const selectedId = Array.from(state.selection.selectedEntityIds)[0]!;
        expect(state.getEntity(selectedId)!.type).toBe(EntityType.Unit);
    });

    it('should handle reversed coordinates (bottom-right to top-left drag)', () => {
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 7, y: 7 }, 0, { race: Race.Roman });

        registry.execute({ type: 'select_area', x1: 8, y1: 8, x2: 4, y2: 4 });
        expect(state.selection.selectedEntityIds.size).toBe(2);
    });

    it('should clear selection when area is empty', () => {
        const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        state.selection.selectedEntityIds.add(unit.id);
        state.selection.selectedEntityId = unit.id;

        registry.execute({ type: 'select_area', x1: 20, y1: 20, x2: 30, y2: 30 });
        expect(state.selection.selectedEntityIds.size).toBe(0);
        expect(state.selection.selectedEntityId).toBe(null);
    });

    it('should deselect all, clear selection on entity removal, and clean up state', () => {
        const unit = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, { race: Race.Roman });
        state.selection.selectedEntityIds.add(unit.id);
        state.selection.selectedEntityId = unit.id;

        // Deselect all
        registry.execute({ type: 'select', entityId: null });
        expect(state.selection.selectedEntityId).toBe(null);
        expect(state.selection.selectedEntityIds.size).toBe(0);

        // Re-select and remove
        state.selection.selectedEntityIds.add(unit.id);
        state.selection.selectedEntityId = unit.id;

        registry.execute({ type: 'remove_entity', entityId: unit.id });

        expect(state.selection.selectedEntityId).toBe(null);
        expect(state.selection.selectedEntityIds.size).toBe(0);
        expect(state.unitStates.has(unit.id)).toBe(false);
        expect(state.getEntityAt({ x: 5, y: 5 })).toBeUndefined();
    });

    it('should exclude unselectable entities from all selection methods', () => {
        const selectable = state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 5, y: 5 }, 0, {
            race: Race.Roman,
        });
        state.addEntity(EntityType.Unit, UnitType.Carrier, { x: 10, y: 10 }, 0, {
            selectable: false,
            race: Race.Roman,
        });

        // Direct select_at_tile
        registry.execute({ type: 'select_at_tile', x: 10, y: 10, addToSelection: false });
        expect(state.selection.selectedEntityId).toBe(null);

        // Select command
        const unselectableId = state.entities.find(e => e.x === 10)!.id;
        registry.execute({ type: 'select', entityId: unselectableId });
        expect(state.selection.selectedEntityId).toBe(null);

        // Toggle selection
        const toggleResult = registry.execute({ type: 'toggle_selection', entityId: unselectableId });
        expect(toggleResult.success).toBe(false);

        // Shift+click doesn't add unselectable
        registry.execute({ type: 'select_at_tile', x: 5, y: 5, addToSelection: false });
        registry.execute({ type: 'select_at_tile', x: 10, y: 10, addToSelection: true });
        expect(state.selection.selectedEntityIds.size).toBe(1);
        expect(state.selection.selectedEntityIds.has(selectable.id)).toBe(true);

        // Box select excludes unselectable
        state.addEntity(EntityType.Unit, UnitType.Swordsman1, { x: 6, y: 6 }, 0, { race: Race.Roman });
        registry.execute({ type: 'select_area', x1: 4, y1: 4, x2: 11, y2: 11 });
        expect(state.selection.selectedEntityIds.size).toBe(2); // only selectable units
    });
});
