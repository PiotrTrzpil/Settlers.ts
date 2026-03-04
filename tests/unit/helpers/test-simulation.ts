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
 * Use createScenario() for common setups:
 *   createScenario.singleProducer(type)         - residence + 1 building
 *   createScenario.chain(producer, transformer)  - residence + 2 buildings
 *   createScenario.isolatedTransformer(type, inputs) - building with injected inputs
 */

import { installTestGameData, installRealGameData, resetTestGameData } from './test-game-data';
import { createTestMap, TERRAIN, type TestMap } from './test-map';
import { TimelineRecorder, type TimelineCategory } from './timeline-recorder';
import { EventBus, type GameEvents } from '@/game/event-bus';
import { GameState } from '@/game/game-state';
import { GameServices } from '@/game/game-services';
import { executeCommand, type CommandContext } from '@/game/commands';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType, tileKey, type TileCoord } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { MapObjectType } from '@/game/types/map-object-types';
import { GameSettingsManager } from '@/game/game-settings';
import { Race } from '@/game/race';
import { spiralSearch } from '@/game/utils/spiral-search';
import { OreType } from '@/game/features/ore-veins/ore-type';
import { isMineBuilding, getBuildingFootprint } from '@/game/buildings/types';
import { canPlaceBuildingFootprint } from '@/game/features/placement';
import { CarrierStatus } from '@/game/features/carriers/carrier-state';
import { BuildingConstructionPhase } from '@/game/features/building-construction/types';
import type { InventorySlot } from '@/game/features/inventory/inventory-slot';
import type { Entity } from '@/game/entity';
import { EventFmt } from '@/game/event-formatting';

// ─── Formatting helpers ──────────────────────────────────────────

function formatSlots(slots: InventorySlot[]): string {
    const parts: string[] = [];
    for (const slot of slots) {
        if (slot.currentAmount > 0 || slot.reservedAmount > 0) {
            const res = slot.reservedAmount > 0 ? `(r${slot.reservedAmount})` : '';
            parts.push(`${EMaterialType[slot.materialType]}×${slot.currentAmount}${res}`);
        }
    }
    return parts.join(',');
}

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
        const result = spiralSearch(this.centerX, this.centerY, this.mapWidth, this.mapHeight, (x, y) =>
            canPlaceBuildingFootprint(
                this.terrain,
                this.state.tileOccupancy,
                x,
                y,
                buildingType,
                race,
                this.state.buildingFootprint
            )
        );
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
            (x, y) => !this.state.tileOccupancy.has(tileKey(x, y))
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
                    if (this.state.tileOccupancy.has(tileKey(x + dx, y + dy))) return false;
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
}

// ─── Flags ──────────────────────────────────────────────────────

/** Set DUMP_TIMELINE=1 to dump timeline on every test: `DUMP_TIMELINE=1 pnpm test:unit` */
const DUMP_TIMELINE = !!process.env['DUMP_TIMELINE'];

/** Set VERBOSE_MOVEMENT=1 to enable detailed pathfinding/movement events in the timeline */
const VERBOSE_MOVEMENT = !!process.env['VERBOSE_MOVEMENT'];

// ─── Invariant checking ─────────────────────────────────────────

const INVARIANT_CHECK_INTERVAL = 30; // every ~1 simulated second

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

    private readonly tickSystems: ReturnType<GameServices['getTickSystems']>;
    private readonly placer: SmartBuildingPlacer;
    private readonly cmdContext: () => CommandContext;
    private tickCount = 0;

    constructor(opts: SimulationOptions = {}) {
        const { mapWidth = 128, mapHeight = 128, useStubData = false } = opts;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.timeline = new TimelineRecorder();

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

        // Subscribe timeline FIRST — before any other system registers handlers,
        // so every event is captured from the very first entity placement.
        this.subscribeTimeline();

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
            storageFilterManager: this.services.storageFilterManager,
        });

        this.services = new GameServices(this.state, this.eventBus, cmd => executeCommand(this.cmdContext(), cmd));
        this.services.setTerrainData(this.map.terrain);

        this.services.logisticsDispatcher.globalLogistics = true;
        this.services.residenceSpawner.immediateMode = true;

        this.eventBus.on('entity:removed', ({ entityId }) => {
            this.services.settlerTaskSystem.onEntityRemoved(entityId);
        });

        this.tickSystems = this.services.getTickSystems();
        this.placer = new SmartBuildingPlacer(this.state, this.map.terrain, mapWidth, mapHeight);

        if (VERBOSE_MOVEMENT) {
            this.state.movement.verbose = true;
        }
    }

    // ─── Timeline event subscriptions ─────────────────────────────

    /**
     * Wire a single event to the timeline recorder.
     * `category` and `entityKey` define how the event maps to a timeline entry.
     * Formatting is handled by EventFmt in game code.
     */
    private wire<K extends keyof typeof EventFmt>(
        event: K,
        category: TimelineCategory,
        label: string,
        entityKey: string
    ) {
        this.eventBus.on(event, (payload: GameEvents[K]) => {
            const detail = EventFmt[event](payload as never);
            const entityId = (payload as Record<string, unknown>)[entityKey] as number | undefined;
            this.timeline.record(this.tickCount, category, entityId, label, detail);
        });
    }

    private subscribeTimeline() {
        this.wire('entity:created', 'world', 'entity_created', 'entityId');
        this.wire('entity:removed', 'world', 'entity_removed', 'entityId');
        this.wire('terrain:modified', 'world', 'terrain_modified', 'entityId');

        // Building lifecycle
        this.wire('building:placed', 'building', 'placed', 'entityId');
        this.wire('building:completed', 'building', 'completed', 'entityId');
        this.wire('building:removed', 'building', 'removed', 'entityId');

        // Unit lifecycle
        this.wire('unit:spawned', 'unit', 'spawned', 'entityId');
        this.wire('unit:movementStopped', 'unit', 'movement_stopped', 'entityId');

        // Settler task lifecycle
        this.wire('settler:taskStarted', 'unit', 'task_started', 'unitId');
        this.wire('settler:taskCompleted', 'unit', 'task_completed', 'unitId');
        this.wire('settler:taskFailed', 'unit', 'task_failed', 'unitId');

        // Carrier lifecycle
        this.wire('carrier:created', 'carrier', 'created', 'entityId');
        this.wire('carrier:removed', 'carrier', 'removed', 'entityId');
        this.wire('carrier:statusChanged', 'carrier', 'status', 'entityId');
        this.wire('carrier:arrivedForPickup', 'carrier', 'at_pickup', 'entityId');
        this.wire('carrier:arrivedForDelivery', 'carrier', 'at_delivery', 'entityId');
        this.wire('carrier:assigned', 'carrier', 'assigned', 'carrierId');
        this.wire('carrier:pickupComplete', 'carrier', 'picked_up', 'entityId');
        this.wire('carrier:deliveryComplete', 'carrier', 'delivered', 'entityId');
        this.wire('carrier:assignmentFailed', 'carrier', 'assign_failed', 'carrierId');
        this.wire('carrier:pickupFailed', 'carrier', 'pickup_failed', 'entityId');

        // Inventory — uses slotType as label (input/output)
        this.eventBus.on('inventory:changed', e => {
            this.timeline.record(
                this.tickCount,
                'inventory',
                e.buildingId,
                e.slotType,
                EventFmt['inventory:changed'](e)
            );
        });

        // Logistics
        this.wire('logistics:noMatch', 'logistics', 'no_match', 'buildingId');
        this.wire('logistics:noCarrier', 'logistics', 'no_carrier', 'buildingId');
        this.wire('logistics:buildingCleanedUp', 'logistics', 'building_cleanup', 'buildingId');
        this.wire('logistics:requestCreated', 'logistics', 'request_created', 'buildingId');

        // Production
        this.wire('production:modeChanged', 'building', 'prod_mode', 'buildingId');

        // Tree lifecycle
        this.wire('tree:planted', 'world', 'tree_planted', 'entityId');
        this.wire('tree:matured', 'world', 'tree_matured', 'entityId');
        this.wire('tree:cut', 'world', 'tree_cut', 'entityId');

        // Crop lifecycle
        this.wire('crop:planted', 'world', 'crop_planted', 'entityId');
        this.wire('crop:matured', 'world', 'crop_matured', 'entityId');
        this.wire('crop:harvested', 'world', 'crop_harvested', 'entityId');

        // Construction
        this.wire('construction:diggingStarted', 'building', 'digging_started', 'buildingId');
        this.wire('construction:tileCompleted', 'building', 'tile_leveled', 'buildingId');
        this.wire('construction:levelingComplete', 'building', 'leveling_done', 'buildingId');
        this.wire('construction:workerAssigned', 'building', 'worker_assigned', 'buildingId');
        this.wire('construction:workerReleased', 'building', 'worker_released', 'buildingId');
        this.wire('construction:materialDelivered', 'building', 'material_delivered', 'buildingId');
        this.wire('construction:buildingStarted', 'building', 'construction_started', 'buildingId');
        this.wire('construction:progressComplete', 'building', 'construction_done', 'buildingId');

        // Verbose movement (only wired when VERBOSE_MOVEMENT=1)
        if (VERBOSE_MOVEMENT) {
            this.wire('movement:pathFound', 'movement', 'path_found', 'entityId');
            this.wire('movement:pathFailed', 'movement', 'path_failed', 'entityId');
            this.wire('movement:blocked', 'movement', 'blocked', 'entityId');
            this.wire('movement:escalation', 'movement', 'escalation', 'entityId');
            this.wire('movement:collisionResolved', 'movement', 'collision', 'entityId');
        }

        // Combat
        this.wire('combat:unitAttacked', 'combat', 'attacked', 'attackerId');
        this.wire('combat:unitDefeated', 'combat', 'defeated', 'entityId');

        // Barracks
        this.wire('barracks:trainingStarted', 'building', 'training_started', 'buildingId');
        this.wire('barracks:trainingCompleted', 'building', 'training_completed', 'buildingId');
        this.wire('barracks:trainingInterrupted', 'building', 'training_interrupted', 'buildingId');
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
                this.timeline.record(this.tickCount, 'error', undefined, group, err.message);
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

    /** Dump full diagnostics on runUntil timeout. */
    private dumpTimeoutDiagnostics(opts: RunUntilOptions, maxTicks: number, errorsBefore: number) {
        const label = opts.label ?? 'predicate';
        const sep = '═'.repeat(70);
        console.log(`\n${sep}`);
        console.log(`  TIMEOUT: "${label}" not reached in ${maxTicks} ticks`);
        console.log(sep);

        if (opts.diagnose) {
            console.log(`\n[Diagnosis] ${opts.diagnose()}`);
        }

        const snap = this.snapshot();
        console.log(`\n[Snapshot at tick ${snap.tick}]`);
        console.log(`  Entities: ${JSON.stringify(snap.entityCounts)}`);
        this.dumpSnapshotDetails(snap);

        console.log(`\n[Timeline — last 50 entries]`);
        console.log(this.timeline.format(10000));

        this.dumpErrorSummary(errorsBefore);
        console.log(`${sep}\n`);
    }

    private dumpSnapshotDetails(snap: SimSnapshot) {
        for (const b of snap.buildings) {
            const parts = [b.inputs, b.outputs].filter(Boolean);
            console.log(`    #${b.id} ${b.type}${parts.length ? ': ' + parts.join(' | ') : ''}`);
        }
        for (const c of snap.carriers) {
            console.log(`    #${c.id} ${c.status} ${c.pos}${c.carrying ? ' ' + c.carrying : ''}`);
        }
    }

    private dumpErrorSummary(errorsBefore: number) {
        if (this.errors.length <= errorsBefore) return;
        const newErrors = this.errors.slice(errorsBefore);
        const unique = new Map<string, { count: number; tick: number; system: string }>();
        for (const e of newErrors) {
            const existing = unique.get(e.error.message);
            if (existing) {
                existing.count++;
            } else {
                unique.set(e.error.message, { count: 1, tick: e.tick, system: e.system });
            }
        }
        console.log(`\n[Errors] ${newErrors.length} error(s) during run (${unique.size} unique):`);
        for (const [msg, info] of unique) {
            console.log(`  [tick ${info.tick}, ${info.system}] (×${info.count}) ${msg}`);
        }
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
        for (const cs of this.services.carrierManager.getAllCarriers()) {
            const entity = this.state.getEntity(cs.entityId);
            const pos = entity ? `(${entity.x},${entity.y})` : '(?)';
            const carrying = entity?.carrying
                ? `${EMaterialType[entity.carrying.material]}×${entity.carrying.amount}`
                : '';
            carriers.push({ id: cs.entityId, status: CarrierStatus[cs.status], pos, carrying });
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

    execute(cmd: Parameters<typeof executeCommand>[1]) {
        return executeCommand(this.cmdContext(), cmd);
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

    placeBuilding(buildingType: BuildingType, player = 0, completed = true): number {
        const pos = this.placer.findBuildingPosition(buildingType);
        return this.placeBuildingAt(pos.x, pos.y, buildingType, player, completed);
    }

    /** Place a building at explicit coordinates (bypasses auto-placer). */
    placeBuildingAt(
        x: number,
        y: number,
        buildingType: BuildingType,
        player = 0,
        completed = true,
        race = Race.Roman
    ): number {
        const result = this.execute({
            type: 'place_building',
            buildingType,
            x,
            y,
            player,
            race,
            completed,
            spawnWorker: completed,
        });
        if (!result.success) {
            throw new Error(`Failed to place ${BuildingType[buildingType]} at (${x}, ${y}): ${result.error}`);
        }
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    placeGoods(material: EMaterialType, amount: number): number {
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
        return (result.effects![0]! as { entityId: number }).entityId;
    }

    placeGoodsNear(buildingId: number, material: EMaterialType, amount: number) {
        const b = this.state.getEntityOrThrow(buildingId, 'placeGoodsNear');
        const skip = this.footprintRadius(b) + 1;
        const tiles = this.findEmptyTiles(b.x, b.y, 1, skip);
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

    // ─── Map object placement ─────────────────────────────────────

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
        const entityId = (result.effects![0]! as { entityId: number }).entityId;

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

    /** Print timeline and snapshot to console. Call from afterEach or onTestFailed. */
    dumpDiagnostics(lastEntries = 100) {
        const sep = '═'.repeat(70);
        console.log(`\n${sep}`);
        console.log(`  DIAGNOSTICS at tick ${this.tickCount} (${this.errors.length} errors)`);
        console.log(sep);

        const snap = this.snapshot();
        console.log(`\n[Snapshot]`);
        console.log(`  Entities: ${JSON.stringify(snap.entityCounts)}`);
        this.dumpSnapshotDetails(snap);

        console.log(`\n[Timeline — last ${lastEntries} entries]`);
        console.log(this.timeline.format(lastEntries));

        if (this.errors.length > 0) {
            this.dumpErrorSummary(0);
        }
        console.log(`${sep}\n`);
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    destroy() {
        if (DUMP_TIMELINE || this.errors.length > 0) {
            this.dumpDiagnostics();
        }
        this.services.destroy();
    }

    // ─── Private helpers ──────────────────────────────────────────

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

// ─── Scenario builders ──────────────────────────────────────────

/** Simulation + primary building ID for single-building scenarios. */
export type SingleBuildingSim = Simulation & { buildingId: number };

/** Simulation + producer and transformer IDs for chain scenarios. */
export type ChainSim = Simulation & { producerId: number; transformerId: number };

export const createScenario = {
    /**
     * Single producer/building with a ResidenceSmall for carriers.
     * Returns sim with `buildingId` for the primary building.
     */
    singleProducer(buildingType: BuildingType, opts?: SimulationOptions): SingleBuildingSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const buildingId = sim.placeBuilding(buildingType);
        return Object.assign(sim, { buildingId });
    },

    /**
     * Producer → Transformer chain with carrier logistics.
     * Returns sim with `producerId` and `transformerId`.
     */
    chain(producer: BuildingType, transformer: BuildingType, opts?: SimulationOptions): ChainSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const producerId = sim.placeBuilding(producer);
        const transformerId = sim.placeBuilding(transformer);
        return Object.assign(sim, { producerId, transformerId });
    },

    /**
     * Isolated transformer — inputs pre-injected, no supply chain needed.
     * Returns sim with `buildingId` for the transformer.
     */
    isolatedTransformer(
        buildingType: BuildingType,
        inputs: [EMaterialType, number][],
        opts?: SimulationOptions
    ): SingleBuildingSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const buildingId = sim.placeBuilding(buildingType);
        for (const [mat, amt] of inputs) {
            sim.injectInput(buildingId, mat, amt);
        }
        return Object.assign(sim, { buildingId });
    },

    /**
     * Military training setup: StorageArea + ResidenceSmall + Barracks.
     * Returns sim with `barracksId` and `storageId`.
     */
    militaryTraining(opts?: SimulationOptions): Simulation & { barracksId: number; storageId: number } {
        const sim = new Simulation(opts ?? { mapWidth: 256, mapHeight: 256 });
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const barracksId = sim.placeBuilding(BuildingType.Barrack);
        return Object.assign(sim, { barracksId, storageId });
    },

    /**
     * Construction site setup: ResidenceSmall (for carriers) + digger + builder +
     * StorageArea with materials + a building placed as construction site.
     * Returns sim with `siteId` (the building under construction) and `storageId`.
     */
    constructionSite(
        buildingType: BuildingType,
        materials: [EMaterialType, number][] = [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ],
        opts?: SimulationOptions
    ): Simulation & { siteId: number; storageId: number } {
        const sim = new Simulation(opts ?? {});
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.spawnUnitNear(residenceId, UnitType.Digger);
        sim.spawnUnitNear(residenceId, UnitType.Builder);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        for (const [mat, amt] of materials) {
            sim.injectOutput(storageId, mat, amt);
        }
        const siteId = sim.placeBuilding(buildingType, 0, false);
        return Object.assign(sim, { siteId, storageId });
    },
};
