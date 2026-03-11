/**
 * Headless simulation harness — runs the full game systems pipeline
 * (buildings, workers, carriers, logistics) without a browser.
 *
 * Uses GameServices (the production composition root) with a synthetic map
 * and ticks all systems in a tight loop.
 *
 * Building placement is fully automatic — callers never specify coordinates.
 * A smart placer clusters buildings tightly near map center using real
 * footprint validation (each new building is placed adjacent to existing ones).
 *
 * ═══════════════════════════════════════════════════════════════════
 *  DIAGNOSTICS (for AI-assisted workflow)
 * ═══════════════════════════════════════════════════════════════════
 *
 * The simulation records a structured timeline of all game events.
 * On runUntil() timeout, it auto-dumps:
 *   1. Last 50 timeline entries (causal narrative of what happened)
 *   2. World snapshot (entity counts, inventories, carrier states)
 *   3. Simulation errors (deduplicated by message)
 *
 * This gives an AI agent enough context to diagnose failures from
 * a single test run — no interactive debugging needed.
 *
 * SCENARIO BUILDERS
 * ─────────────────
 * See test-scenarios.ts for pre-configured simulation setups (createScenario).
 */

import { onTestFinished } from 'vitest';
import { installTestGameData, installRealGameData, resetTestGameData } from './test-game-data';
import { createTestMap, TERRAIN, type TestMap } from './test-map';
import { TimelineRecorder } from './timeline-recorder';
import { wireSimulationTimeline, formatSlots } from './simulation-timeline';
import { EventBus, type GameEvents } from '@/game/event-bus';
import { GameState } from '@/game/game-state';
import { GameServices } from '@/game/game-services';
import { CommandHandlerRegistry, registerAllHandlers } from '@/game/commands';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType, tileKey, type TileCoord } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';
import { MapObjectType } from '@/game/types/map-object-types';
import { GameSettingsManager } from '@/game/game-settings';
import { Race } from '@/game/core/race';
import { spiralSearch } from '@/game/utils/spiral-search';
import { OreType } from '@/game/features/ore-veins/ore-type';
import { isMineBuilding, getBuildingFootprint } from '@/game/buildings/types';
import { canPlaceBuildingFootprint } from '@/game/systems/placement';
import { populateMapBuildings } from '@/game/features/building-construction';
import { populateMapSettlers } from '@/game/systems/map-settlers';
import type { MapBuildingData, MapSettlerData } from '@/resources/map/map-entity-data';
import { BuildingConstructionPhase } from '@/game/features/building-construction/types';
import type { Entity } from '@/game/entity';
import { query } from '@/game/ecs';

// ─── Types ───────────────────────────────────────────────────────

/** An error captured during simulation ticking. */
export interface SimulationError {
    tick: number;
    system: string;
    error: Error;
}

/** Compact snapshot of a building's inventory for diagnostics. */
export interface BuildingSnapshot {
    id: number;
    type: string;
    inputs: string;
    outputs: string;
}

/** Compact snapshot of a carrier for diagnostics. */
export interface CarrierSnapshot {
    id: number;
    status: string;
    pos: string;
    carrying: string;
}

/** Full simulation state snapshot for diagnostics. */
export interface SimSnapshot {
    tick: number;
    entityCounts: Record<string, number>;
    buildings: BuildingSnapshot[];
    carriers: CarrierSnapshot[];
    errorCount: number;
}

export interface RunUntilOptions {
    maxTicks?: number;
    dt?: number;
    /** Human-readable label for what we're waiting for. */
    label?: string;
    /** Called on timeout — return a diagnostic string with domain-specific context. */
    diagnose?: () => string;
}

// ─── Auto-placer ────────────────────────────────────────────────────

/**
 * Building placer: spiral from map center, use the real placement
 * validator (terrain + occupancy + 1-tile footprint gap).
 *
 * No approximations — the validator guarantees legal placement.
 */
class SmartBuildingPlacer {
    private readonly centerX: number;
    private readonly centerY: number;

    constructor(
        private readonly state: GameState,
        private readonly terrain: import('@/game/terrain').TerrainData,
        private readonly mapWidth: number,
        private readonly mapHeight: number
    ) {
        this.centerX = Math.floor(mapWidth / 2);
        this.centerY = Math.floor(mapHeight / 2);
    }

    /** Find the closest valid position to center. */
    findBuildingPosition(buildingType: BuildingType, race = Race.Roman): { x: number; y: number } {
        const result = spiralSearch(this.centerX, this.centerY, this.mapWidth, this.mapHeight, (x, y) => {
            if (
                !canPlaceBuildingFootprint(
                    this.terrain,
                    this.state.groundOccupancy,
                    x,
                    y,
                    buildingType,
                    race,
                    this.state.buildingFootprint
                )
            )
                return false;
            // In tests, buildings are often placed as instantly completed.
            // Avoid footprint tiles occupied by units to prevent trapping them.
            const fp = getBuildingFootprint(x, y, buildingType, race);
            return fp.every(t => !this.state.unitOccupancy.has(tileKey(t.x, t.y)));
        });
        if (!result) throw new Error(`SmartBuildingPlacer: no valid position for ${BuildingType[buildingType]}`);
        return result;
    }

    /** Find any non-occupied tile near center (for goods piles). */
    findOpenPosition(): { x: number; y: number } {
        const result = spiralSearch(
            this.centerX,
            this.centerY,
            this.mapWidth,
            this.mapHeight,
            (x, y) => !this.state.groundOccupancy.has(tileKey(x, y)) && !this.state.unitOccupancy.has(tileKey(x, y))
        );
        if (!result) throw new Error('SmartBuildingPlacer: no open position found');
        return result;
    }

    /** Find a position with enough clearance for a mine. */
    findMinePosition(clearance = 8): { x: number; y: number } {
        const result = spiralSearch(this.centerX, this.centerY, this.mapWidth, this.mapHeight, (x, y) => {
            if (x - clearance < 0 || x + clearance >= this.mapWidth) return false;
            if (y - clearance < 0 || y + clearance >= this.mapHeight) return false;
            for (let dy = -clearance; dy <= clearance; dy++) {
                for (let dx = -clearance; dx <= clearance; dx++) {
                    const k = tileKey(x + dx, y + dy);
                    if (this.state.groundOccupancy.has(k) || this.state.unitOccupancy.has(k)) return false;
                }
            }
            return true;
        });
        if (!result) throw new Error('SmartBuildingPlacer: no mine position found');
        return result;
    }
}

export interface SimulationOptions {
    mapWidth?: number;
    mapHeight?: number;
    /** When true, uses minimal stub data instead of real XML. Defaults to false (real data). */
    useStubData?: boolean;
    /** Race for player 0 (defaults to Roman). */
    race?: Race;
}

// ─── Invariant checking ─────────────────────────────────────────

const INVARIANT_CHECK_INTERVAL = 30; // every ~1 simulated second

/** Auto-incrementing counter for unique test IDs within a run. */
let simulationCounter = 0;

// ─── Simulation class ────────────────────────────────────────────────

export class Simulation {
    readonly state: GameState;
    readonly services: GameServices;
    readonly eventBus: EventBus;
    readonly map: TestMap;
    readonly errors: SimulationError[] = [];
    readonly timeline: TimelineRecorder;
    readonly mapWidth: number;
    readonly mapHeight: number;
    readonly testId: string;

    private readonly tickSystems: ReturnType<GameServices['getTickSystems']>;
    private readonly placer: SmartBuildingPlacer;
    private readonly commandRegistry: CommandHandlerRegistry;
    private tickCount = 0;

    constructor(opts: SimulationOptions = {}) {
        const { mapWidth = 128, mapHeight = 128, useStubData = false, race = Race.Roman } = opts;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.testId = `sim_${++simulationCounter}_${Date.now()}`;
        this.timeline = new TimelineRecorder(this.testId);

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
        this.eventBus.strict = true;
        this.state = new GameState(this.eventBus);
        this.state.playerRaces = new Map([
            [0, race],
            [1, Race.Roman],
        ]);

        // Subscribe timeline FIRST — before any other system registers handlers,
        // so every event is captured from the very first entity placement.
        wireSimulationTimeline(this.eventBus, this.timeline, () => this.tickCount);

        const settings = new GameSettingsManager();
        settings.resetToDefaults();

        this.commandRegistry = new CommandHandlerRegistry();
        this.services = new GameServices(this.state, this.eventBus, cmd => this.commandRegistry.execute(cmd));
        this.services.setTerrainData(this.map.terrain);

        // Register feature-provided command handlers first, then central handlers
        for (const [type, handler] of this.services.getFeatureCommandHandlers()) {
            this.commandRegistry.register(type, handler);
        }
        registerAllHandlers(this.commandRegistry, {
            state: this.state,
            terrain: this.map.terrain,
            eventBus: this.eventBus,
            settings: settings.state,
            settlerTaskSystem: this.services.settlerTaskSystem,
            constructionSiteManager: this.services.constructionSiteManager,
            combatSystem: this.services.combatSystem,
            storageFilterManager: this.services.storageFilterManager,
            inventoryManager: this.services.inventoryManager,
            unitReservation: this.services.unitReservation,
            recruitSystem: this.services.recruitSystem,
            unitTransformer: this.services.unitTransformer,
            getPlacementFilter: () => null,
        });

        this.services.residenceSpawner.immediateMode = true;

        // Establish territory for player 0 covering the entire test map.
        // Workers use the spatial grid's territory-aware queries, so they need
        // their tiles to be inside territory to find resources.
        this.establishTerritory(0);

        this.eventBus.on('entity:removed', ({ entityId }) => {
            this.services.settlerTaskSystem.onEntityRemoved(entityId);
        });

        this.tickSystems = this.services.getTickSystems();
        this.placer = new SmartBuildingPlacer(this.state, this.map.terrain, mapWidth, mapHeight);

        // Always enable verbose subsystems — all data goes to timeline DB.
        this.state.movement.verbose = true;
        this.services.settlerTaskSystem.verbose = true;

        // Finalize timeline DB record after test completes.
        // Vitest hook order: afterEach → onTestFinished → onTestFailed.
        // ctx.task.result.state is 'pass' | 'fail' at this point.
        onTestFinished(ctx => {
            const failed = ctx.task.result?.state === 'fail' || this.errors.length > 0;
            this.timeline.finalize(failed ? 'failed' : 'passed', this.tickCount, this.errors.length);
            this.timeline.close();
        });
    }

    // ─── Tick & run ───────────────────────────────────────────────

    tick(dt: number) {
        this.tickCount++;
        for (const { system, group } of this.tickSystems) {
            try {
                system.tick(dt);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.errors.push({ tick: this.tickCount, system: group, error: err });
                this.timeline.record({ tick: this.tickCount, category: 'error', event: group, detail: err.message });
            }
        }
        if (this.tickCount % INVARIANT_CHECK_INTERVAL === 0) {
            this.checkInvariants();
        }
    }

    runTicks(count: number, dt = 1 / 30): number {
        for (let i = 0; i < count; i++) this.tick(dt);
        return count * dt;
    }

    runUntil(predicate: () => boolean, opts: RunUntilOptions = {}): number {
        const { maxTicks = 30_000, dt = 1 / 30 } = opts;
        const errorsBefore = this.errors.length;
        let elapsed = 0;
        for (let i = 0; i < maxTicks; i++) {
            if (predicate()) return elapsed;
            this.tick(dt);
            elapsed += dt;
        }

        this.dumpTimeoutDiagnostics(opts, maxTicks, errorsBefore);
        return elapsed;
    }

    /** On runUntil timeout, print header + hint to query the timeline DB. */
    private dumpTimeoutDiagnostics(opts: RunUntilOptions, maxTicks: number, _errorsBefore: number) {
        const label = opts.label ?? 'predicate';
        const header = `TIMEOUT: "${label}" not reached in ${maxTicks} ticks`;
        const extra = opts.diagnose ? `\n  [Diagnosis] ${opts.diagnose()}` : '';
        console.log(`\n  ${header}${extra}`);
    }

    // ─── Snapshot ─────────────────────────────────────────────────

    /** Capture a compact snapshot of the simulation state for diagnostics. */
    snapshot(): SimSnapshot {
        const entityCounts: Record<string, number> = {};
        for (const e of this.state.entities) {
            const key = EntityType[e.type] ?? `Unknown(${e.type})`;
            entityCounts[key] = (entityCounts[key] ?? 0) + 1;
        }

        const buildings = this.snapshotBuildings();
        const carriers = this.snapshotCarriers();

        return {
            tick: this.tickCount,
            entityCounts,
            buildings,
            carriers,
            errorCount: this.errors.length,
        };
    }

    private snapshotBuildings(): BuildingSnapshot[] {
        const buildings: BuildingSnapshot[] = [];
        for (const inv of this.services.inventoryManager.getAllInventories()) {
            const inputs = formatSlots(inv.inputSlots);
            const outputs = formatSlots(inv.outputSlots);
            buildings.push({
                id: inv.buildingId,
                type: BuildingType[inv.buildingType] ?? `Unknown(${inv.buildingType})`,
                inputs: inputs ? `in[${inputs}]` : '',
                outputs: outputs ? `out[${outputs}]` : '',
            });
        }
        return buildings;
    }

    private snapshotCarriers(): CarrierSnapshot[] {
        const carriers: CarrierSnapshot[] = [];
        for (const [id, , entity] of query(this.services.carrierRegistry.store, this.state.store)) {
            const pos = `(${entity.x},${entity.y})`;
            const carrying = entity.carrying
                ? `${EMaterialType[entity.carrying.material]}×${entity.carrying.amount}`
                : '';
            carriers.push({ id, status: 'registered', pos, carrying });
        }
        return carriers;
    }

    // ─── Invariant monitors ───────────────────────────────────────

    private checkInvariants() {
        this.checkEntityBounds();
        this.checkInventoryIntegrity();
    }

    private checkEntityBounds() {
        for (const e of this.state.entities) {
            if (e.x < 0 || e.y < 0 || e.x >= this.mapWidth || e.y >= this.mapHeight) {
                let typeName: string = EntityType[e.type] ?? 'Unknown';
                if (e.type === EntityType.Unit) typeName = UnitType[e.subType] ?? 'Unknown';
                else if (e.type === EntityType.Building) typeName = BuildingType[e.subType] ?? 'Unknown';
                this.recordInvariantViolation(
                    `${EntityType[e.type]} #${e.id} (${typeName}) out of bounds at (${e.x},${e.y})`
                );
            }
        }
    }

    private checkInventoryIntegrity() {
        for (const inv of this.services.inventoryManager.getAllInventories()) {
            for (const slot of [...inv.inputSlots, ...inv.outputSlots]) {
                if (slot.currentAmount < 0) {
                    this.recordInvariantViolation(
                        `Building #${inv.buildingId} (${BuildingType[inv.buildingType]}) ` +
                            `has negative ${EMaterialType[slot.materialType]}: ${slot.currentAmount}`
                    );
                }
            }
        }
    }

    private recordInvariantViolation(message: string) {
        this.errors.push({
            tick: this.tickCount,
            system: 'invariant',
            error: new Error(message),
        });
    }

    // ─── Commands ─────────────────────────────────────────────────

    execute(cmd: import('@/game/commands').Command) {
        return this.commandRegistry.execute(cmd);
    }

    /** Remove a building entity. Throws if the command fails. */
    removeBuilding(buildingId: number): void {
        const result = this.execute({ type: 'remove_entity', entityId: buildingId });
        if (!result.success) {
            throw new Error(`Failed to remove building ${buildingId}: ${result.error}`);
        }
    }

    /**
     * Run until a construction site reaches the given phase (or is removed).
     * Returns the site if it still exists, or undefined if removed before reaching the phase.
     */
    waitForPhase(
        buildingId: number,
        phase: BuildingConstructionPhase,
        maxTicks = 50_000
    ): ReturnType<GameServices['constructionSiteManager']['getSite']> {
        this.runUntil(
            () => {
                const s = this.services.constructionSiteManager.getSite(buildingId);
                return !s || s.phase >= phase;
            },
            { maxTicks, label: `phase ≥ ${BuildingConstructionPhase[phase]}` }
        );
        return this.services.constructionSiteManager.getSite(buildingId);
    }

    /** Run until a construction site is fully complete (site record removed). */
    waitForConstructionComplete(buildingId: number, maxTicks = 50_000): void {
        this.runUntil(() => !this.services.constructionSiteManager.hasSite(buildingId), {
            maxTicks,
            label: 'construction complete',
        });
    }

    // ─── Building placement ───────────────────────────────────────

    placeBuilding(
        buildingType: BuildingType,
        player = 0,
        completed = true,
        race?: Race,
        spawnWorker?: boolean
    ): number {
        const r = race ?? this.state.playerRaces.get(player) ?? Race.Roman;
        const pos = this.placer.findBuildingPosition(buildingType, r);
        return this.placeBuildingAt(pos.x, pos.y, buildingType, player, completed, r, spawnWorker);
    }

    /** Place a building at explicit coordinates (bypasses auto-placer). */
    placeBuildingAt(
        x: number,
        y: number,
        buildingType: BuildingType,
        player = 0,
        completed = true,
        race = Race.Roman,
        spawnWorker?: boolean
    ): number {
        const result = this.execute({
            type: 'place_building',
            buildingType,
            x,
            y,
            player,
            race,
            completed,
            spawnWorker: spawnWorker ?? completed,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${BuildingType[buildingType]} at (${x}, ${y}): ${result.error}`);
        }
        return this.resultEntityId(result);
    }

    placeGoods(material: EMaterialType, amount: number): number {
        if (amount > 8) throw new Error(`placeGoods: amount ${amount} exceeds max pile size of 8`);
        const pos = this.placer.findOpenPosition();
        const result = this.execute({
            type: 'place_pile',
            materialType: material,
            amount,
            x: pos.x,
            y: pos.y,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${EMaterialType[material]} at (${pos.x}, ${pos.y}): ${result.error}`);
        }
        return this.resultEntityId(result);
    }

    placeGoodsAt(x: number, y: number, material: EMaterialType, amount: number): number {
        if (amount > 8) throw new Error(`placeGoodsAt: amount ${amount} exceeds max pile size of 8`);
        const result = this.execute({
            type: 'place_pile',
            materialType: material,
            amount,
            x,
            y,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${EMaterialType[material]} at (${x}, ${y}): ${result.error}`);
        }
        return this.resultEntityId(result);
    }

    placeGoodsNear(buildingId: number, material: EMaterialType, amount: number) {
        if (amount > 8) throw new Error(`placeGoodsNear: amount ${amount} exceeds max pile size of 8`);
        const tiles = this.tilesNearBuilding(buildingId, 1);
        if (tiles.length === 0) throw new Error(`No empty tile near building ${buildingId}`);
        const pos = tiles[0]!;
        const result = this.execute({
            type: 'place_pile',
            materialType: material,
            amount,
            x: pos.x,
            y: pos.y,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${EMaterialType[material]} near building ${buildingId}: ${result.error}`);
        }
    }

    // ─── Map-data population (real map-load pipeline) ─────────────

    /**
     * Populate buildings and settlers from raw map entity data arrays, using
     * the same code paths as the real Game.populateMapEntities.
     *
     * Buildings are created via populateMapBuildings (no worker auto-spawn).
     * Settlers are created via populateMapSettlers (placed on building footprints when applicable).
     * Finally, assignInitialBuildingWorkers matches workers to their buildings.
     */
    populateMapData(
        buildings: MapBuildingData[],
        settlers: MapSettlerData[]
    ): { buildingCount: number; settlerCount: number } {
        const buildingCount = populateMapBuildings(this.state, buildings, {
            eventBus: this.eventBus,
            terrain: this.map.terrain,
        });
        const settlerCount = populateMapSettlers(this.state, settlers, this.eventBus);
        this.services.settlerTaskSystem.assignInitialBuildingWorkers();
        return { buildingCount, settlerCount };
    }

    // ─── Map object placement ─────────────────────────────────────

    plantTreesNear(buildingId: number, count: number) {
        this.placeTreeEntities(this.tilesNearBuilding(buildingId, count));
    }

    plantTreesFar(buildingId: number, count: number) {
        this.placeTreeEntities(this.tilesNearBuilding(buildingId, count, true));
    }

    placeRiverNear(buildingId: number, count: number) {
        for (const pos of this.tilesNearBuilding(buildingId, count)) {
            this.map.groundType[this.map.mapSize.toIndex(pos.x, pos.y)] = TERRAIN.RIVER_MIN;
        }
    }

    placeStonesNear(buildingId: number, count: number) {
        this.placeStoneEntities(this.tilesNearBuilding(buildingId, count));
    }

    placeStonesFar(buildingId: number, count: number) {
        this.placeStoneEntities(this.tilesNearBuilding(buildingId, count, true));
    }

    private placeTreeEntities(tiles: { x: number; y: number }[]) {
        for (const pos of tiles) {
            const tree = this.state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos.x, pos.y, 0);
            this.services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
        }
    }

    private placeStoneEntities(tiles: { x: number; y: number }[]) {
        for (const pos of tiles) {
            const stone = this.state.addEntity(EntityType.MapObject, MapObjectType.ResourceStone, pos.x, pos.y, 0);
            this.services.stoneSystem.register(stone.id, MapObjectType.ResourceStone);
        }
    }

    // ─── Mine placement ───────────────────────────────────────────

    /**
     * Place a mine building: sets a region to ROCK terrain, places the building,
     * then sets ore veins of the given type around the building (within MINE_SEARCH_RADIUS=4).
     */
    placeMineBuilding(buildingType: BuildingType, oreType: OreType, oreLevel = 3): number {
        if (!isMineBuilding(buildingType)) {
            throw new Error(`${BuildingType[buildingType]} is not a mine building`);
        }
        const pos = this.placer.findMinePosition();
        this.fillRockSquare(pos.x, pos.y, 6);

        const result = this.execute({
            type: 'place_building',
            buildingType,
            x: pos.x,
            y: pos.y,
            player: 0,
            race: Race.Roman,
            completed: true,
            spawnWorker: true,
        });
        if (!result.success) {
            throw new Error(
                `Failed to place mine ${BuildingType[buildingType]} at (${pos.x}, ${pos.y}): ${result.error}`
            );
        }
        const entityId = this.resultEntityId(result);

        this.fillOreSquare(pos.x, pos.y, 4, oreType, oreLevel);
        return entityId;
    }

    // ─── Unit management ──────────────────────────────────────────

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
        return this.resultEntityId(result);
    }

    spawnUnitNear(buildingId: number, unitType: UnitType, count = 1, player = 0): number[] {
        return this.tilesNearBuilding(buildingId, count).map(pos => this.spawnUnit(pos.x, pos.y, unitType, player));
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
                if (entity.x === target.x && entity.y === target.y) break;
            } else {
                if (unitState.path.length === 0 && unitState.moveProgress === 0 && visited.length > 1) {
                    break;
                }
            }
        }
        return visited;
    }

    // ─── Inventory queries ────────────────────────────────────────

    injectInput(buildingId: number, material: EMaterialType, amount: number) {
        this.services.inventoryManager.depositInput(buildingId, material, amount);
    }

    injectOutput(buildingId: number, material: EMaterialType, amount: number) {
        this.services.inventoryManager.depositOutput(buildingId, material, amount);
        // Auto-configure StorageArea direction so tests work without explicit setup
        if (this.services.inventoryManager.isStorageArea(buildingId)) {
            const sfm = this.services.storageFilterManager;
            if (!sfm.getDirection(buildingId, material)) {
                sfm.setDirection(buildingId, material, StorageDirection.Both);
            }
        }
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

    // ─── Event logging ────────────────────────────────────────────

    logEvents(...events: (keyof GameEvents | '*')[]) {
        if (events.includes('*')) {
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

    // ─── Diagnostics dump ──────────────────────────────────────────

    /**
     * Register a virtual territory-generating building so the entire map
     * belongs to a player. Workers use territory-aware spatial queries,
     * so this is required for them to find resources.
     */
    establishTerritory(player: number): void {
        const tm = this.services.territoryManager;
        // Register a virtual castle at map center covering the whole map
        tm.addBuilding(-1 - player, this.mapWidth >> 1, this.mapHeight >> 1, player, BuildingType.Castle);
        // Force territory computation and spatial grid cell rebuild
        tm.getOwner(0, 0);
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    destroy() {
        this.services.destroy();
    }

    // ─── Private helpers ──────────────────────────────────────────

    /** Extract entity ID from a successful command result. */
    private resultEntityId(result: ReturnType<Simulation['execute']>): number {
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    /**
     * Find N empty tiles near a building.
     * `far` uses a fixed offset (25) to place outside work area; otherwise adjacent to footprint.
     */
    private tilesNearBuilding(buildingId: number, count: number, far = false): { x: number; y: number }[] {
        const b = this.state.getEntityOrThrow(buildingId, 'tilesNearBuilding');
        const skip = far ? 25 : this.footprintRadius(b) + 1;
        return this.findEmptyTiles(b.x, b.y, count, skip);
    }

    /** Chebyshev radius of a building's footprint from its anchor. */
    private footprintRadius(b: Entity): number {
        try {
            const fp = getBuildingFootprint(b.x, b.y, b.subType as BuildingType, b.race);
            return Math.max(...fp.map(t => Math.max(Math.abs(t.x - b.x), Math.abs(t.y - b.y))));
        } catch {
            return 2;
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

    /** Fill a square region with a terrain type. */
    fillTerrain(cx: number, cy: number, radius: number, terrain: number): void {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const tx = cx + dx;
                const ty = cy + dy;
                if (tx >= 0 && tx < this.mapWidth && ty >= 0 && ty < this.mapHeight) {
                    this.map.groundType[this.map.mapSize.toIndex(tx, ty)] = terrain;
                }
            }
        }
    }

    private fillRockSquare(cx: number, cy: number, radius: number): void {
        this.fillTerrain(cx, cy, radius, TERRAIN.ROCK);
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
}

// ─── Factory functions ───────────────────────────────────────────

export function createSimulation(opts: SimulationOptions = {}): Simulation {
    return new Simulation(opts);
}

/** Clean up game data singleton after tests. Call in afterEach. */
export function cleanupSimulation(): void {
    resetTestGameData();
}

// Re-export scenario builders for convenience
export { createScenario, type SingleBuildingSim, type ChainSim } from './test-scenarios';

// Re-export diagnostic helpers for convenience
export { scanFreeTiles, printBuildingDiagnosticMap, type TileCandidate } from './simulation-diagnostics';
