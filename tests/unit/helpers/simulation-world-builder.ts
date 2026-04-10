/**
 * World-building helpers for the test simulation.
 *
 * Contains the SmartBuildingPlacer, map-object placement, terrain filling,
 * tile finding, snapshot, and invariant-checking logic — extracted from
 * test-simulation.ts to keep that file under the 600-line limit.
 */

import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingFootprint } from '@/game/buildings/types';
import { SlotKind } from '@/game/core/pile-kind';
import { Race } from '@/game/core/race';
import { query } from '@/game/ecs';
import { EntityType, UnitType, tileKey, Tile } from '@/game/entity';
import type { GameServices } from '@/game/game-services';
import type { GameState } from '@/game/game-state';
import { MapObjectType } from '@/game/types/map-object-types';
import { canPlaceBuildingFootprint } from '@/game/systems/placement';
import { spiralSearch } from '@/game/utils/spiral-search';
import { formatSlots } from './simulation-timeline';
import { TERRAIN, type TestMap } from './test-map';
import type { OreType } from '@/game/features/ore-veins/ore-type';

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

export interface SimulationOptions {
    mapWidth?: number;
    mapHeight?: number;
    /** Race for player 0 (defaults to Roman). */
    race?: Race;
    /** Race for player 1 (defaults to Roman). */
    race1?: Race;
    /** Skip automatic territory establishment for player 0. Use placeGuardTower() to set up territory manually. */
    skipTerritory?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────

export const INVARIANT_CHECK_INTERVAL = 30; // every ~1 simulated second

/** Auto-incrementing counter for unique test IDs within a run. */
export let simulationCounter = 0;
export function nextSimulationId(): string {
    return `sim_${++simulationCounter}_${Date.now()}`;
}

// ─── Auto-placer ────────────────────────────────────────────────

/**
 * Building placer: spiral from map center, use the real placement
 * validator (terrain + occupancy + 1-tile footprint gap).
 *
 * No approximations — the validator guarantees legal placement.
 */
export class SmartBuildingPlacer {
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
    findBuildingPosition(buildingType: BuildingType, race = Race.Roman): Tile {
        const result = spiralSearch({ x: this.centerX, y: this.centerY }, this.mapWidth, this.mapHeight, ({ x, y }) => {
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
            const fp = getBuildingFootprint({ x, y }, buildingType, race);
            return fp.every(t => !this.state.unitOccupancy.has(tileKey(t)));
        });
        if (!result) throw new Error(`SmartBuildingPlacer: no valid position for ${buildingType}`);
        return result;
    }

    /** Find any non-occupied tile near center (for goods piles). */
    findOpenPosition(): Tile {
        const result = spiralSearch(
            { x: this.centerX, y: this.centerY },
            this.mapWidth,
            this.mapHeight,
            t => !this.state.groundOccupancy.has(tileKey(t)) && !this.state.unitOccupancy.has(tileKey(t))
        );
        if (!result) throw new Error('SmartBuildingPlacer: no open position found');
        return result;
    }

    /** Find a position with enough clearance for a mine. */
    findMinePosition(clearance = 8): Tile {
        const result = spiralSearch({ x: this.centerX, y: this.centerY }, this.mapWidth, this.mapHeight, ({ x, y }) => {
            if (x - clearance < 0 || x + clearance >= this.mapWidth) return false;
            if (y - clearance < 0 || y + clearance >= this.mapHeight) return false;
            for (let dy = -clearance; dy <= clearance; dy++) {
                for (let dx = -clearance; dx <= clearance; dx++) {
                    const k = tileKey({ x: x + dx, y: y + dy });
                    if (this.state.groundOccupancy.has(k) || this.state.unitOccupancy.has(k)) return false;
                }
            }
            return true;
        });
        if (!result) throw new Error('SmartBuildingPlacer: no mine position found');
        return result;
    }
}

// ─── Snapshot helpers ────────────────────────────────────────────

export function snapshotBuildings(state: GameState, services: GameServices): BuildingSnapshot[] {
    const buildings: BuildingSnapshot[] = [];
    const im = services.inventoryManager;
    for (const buildingId of im.getAllInventories()) {
        const slots = im.getSlots(buildingId);
        const inputs = formatSlots(slots.filter(s => s.kind === SlotKind.Input));
        const outputs = formatSlots(slots.filter(s => s.kind === SlotKind.Output || s.kind === SlotKind.Storage));
        const entity = state.getEntity(buildingId);
        const buildingType = entity?.subType ?? -1;
        buildings.push({
            id: buildingId,
            type: String(buildingType),
            inputs: inputs ? `in[${inputs}]` : '',
            outputs: outputs ? `out[${outputs}]` : '',
        });
    }
    return buildings;
}

export function snapshotCarriers(state: GameState, services: GameServices): CarrierSnapshot[] {
    const carriers: CarrierSnapshot[] = [];
    for (const [id, , entity] of query(services.carrierRegistry.store, state.store)) {
        const pos = `(${entity.x},${entity.y})`;
        const carrying = entity.carrying ? `${entity.carrying.material}×${entity.carrying.amount}` : '';
        carriers.push({ id, status: 'registered', pos, carrying });
    }
    return carriers;
}

// ─── Invariant checking ─────────────────────────────────────────

export function checkEntityBounds(
    state: GameState,
    mapWidth: number,
    mapHeight: number,
    errors: SimulationError[],
    tickCount: number
): void {
    for (const e of state.entities) {
        if (e.x < 0 || e.y < 0 || e.x >= mapWidth || e.y >= mapHeight) {
            let typeName: string = EntityType[e.type] ?? 'Unknown';
            if (e.type === EntityType.Unit) typeName = e.subType as UnitType;
            else if (e.type === EntityType.Building) typeName = String(e.subType);
            errors.push({
                tick: tickCount,
                system: 'invariant',
                error: new Error(`${EntityType[e.type]} #${e.id} (${typeName}) out of bounds at (${e.x},${e.y})`),
            });
        }
    }
}

export function checkInventoryIntegrity(
    state: GameState,
    services: GameServices,
    errors: SimulationError[],
    tickCount: number
): void {
    const im = services.inventoryManager;
    for (const buildingId of im.getAllInventories()) {
        const entity = state.getEntity(buildingId);
        const buildingType = entity?.subType ?? -1;
        for (const slot of im.getSlots(buildingId)) {
            if (slot.currentAmount < 0) {
                errors.push({
                    tick: tickCount,
                    system: 'invariant',
                    error: new Error(
                        `Building #${buildingId} (${String(buildingType)}) ` +
                            `has negative ${slot.materialType}: ${slot.currentAmount}`
                    ),
                });
            }
        }
    }
}

// ─── World-building helpers ─────────────────────────────────────

/** Find N empty tiles near a building entity. */
export function tilesNearBuilding(
    state: GameState,
    buildingId: number,
    count: number,
    far: boolean,
    mapWidth: number,
    mapHeight: number
): Tile[] {
    const b = state.getEntityOrThrow(buildingId, 'tilesNearBuilding');
    const skip = far ? 25 : footprintRadius(b) + 1;
    return findEmptyTiles(state, b.x, b.y, count, mapWidth, mapHeight, skip);
}

/** Chebyshev radius of a building's footprint from its anchor. */
function footprintRadius(b: import('@/game/entity').Entity): number {
    try {
        const fp = getBuildingFootprint({ x: b.x, y: b.y }, b.subType as BuildingType, b.race);
        return Math.max(...fp.map(t => Math.max(Math.abs(t.x - b.x), Math.abs(t.y - b.y))));
    } catch {
        return 2;
    }
}

/** Find N empty tiles near a point using spiralSearch, skipping `skipRadius` inner tiles. */
function findEmptyTiles(
    state: GameState,
    cx: number,
    cy: number,
    count: number,
    mapWidth: number,
    mapHeight: number,
    skipRadius = 2
): Tile[] {
    const placed = new Set<string>();
    const results: Tile[] = [];
    for (let i = 0; i < count; i++) {
        const pos = spiralSearch({ x: cx, y: cy }, mapWidth, mapHeight, ({ x, y }) => {
            const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
            return dist >= skipRadius && !state.getEntityAt({ x, y }) && !placed.has(`${x},${y}`);
        });
        if (!pos) break;
        placed.add(`${pos.x},${pos.y}`);
        results.push(pos);
    }
    return results;
}

export function placeTreeEntities(state: GameState, services: GameServices, tiles: Tile[]): void {
    for (const pos of tiles) {
        const tree = state.addEntity(EntityType.MapObject, MapObjectType.TreePine, pos, 0);
        services.treeSystem.register(tree.id, MapObjectType.TreePine, false);
    }
}

export function placeStoneEntities(state: GameState, services: GameServices, tiles: Tile[]): void {
    for (const pos of tiles) {
        const stone = state.addEntity(EntityType.MapObject, MapObjectType.ResourceStone12, pos, 0);
        services.stoneSystem.register(stone.id, MapObjectType.ResourceStone12);
    }
}

/** Fill a square region with a terrain type. */
export function fillTerrain(
    map: TestMap,
    cx: number,
    cy: number,
    radius: number,
    terrain: number,
    mapWidth: number,
    mapHeight: number
): void {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx >= 0 && tx < mapWidth && ty >= 0 && ty < mapHeight) {
                map.groundType[map.mapSize.toIndex({ x: tx, y: ty })] = terrain;
            }
        }
    }
}

export function fillRockSquare(
    map: TestMap,
    cx: number,
    cy: number,
    radius: number,
    mapWidth: number,
    mapHeight: number
): void {
    fillTerrain(map, cx, cy, radius, TERRAIN.ROCK, mapWidth, mapHeight);
}

export function fillOreSquare(
    services: GameServices,
    cx: number,
    cy: number,
    radius: number,
    oreType: OreType,
    oreLevel: number,
    mapWidth: number,
    mapHeight: number
): void {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx >= 0 && tx < mapWidth && ty >= 0 && ty < mapHeight) {
                services.oreVeinData.setOre({ x: tx, y: ty }, oreType, oreLevel);
            }
        }
    }
}
