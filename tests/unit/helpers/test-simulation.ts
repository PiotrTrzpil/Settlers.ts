/**
 * Headless simulation harness — runs the full game systems pipeline
 * (buildings, workers, carriers, logistics) without a browser.
 *
 * Uses GameServices with a synthetic map and ticks all systems in a tight loop.
 * Building placement is automatic via SmartBuildingPlacer (in simulation-world-builder.ts).
 *
 * Records a structured timeline for diagnostics. On runUntil() timeout, dumps
 * timeline entries, world snapshot, and simulation errors.
 *
 * See test-scenarios.ts for pre-configured simulation setups (createScenario).
 */

import { onTestFinished } from 'vitest';
import { installRealGameData, resetTestGameData } from './test-game-data';
import { createTestMap, TERRAIN } from './test-map';
import { TimelineRecorder } from './timeline-recorder';
import { wireSimulationTimeline } from './simulation-timeline';
import {
    SmartBuildingPlacer,
    INVARIANT_CHECK_INTERVAL,
    nextSimulationId,
    snapshotBuildings,
    snapshotCarriers,
    checkEntityBounds,
    checkInventoryIntegrity,
    tilesNearBuilding,
    placeTreeEntities,
    placeStoneEntities,
    fillTerrain as fillTerrainRegion,
    fillRockSquare,
    fillOreSquare,
    type SimulationError,
    type SimSnapshot,
    type RunUntilOptions,
    type SimulationOptions,
} from './simulation-world-builder';
import { EventBus, type GameEvents } from '@/game/event-bus';
import { GameState } from '@/game/game-state';
import { GameServices } from '@/game/game-services';
import { CommandHandlerRegistry, registerAllHandlers } from '@/game/commands';
import { BuildingType, isStorageBuilding } from '@/game/buildings/building-type';
import { EntityType, UnitType, type TileCoord } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';
import { GameSettingsManager } from '@/game/game-settings';
import { Race } from '@/game/core/race';
import { SlotKind } from '@/game/core/pile-kind';
import { isMineBuilding } from '@/game/buildings/types';
import { populateMapBuildings } from '@/game/features/building-construction';
import { populateMapSettlers } from '@/game/systems/map-settlers';
import type { MapBuildingData, MapSettlerData } from '@/resources/map/map-entity-data';
import { BuildingConstructionPhase } from '@/game/features/building-construction/types';
import type { OreType } from '@/game/features/ore-veins/ore-type';
import type { TestMap } from './test-map';
import { simulateMovement } from './simulation-movement';

// Re-export types so existing imports keep working
export type {
    SimulationError,
    SimSnapshot,
    RunUntilOptions,
    SimulationOptions,
    BuildingSnapshot,
    CarrierSnapshot,
} from './simulation-world-builder';

// ─── Simulation class ────────────────────────────────────────────────

export class Simulation {
    readonly state: GameState;
    readonly services: GameServices;
    readonly settings: GameSettingsManager;
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
        const { mapWidth = 128, mapHeight = 128, race = Race.Roman } = opts;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.testId = nextSimulationId();
        this.timeline = new TimelineRecorder(this.testId);

        const loaded = installRealGameData();
        if (!loaded) {
            throw new Error(
                'Integration tests require real game data (public/Siedler4/GameData/). Run installRealGameData() first.'
            );
        }

        this.map = createTestMap(mapWidth, mapHeight);
        this.eventBus = new EventBus();
        this.eventBus.strict = true;
        this.state = new GameState(this.eventBus, () => 0);
        this.state.playerRaces = new Map([
            [0, race],
            [1, Race.Roman],
        ]);

        // Subscribe timeline FIRST — before any other system registers handlers,
        // so every event is captured from the very first entity placement.
        wireSimulationTimeline(this.eventBus, this.timeline, () => this.tickCount);

        this.settings = new GameSettingsManager();
        this.settings.resetToDefaults();
        const settings = this.settings;

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
            getOwner: (x, y) => this.services.territoryManager.getOwner(x, y),
        });

        this.services.residenceSpawner.immediateMode = true;

        // Establish territory for player 0 covering the entire test map (unless skipped).
        // Workers use the spatial grid's territory-aware queries, so they need
        // their tiles to be inside territory to find resources.
        if (!opts.skipTerritory) {
            this.establishTerritory(0);
        }

        this.eventBus.on('entity:removed', ({ entityId }) => {
            this.services.settlerTaskSystem.onEntityRemoved(entityId);
        });

        this.tickSystems = this.services.getTickSystems();
        this.placer = new SmartBuildingPlacer(this.state, this.map.terrain, mapWidth, mapHeight);

        // Always enable verbose subsystems — all data goes to timeline DB.
        this.state.movement.verbose = true;
        this.services.settlerTaskSystem.verbose = true;

        // Finalize timeline DB record after test completes.
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
        return {
            tick: this.tickCount,
            entityCounts,
            buildings: snapshotBuildings(this.state, this.services),
            carriers: snapshotCarriers(this.state, this.services),
            errorCount: this.errors.length,
        };
    }

    // ─── Invariant monitors ───────────────────────────────────────

    private checkInvariants() {
        checkEntityBounds(this.state, this.mapWidth, this.mapHeight, this.errors, this.tickCount);
        checkInventoryIntegrity(this.state, this.services, this.errors, this.tickCount);
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
            throw new Error(`Failed to place ${buildingType} at (${x}, ${y}): ${result.error}`);
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
            throw new Error(`Failed to place ${material} at (${pos.x}, ${pos.y}): ${result.error}`);
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
            throw new Error(`Failed to place ${material} at (${x}, ${y}): ${result.error}`);
        }
        return this.resultEntityId(result);
    }

    placeGoodsNear(buildingId: number, material: EMaterialType, amount: number) {
        if (amount > 8) throw new Error(`placeGoodsNear: amount ${amount} exceeds max pile size of 8`);
        const tiles = this.tilesNear(buildingId, 1);
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
            throw new Error(`Failed to place ${material} near building ${buildingId}: ${result.error}`);
        }
    }

    // ─── Map-data population (real map-load pipeline) ─────────────

    /**
     * Populate buildings and settlers from raw map entity data arrays, using
     * the same code paths as the real Game.populateMapEntities.
     */
    populateMapData(
        buildings: MapBuildingData[],
        settlers: MapSettlerData[]
    ): { buildingCount: number; settlerCount: number } {
        const mapBuildings = populateMapBuildings(this.state, buildings, {
            terrain: this.map.terrain,
        });
        const settlerCount = populateMapSettlers(this.state, settlers, this.eventBus);

        this.services.settlerTaskSystem.relocateUnitsFromFootprints();

        for (const { buildingId, buildingType, race } of mapBuildings) {
            this.eventBus.emit('building:completed', { buildingId, buildingType, race });
        }

        return { buildingCount: mapBuildings.length, settlerCount };
    }

    // ─── Map object placement ─────────────────────────────────────

    private tilesNear(buildingId: number, count: number, far = false) {
        return tilesNearBuilding(this.state, buildingId, count, far, this.mapWidth, this.mapHeight);
    }

    plantTreesNear(buildingId: number, count: number): number {
        const tiles = this.tilesNear(buildingId, count);
        placeTreeEntities(this.state, this.services, tiles);
        return tiles.length;
    }

    plantTreesFar(buildingId: number, count: number): number {
        const tiles = this.tilesNear(buildingId, count, true);
        placeTreeEntities(this.state, this.services, tiles);
        return tiles.length;
    }

    countNearbyTrees(buildingId: number): number {
        const b = this.state.getEntityOrThrow(buildingId, 'countNearbyTrees');
        return this.state.entities.filter(
            e => e.type === EntityType.MapObject && Math.abs(e.x - b.x) <= 20 && Math.abs(e.y - b.y) <= 20
        ).length;
    }

    placeRiverNear(buildingId: number, count: number) {
        for (const pos of this.tilesNear(buildingId, count)) {
            this.map.groundType[this.map.mapSize.toIndex(pos.x, pos.y)] = TERRAIN.RIVER_MIN;
        }
    }

    placeStonesNear(buildingId: number, count: number) {
        placeStoneEntities(this.state, this.services, this.tilesNear(buildingId, count));
    }

    placeStonesFar(buildingId: number, count: number) {
        placeStoneEntities(this.state, this.services, this.tilesNear(buildingId, count, true));
    }

    // ─── Mine placement ───────────────────────────────────────────

    /**
     * Place a mine building: sets a region to ROCK terrain, places the building,
     * then sets ore veins of the given type around the building.
     */
    placeMineBuilding(buildingType: BuildingType, oreType: OreType, oreLevel = 3): number {
        if (!isMineBuilding(buildingType)) {
            throw new Error(`${buildingType} is not a mine building`);
        }
        const pos = this.placer.findMinePosition();
        fillRockSquare(this.map, pos.x, pos.y, 6, this.mapWidth, this.mapHeight);

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
            throw new Error(`Failed to place mine ${buildingType} at (${pos.x}, ${pos.y}): ${result.error}`);
        }
        const entityId = this.resultEntityId(result);

        fillOreSquare(this.services, pos.x, pos.y, 4, oreType, oreLevel, this.mapWidth, this.mapHeight);
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
            throw new Error(`Failed to spawn ${unitType} at (${x}, ${y}): ${result.error}`);
        }
        return this.resultEntityId(result);
    }

    spawnUnitNear(buildingId: number, unitType: UnitType, count = 1, player = 0): number[] {
        return this.tilesNear(buildingId, count).map(pos => this.spawnUnit(pos.x, pos.y, unitType, player));
    }

    moveUnit(entityId: number, targetX: number, targetY: number): boolean {
        return this.state.movement.moveUnit(entityId, targetX, targetY);
    }

    simulateMovement(entityId: number, opts: { maxTicks?: number; target?: TileCoord } = {}): TileCoord[] {
        return simulateMovement(this, entityId, opts);
    }

    // ─── Inventory queries ────────────────────────────────────────

    injectInput(buildingId: number, material: EMaterialType, amount: number) {
        this.services.inventoryManager.depositInput(buildingId, material, amount);
    }

    injectOutput(buildingId: number, material: EMaterialType, amount: number) {
        const entity = this.state.getEntityOrThrow(buildingId, 'injectOutput');
        const im = this.services.inventoryManager;

        // StorageArea slots start as NO_MATERIAL with kind=Storage — claim one before depositing
        if (isStorageBuilding(entity.subType as BuildingType)) {
            const existing = im.findSlotWithSpace(buildingId, material, SlotKind.Storage);
            if (!existing) {
                const free = im.findSlotWithSpace(buildingId, EMaterialType.NO_MATERIAL, SlotKind.Storage);
                if (!free) throw new Error(`injectOutput: no free slot on StorageArea ${buildingId} for ${material}`);
                im.setSlotMaterial(free.slotId, material);
            }
            const sfm = this.services.storageFilterManager;
            if (!sfm.getDirection(buildingId, material)) {
                sfm.setDirection(buildingId, material, StorageDirection.Both);
            }
        }

        im.depositOutput(buildingId, material, amount);
    }

    getOutput(buildingId: number, material: EMaterialType): number {
        return this.services.inventoryManager.getOutputAmount(buildingId, material);
    }

    getInput(buildingId: number, material: EMaterialType): number {
        return this.services.inventoryManager.getInputAmount(buildingId, material);
    }

    countEntities(type: EntityType, subType?: number | string): number {
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

    // ─── Territory & terrain ─────────────────────────────────────

    /**
     * Register a virtual territory-generating building so the entire map
     * belongs to a player.
     */
    establishTerritory(player: number): void {
        const tm = this.services.territoryManager;
        tm.addBuilding(-1 - player, this.mapWidth >> 1, this.mapHeight >> 1, player, BuildingType.Castle);
        tm.getOwner(0, 0);
    }

    /** Fill a square region with a terrain type. */
    fillTerrain(cx: number, cy: number, radius: number, terrain: number): void {
        fillTerrainRegion(this.map, cx, cy, radius, terrain, this.mapWidth, this.mapHeight);
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
