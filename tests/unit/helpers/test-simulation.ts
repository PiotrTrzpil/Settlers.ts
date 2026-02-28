/**
 * Headless simulation harness — runs the full game systems pipeline
 * (buildings, workers, carriers, logistics) without a browser.
 *
 * Uses GameServices (the production composition root) with a synthetic map
 * and ticks all systems in a tight loop.
 *
 * Building placement is fully automatic — callers never specify coordinates.
 * A deterministic grid placer assigns positions in a cluster near map center.
 */

import { installTestGameData, installRealGameData, resetTestGameData } from './test-game-data';
import { createTestMap, type TestMap } from './test-map';
import { EventBus } from '@/game/event-bus';
import { GameState } from '@/game/game-state';
import { GameServices } from '@/game/game-services';
import { executeCommand, type CommandContext } from '@/game/commands';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { MapObjectType } from '@/game/types/map-object-types';
import { GameSettingsManager } from '@/game/game-settings';
import { Race } from '@/game/race';
import { spiralSearch } from '@/game/utils/spiral-search';

// ─── Public interface ───────────────────────────────────────────────

export interface Simulation {
    readonly state: GameState;
    readonly services: GameServices;
    readonly eventBus: EventBus;
    readonly map: TestMap;

    /** Place a building at an auto-chosen location. Returns entity ID. */
    placeBuilding(buildingType: BuildingType, player?: number): number;

    /** Plant N mature trees near a building (within worker search radius). */
    plantTreesNear(buildingId: number, count: number): void;

    /** Plant N mature trees far from a building (outside working area radius). */
    plantTreesFar(buildingId: number, count: number): void;

    /** Place N stone resources near a building (within worker search radius). */
    placeStonesNear(buildingId: number, count: number): void;

    /** Tick all systems once with the given delta-time (seconds). */
    tick(dt: number): void;

    /** Run N ticks at fixed dt. Returns total simulated time (seconds). */
    runTicks(count: number, dt?: number): number;

    /** Run ticks until predicate returns true, or maxTicks reached. Returns simulated seconds elapsed. */
    runUntil(predicate: () => boolean, opts?: { maxTicks?: number; dt?: number }): number;

    /** Get output amount for a material in a building's inventory. */
    getOutput(buildingId: number, material: EMaterialType): number;

    /** Get input amount for a material in a building's inventory. */
    getInput(buildingId: number, material: EMaterialType): number;

    /** Count entities by type (and optionally subType). */
    countEntities(type: EntityType, subType?: number): number;

    /** Tear down all systems and event subscriptions. */
    destroy(): void;
}

// ─── Auto-placer ────────────────────────────────────────────────────

/**
 * Deterministic grid placer: assigns building positions in row-major order
 * near map center. Real building footprints extend up to ±4 tiles X and
 * ±6 tiles Y from the hotspot, so 10-tile spacing is needed to avoid overlap.
 */
class BuildingPlacer {
    private nextSlot = 0;
    private readonly SPACING = 10;
    private readonly COLS = 4;

    constructor(
        private readonly originX: number,
        private readonly originY: number
    ) {}

    next(): { x: number; y: number } {
        const slot = this.nextSlot++;
        const col = slot % this.COLS;
        const row = Math.floor(slot / this.COLS);
        return {
            x: this.originX + col * this.SPACING,
            y: this.originY + row * this.SPACING,
        };
    }
}

export interface SimulationOptions {
    mapWidth?: number;
    mapHeight?: number;
    /** When true, uses minimal stub data instead of real XML. Defaults to false (real data). */
    useStubData?: boolean;
}

// ─── Factory ────────────────────────────────────────────────────────

export function createSimulation(opts: SimulationOptions = {}): Simulation {
    const { mapWidth = 128, mapHeight = 128, useStubData = false } = opts;

    if (useStubData) {
        installTestGameData();
    } else {
        const loaded = installRealGameData();
        if (!loaded) {
            // Fall back to stubs if XML files aren't present
            installTestGameData();
        }
    }

    const map = createTestMap(mapWidth, mapHeight);
    const eventBus = new EventBus();
    const state = new GameState(eventBus);
    const settings = new GameSettingsManager();
    settings.resetToDefaults();

    // Instant building completion + auto-spawn workers/carriers
    settings.state.placeBuildingsCompleted = true;
    settings.state.placeBuildingsWithWorker = true;

    // Lazy command context — resolved after services is assigned
    const cmdContext = (): CommandContext => ({
        state,
        terrain: map.terrain,
        eventBus,
        settings: settings.state,
        settlerTaskSystem: services.settlerTaskSystem,
        buildingStateManager: services.buildingStateManager,
        treeSystem: services.treeSystem,
        cropSystem: services.cropSystem,
        combatSystem: services.combatSystem,
    });

    // GameServices constructor captures executeCommand as a closure.
    // The closure is only invoked during ticks (not construction), so the
    // forward reference to `services` is safe.
    // eslint-disable-next-line prefer-const
    let services: GameServices;
    services = new GameServices(state, eventBus, cmd => executeCommand(cmdContext(), cmd));
    services.setTerrainData(map.terrain);

    // Wire entity:removed to settler task system (mirrors Game constructor)
    eventBus.on('entity:removed', ({ entityId }) => {
        services.settlerTaskSystem.onEntityRemoved(entityId);
    });

    const tickSystems = services.getTickSystems();
    const placer = new BuildingPlacer(30, 30);

    function tick(dt: number) {
        for (const { system } of tickSystems) {
            system.tick(dt);
        }
    }

    function runTicks(count: number, dt = 1 / 30): number {
        for (let i = 0; i < count; i++) tick(dt);
        return count * dt;
    }

    function runUntil(predicate: () => boolean, opts: { maxTicks?: number; dt?: number } = {}): number {
        const { maxTicks = 30_000, dt = 1 / 30 } = opts;
        let elapsed = 0;
        for (let i = 0; i < maxTicks; i++) {
            if (predicate()) return elapsed;
            tick(dt);
            elapsed += dt;
        }
        return elapsed;
    }

    function execute(cmd: Parameters<typeof executeCommand>[1]) {
        return executeCommand(cmdContext(), cmd);
    }

    function placeBuilding(buildingType: BuildingType, player = 0): number {
        const pos = placer.next();
        const result = execute({
            type: 'place_building',
            buildingType,
            x: pos.x,
            y: pos.y,
            player,
            race: Race.Roman,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${BuildingType[buildingType]} at (${pos.x}, ${pos.y}): ${result.error}`);
        }
        return result.effects![0]!.entityId;
    }

    /** Find N empty tiles near a point using spiralSearch, skipping `skipRadius` inner tiles. */
    function findEmptyTiles(cx: number, cy: number, count: number, skipRadius = 2): { x: number; y: number }[] {
        const placed = new Set<string>();
        const results: { x: number; y: number }[] = [];
        for (let i = 0; i < count; i++) {
            const pos = spiralSearch(cx, cy, mapWidth, mapHeight, (x, y) => {
                const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
                return dist >= skipRadius && !state.getEntityAt(x, y) && !placed.has(`${x},${y}`);
            });
            if (!pos) break;
            placed.add(`${pos.x},${pos.y}`);
            results.push(pos);
        }
        return results;
    }

    function plantTreesNear(buildingId: number, count: number) {
        const b = state.getEntityOrThrow(buildingId, 'plantTreesNear');
        for (const pos of findEmptyTiles(b.x, b.y, count)) {
            const tree = state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos.x, pos.y, 0);
            services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
        }
    }

    function plantTreesFar(buildingId: number, count: number) {
        const b = state.getEntityOrThrow(buildingId, 'plantTreesFar');
        // Place trees beyond working area radius (20) so workers can't reach them
        for (const pos of findEmptyTiles(b.x, b.y, count, 25)) {
            const tree = state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos.x, pos.y, 0);
            services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
        }
    }

    function placeStonesNear(buildingId: number, count: number) {
        const b = state.getEntityOrThrow(buildingId, 'placeStonesNear');
        for (const pos of findEmptyTiles(b.x, b.y, count, 3)) {
            const stone = state.addEntity(EntityType.MapObject, MapObjectType.ResourceStone, pos.x, pos.y, 0);
            services.stoneSystem.register(stone.id, MapObjectType.ResourceStone);
        }
    }

    function getOutput(buildingId: number, material: EMaterialType): number {
        return services.inventoryManager.getOutputAmount(buildingId, material);
    }

    function getInput(buildingId: number, material: EMaterialType): number {
        return services.inventoryManager.getInputAmount(buildingId, material);
    }

    function countEntities(type: EntityType, subType?: number): number {
        return state.entities.filter(e => e.type === type && (subType === undefined || e.subType === subType)).length;
    }

    function destroy() {
        services.destroy();
    }

    return {
        state,
        services,
        eventBus,
        map,
        placeBuilding,
        plantTreesNear,
        plantTreesFar,
        placeStonesNear,
        tick,
        runTicks,
        runUntil,
        getOutput,
        getInput,
        countEntities,
        destroy,
    };
}

/** Clean up game data singleton after tests. Call in afterEach. */
export function cleanupSimulation(): void {
    resetTestGameData();
}
