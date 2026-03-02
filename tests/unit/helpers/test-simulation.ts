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
import { createTestMap, TERRAIN, type TestMap } from './test-map';
import { EventBus, type GameEvents } from '@/game/event-bus';
import { GameState } from '@/game/game-state';
import { GameServices } from '@/game/game-services';
import { executeCommand, type CommandContext } from '@/game/commands';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType, type TileCoord } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { MapObjectType } from '@/game/types/map-object-types';
import { GameSettingsManager } from '@/game/game-settings';
import { Race } from '@/game/race';
import { spiralSearch } from '@/game/utils/spiral-search';
import { OreType } from '@/game/features/ore-veins/ore-type';
import { isMineBuilding, getBuildingFootprint } from '@/game/buildings/types';
import type { Entity } from '@/game/entity';

/** An error captured during simulation ticking. */
export interface SimulationError {
    tick: number;
    system: string;
    error: Error;
}

// ─── Auto-placer ────────────────────────────────────────────────────

/**
 * Deterministic grid placer: assigns building positions in row-major order
 * near map center. Real building footprints extend up to ±4 tiles X and
 * ±6 tiles Y from the hotspot, so 10-tile spacing is needed to avoid overlap.
 */
class BuildingPlacer {
    private nextSlot = 0;
    private readonly COLS = 4;

    constructor(
        private readonly originX: number,
        private readonly originY: number,
        private readonly spacing = 10
    ) {}

    next(): { x: number; y: number } {
        const slot = this.nextSlot++;
        const col = slot % this.COLS;
        const row = Math.floor(slot / this.COLS);
        return {
            x: this.originX + col * this.spacing,
            y: this.originY + row * this.spacing,
        };
    }
}

export interface SimulationOptions {
    mapWidth?: number;
    mapHeight?: number;
    /** Grid spacing between auto-placed buildings (default 10). Increase for large footprints. */
    buildingSpacing?: number;
    /** When true, uses minimal stub data instead of real XML. Defaults to false (real data). */
    useStubData?: boolean;
}

// ─── Simulation class ────────────────────────────────────────────────

export class Simulation {
    readonly state: GameState;
    readonly services: GameServices;
    readonly eventBus: EventBus;
    readonly map: TestMap;
    readonly errors: SimulationError[] = [];
    readonly mapWidth: number;
    readonly mapHeight: number;

    private readonly tickSystems: ReturnType<GameServices['getTickSystems']>;
    private readonly placer: BuildingPlacer;
    private readonly cmdContext: () => CommandContext;
    private tickCount = 0;

    constructor(opts: SimulationOptions = {}) {
        const { mapWidth = 128, mapHeight = 128, buildingSpacing, useStubData = false } = opts;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;

        if (useStubData) {
            installTestGameData();
        } else {
            const loaded = installRealGameData();
            if (!loaded) {
                installTestGameData();
            }
        }

        this.map = createTestMap(mapWidth, mapHeight);
        this.eventBus = new EventBus();
        this.state = new GameState(this.eventBus);
        const settings = new GameSettingsManager();
        settings.resetToDefaults();

        this.cmdContext = (): CommandContext => ({
            state: this.state,
            terrain: this.map.terrain,
            eventBus: this.eventBus,
            settings: settings.state,
            settlerTaskSystem: this.services.settlerTaskSystem,
            constructionSiteManager: this.services.constructionSiteManager,
            treeSystem: this.services.treeSystem,
            cropSystem: this.services.cropSystem,
            combatSystem: this.services.combatSystem,
            productionControlManager: this.services.productionControlManager,
        });

        this.services = new GameServices(this.state, this.eventBus, cmd => executeCommand(this.cmdContext(), cmd));
        this.services.setTerrainData(this.map.terrain);

        this.services.logisticsDispatcher.globalLogistics = true;
        this.services.residenceSpawner.immediateMode = true;

        this.eventBus.on('entity:removed', ({ entityId }) => {
            this.services.settlerTaskSystem.onEntityRemoved(entityId);
        });

        this.tickSystems = this.services.getTickSystems();
        this.placer = new BuildingPlacer(30, 30, buildingSpacing);
    }

    tick(dt: number) {
        this.tickCount++;
        for (const { system, group } of this.tickSystems) {
            try {
                system.tick(dt);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.errors.push({ tick: this.tickCount, system: group, error: err });
            }
        }
    }

    runTicks(count: number, dt = 1 / 30): number {
        for (let i = 0; i < count; i++) this.tick(dt);
        return count * dt;
    }

    runUntil(predicate: () => boolean, opts: { maxTicks?: number; dt?: number } = {}): number {
        const { maxTicks = 30_000, dt = 1 / 30 } = opts;
        const errorsBefore = this.errors.length;
        let elapsed = 0;
        for (let i = 0; i < maxTicks; i++) {
            if (predicate()) return elapsed;
            this.tick(dt);
            elapsed += dt;
        }
        // Dump errors that occurred during this run
        if (this.errors.length > errorsBefore) {
            const newErrors = this.errors.slice(errorsBefore);
            const unique = new Map<string, { count: number; tick: number; system: string }>();
            for (const e of newErrors) {
                const key = e.error.message;
                const existing = unique.get(key);
                if (existing) {
                    existing.count++;
                } else {
                    unique.set(key, { count: 1, tick: e.tick, system: e.system });
                }
            }
            console.log(`\n[Simulation] ${newErrors.length} error(s) during runUntil (${unique.size} unique):`);
            for (const [msg, info] of unique) {
                console.log(`  [tick ${info.tick}, ${info.system}] (×${info.count}) ${msg}`);
            }
        }
        return elapsed;
    }

    execute(cmd: Parameters<typeof executeCommand>[1]) {
        return executeCommand(this.cmdContext(), cmd);
    }

    placeBuilding(buildingType: BuildingType, player = 0, completed = true): number {
        const pos = this.placer.next();
        const result = this.execute({
            type: 'place_building',
            buildingType,
            x: pos.x,
            y: pos.y,
            player,
            race: Race.Roman,
            completed,
            spawnWorker: completed,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${BuildingType[buildingType]} at (${pos.x}, ${pos.y}): ${result.error}`);
        }
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    placeGoods(material: EMaterialType, amount: number): number {
        const pos = this.placer.next();
        const result = this.execute({
            type: 'place_resource',
            materialType: material,
            amount,
            x: pos.x,
            y: pos.y,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${EMaterialType[material]} at (${pos.x}, ${pos.y}): ${result.error}`);
        }
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    placeGoodsNear(buildingId: number, material: EMaterialType, amount: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'placeGoodsNear');
        const skip = this.footprintRadius(b) + 1;
        const tiles = this.findEmptyTiles(b.x, b.y, 1, skip);
        if (tiles.length === 0) throw new Error(`No empty tile near building ${buildingId}`);
        const pos = tiles[0]!;
        const result = this.execute({
            type: 'place_resource',
            materialType: material,
            amount,
            x: pos.x,
            y: pos.y,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${EMaterialType[material]} near building ${buildingId}: ${result.error}`);
        }
    }

    /** Chebyshev radius of a building's footprint from its anchor. */
    private footprintRadius(b: Entity): number {
        try {
            const fp = getBuildingFootprint(b.x, b.y, b.subType as BuildingType, b.race);
            return Math.max(...fp.map(t => Math.max(Math.abs(t.x - b.x), Math.abs(t.y - b.y))));
        } catch {
            return 2; // fallback for buildings without footprint data
        }
    }

    /** Find N empty tiles near a point using spiralSearch, skipping `skipRadius` inner tiles. */
    private findEmptyTiles(cx: number, cy: number, count: number, skipRadius = 2): { x: number; y: number }[] {
        const placed = new Set<string>();
        const results: { x: number; y: number }[] = [];
        for (let i = 0; i < count; i++) {
            const pos = spiralSearch(cx, cy, this.mapWidth, this.mapHeight, (x, y) => {
                const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
                return dist >= skipRadius && !this.state.getEntityAt(x, y) && !placed.has(`${x},${y}`);
            });
            if (!pos) break;
            placed.add(`${pos.x},${pos.y}`);
            results.push(pos);
        }
        return results;
    }

    plantTreesNear(buildingId: number, count: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'plantTreesNear');
        const skip = this.footprintRadius(b) + 1;
        for (const pos of this.findEmptyTiles(b.x, b.y, count, skip)) {
            const tree = this.state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos.x, pos.y, 0);
            this.services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
        }
    }

    plantTreesFar(buildingId: number, count: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'plantTreesFar');
        // Place trees beyond working area radius (20) so workers can't reach them
        for (const pos of this.findEmptyTiles(b.x, b.y, count, 25)) {
            const tree = this.state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos.x, pos.y, 0);
            this.services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
        }
    }

    placeRiverNear(buildingId: number, count: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'placeRiverNear');
        const skip = this.footprintRadius(b) + 1;
        for (const pos of this.findEmptyTiles(b.x, b.y, count, skip)) {
            this.map.groundType[this.map.mapSize.toIndex(pos.x, pos.y)] = TERRAIN.RIVER_MIN;
        }
    }

    placeStonesNear(buildingId: number, count: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'placeStonesNear');
        const skip = this.footprintRadius(b) + 1;
        for (const pos of this.findEmptyTiles(b.x, b.y, count, skip)) {
            const stone = this.state.addEntity(EntityType.MapObject, MapObjectType.ResourceStone, pos.x, pos.y, 0);
            this.services.stoneSystem.register(stone.id, MapObjectType.ResourceStone);
        }
    }

    placeStonesFar(buildingId: number, count: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'placeStonesFar');
        for (const pos of this.findEmptyTiles(b.x, b.y, count, 25)) {
            const stone = this.state.addEntity(EntityType.MapObject, MapObjectType.ResourceStone, pos.x, pos.y, 0);
            this.services.stoneSystem.register(stone.id, MapObjectType.ResourceStone);
        }
    }

    private fillRockSquare(cx: number, cy: number, radius: number): void {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const tx = cx + dx;
                const ty = cy + dy;
                if (tx >= 0 && tx < this.mapWidth && ty >= 0 && ty < this.mapHeight) {
                    this.map.groundType[this.map.mapSize.toIndex(tx, ty)] = TERRAIN.ROCK;
                }
            }
        }
    }

    private fillOreSquare(cx: number, cy: number, radius: number, oreType: OreType, oreLevel: number): void {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const tx = cx + dx;
                const ty = cy + dy;
                if (tx >= 0 && tx < this.mapWidth && ty >= 0 && ty < this.mapHeight) {
                    this.services.oreVeinData.setOre(tx, ty, oreType, oreLevel);
                }
            }
        }
    }

    /**
     * Place a mine building: sets a region to ROCK terrain, places the building,
     * then sets ore veins of the given type around the building (within MINE_SEARCH_RADIUS=4).
     */
    placeMineBuilding(buildingType: BuildingType, oreType: OreType, oreLevel = 3): number {
        if (!isMineBuilding(buildingType)) {
            throw new Error(`${BuildingType[buildingType]} is not a mine building`);
        }
        const pos = this.placer.next();
        this.fillRockSquare(pos.x, pos.y, 6); // radius 6 covers footprint + ore search radius

        const result = this.execute({
            type: 'place_building',
            buildingType,
            x: pos.x,
            y: pos.y,
            player: 0,
            race: Race.Roman,
        });
        if (!result.success) {
            throw new Error(
                `Failed to place mine ${BuildingType[buildingType]} at (${pos.x}, ${pos.y}): ${result.error}`
            );
        }
        const entityId = (result.effects![0]! as { entityId: number }).entityId;

        this.fillOreSquare(pos.x, pos.y, 4, oreType, oreLevel); // radius 4 = MINE_SEARCH_RADIUS
        return entityId;
    }

    spawnUnit(x: number, y: number, unitType = UnitType.Carrier, player = 0): number {
        const result = this.execute({
            type: 'spawn_unit',
            unitType,
            x,
            y,
            player,
            race: Race.Roman,
        });
        if (!result.success) {
            throw new Error(`Failed to spawn ${UnitType[unitType]} at (${x}, ${y}): ${result.error}`);
        }
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    spawnUnitNear(buildingId: number, unitType: UnitType, count = 1, player = 0): number[] {
        const b = this.state.getEntityOrThrow(buildingId, 'spawnUnitNear');
        const skip = this.footprintRadius(b) + 1;
        const ids: number[] = [];
        for (const pos of this.findEmptyTiles(b.x, b.y, count, skip)) {
            ids.push(this.spawnUnit(pos.x, pos.y, unitType, player));
        }
        return ids;
    }

    moveUnit(entityId: number, targetX: number, targetY: number): boolean {
        return this.state.movement.moveUnit(entityId, targetX, targetY);
    }

    simulateMovement(entityId: number, opts: { maxTicks?: number; target?: TileCoord } = {}): TileCoord[] {
        const { maxTicks = 600, target } = opts;
        const entity = this.state.getEntityOrThrow(entityId, 'simulateMovement');
        const unitState = this.state.unitStates.get(entityId)!;
        const visited: TileCoord[] = [{ x: entity.x, y: entity.y }];
        const dt = 1 / 30;

        for (let i = 0; i < maxTicks; i++) {
            this.tick(dt);
            const last = visited[visited.length - 1]!;
            if (entity.x !== last.x || entity.y !== last.y) {
                visited.push({ x: entity.x, y: entity.y });
            }
            if (target) {
                // Keep going until entity reaches the exact target tile
                if (entity.x === target.x && entity.y === target.y) break;
            } else {
                if (unitState.path.length === 0 && unitState.moveProgress === 0 && visited.length > 1) break;
            }
        }
        return visited;
    }

    injectInput(buildingId: number, material: EMaterialType, amount: number) {
        this.services.inventoryManager.depositInput(buildingId, material, amount);
    }

    injectOutput(buildingId: number, material: EMaterialType, amount: number) {
        this.services.inventoryManager.depositOutput(buildingId, material, amount);
    }

    getOutput(buildingId: number, material: EMaterialType): number {
        return this.services.inventoryManager.getOutputAmount(buildingId, material);
    }

    getInput(buildingId: number, material: EMaterialType): number {
        return this.services.inventoryManager.getInputAmount(buildingId, material);
    }

    countEntities(type: EntityType, subType?: number): number {
        return this.state.entities.filter(e => e.type === type && (subType === undefined || e.subType === subType))
            .length;
    }

    logEvents(...events: (keyof GameEvents | '*')[]) {
        if (events.includes('*')) {
            // Subscribe to all events by proxying emit
            const origEmit = this.eventBus.emit.bind(this.eventBus);
            this.eventBus.emit = ((event: string, payload: unknown) => {
                console.log(`[event] ${event}`, JSON.stringify(payload));
                return origEmit(event as keyof GameEvents, payload as GameEvents[keyof GameEvents]);
            }) as typeof this.eventBus.emit;
        } else {
            for (const event of events as (keyof GameEvents)[]) {
                this.eventBus.on(event, payload => {
                    console.log(`[event] ${event}`, JSON.stringify(payload));
                });
            }
        }
    }

    destroy() {
        this.services.destroy();
    }
}

export function createSimulation(opts: SimulationOptions = {}): Simulation {
    return new Simulation(opts);
}

/** Clean up game data singleton after tests. Call in afterEach. */
export function cleanupSimulation(): void {
    resetTestGameData();
}
