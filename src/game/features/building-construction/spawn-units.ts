/**
 * Unit spawning logic for building construction completion.
 *
 * This module provides the shared logic for spawning units when a building
 * completes construction. It is used by:
 * - BuildingConstructionSystem (when construction completes via tick)
 * - Command system (when building is placed as completed)
 * - Map loading (when loading pre-existing completed buildings)
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EntityType, tileKey } from '../../entity';
import { BuildingType } from '../../buildings/types';
import { UnitType, BUILDING_UNIT_TYPE } from '../../unit-types';
import { isPassable } from '../placement';
import type { BuildingState, BuildingSpawnConfig } from './types';
import { gameSettings } from '../../game-settings';

/**
 * Which unit type (and count) each building spawns when construction completes.
 * The Barrack produces soldiers, residence buildings produce settlers, etc.
 * Buildings not listed here don't spawn units on completion.
 */
export const BUILDING_SPAWN_ON_COMPLETE: Record<number, BuildingSpawnConfig | undefined> = {
    [BuildingType.Barrack]: { unitType: UnitType.Swordsman, count: 3 },
    [BuildingType.ResidenceSmall]: { unitType: UnitType.Carrier, count: 2 },
    [BuildingType.ResidenceMedium]: { unitType: UnitType.Carrier, count: 4 },
    [BuildingType.ResidenceBig]: { unitType: UnitType.Carrier, count: 6 },
};

/**
 * Context for spawning units (terrain data for validation).
 */
export interface SpawnContext {
    groundType: Uint8Array;
    mapSize: { width: number; height: number; toIndex: (x: number, y: number) => number };
}

/**
 * Check if a tile is valid for spawning a unit.
 */
function isValidSpawnTile(state: GameState, ctx: SpawnContext, x: number, y: number): boolean {
    const { mapSize, groundType } = ctx;
    if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) return false;
    if (!isPassable(groundType[mapSize.toIndex(x, y)])) return false;
    return !state.getEntityAt(x, y);
}

/**
 * Generate ring perimeter tiles (only the edge of a square ring).
 */
function* getRingTiles(cx: number, cy: number, radius: number): Generator<{ x: number; y: number }> {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                yield { x: cx + dx, y: cy + dy };
            }
        }
    }
}

/**
 * Spawn units around a building on valid tiles.
 */
function spawnUnitsAroundBuilding(
    state: GameState,
    spawnDef: BuildingSpawnConfig,
    bx: number,
    by: number,
    player: number,
    spawnCtx: SpawnContext,
    eventBus: EventBus
): void {
    let spawned = 0;
    for (let radius = 1; radius <= 4 && spawned < spawnDef.count; radius++) {
        for (const tile of getRingTiles(bx, by, radius)) {
            if (spawned >= spawnDef.count) break;
            if (!isValidSpawnTile(state, spawnCtx, tile.x, tile.y)) continue;

            const spawnedEntity = state.addEntity(
                EntityType.Unit,
                spawnDef.unitType,
                tile.x,
                tile.y,
                player,
                spawnDef.selectable
            );

            eventBus.emit('unit:spawned', {
                entityId: spawnedEntity.id,
                unitType: spawnDef.unitType,
                x: tile.x,
                y: tile.y,
                player,
            });

            spawned++;
        }
    }
}

/**
 * Spawn units at the building location (no terrain context).
 */
function spawnUnitsAtBuilding(
    state: GameState,
    spawnDef: BuildingSpawnConfig,
    bx: number,
    by: number,
    player: number,
    buildingEntityId: number,
    eventBus: EventBus
): void {
    for (let i = 0; i < spawnDef.count; i++) {
        const spawnedEntity = state.addEntity(EntityType.Unit, spawnDef.unitType, bx, by, player, spawnDef.selectable);

        // Restore building's tile occupancy
        state.tileOccupancy.set(tileKey(bx, by), buildingEntityId);

        eventBus.emit('unit:spawned', {
            entityId: spawnedEntity.id,
            unitType: spawnDef.unitType,
            x: bx,
            y: by,
            player,
        });
    }
}

/**
 * Spawn units for a completed building.
 *
 * Spawns units from BUILDING_SPAWN_ON_COMPLETE (carriers from residences, soldiers from barracks).
 * Also spawns dedicated workers from BUILDING_UNIT_TYPE if placeBuildingsWithWorker is enabled.
 *
 * @param state - Game state for entity creation
 * @param buildingState - The building's construction state
 * @param eventBus - Event bus for emitting unit:spawned events
 * @param spawnCtx - Optional spawn context for terrain validation (if not provided, units spawn at building location)
 */
export function spawnUnitsOnBuildingComplete(
    state: GameState,
    buildingState: BuildingState,
    eventBus: EventBus,
    spawnCtx?: SpawnContext
): void {
    const entity = state.getEntityOrThrow(buildingState.entityId, 'completed building');
    const { tileX: bx, tileY: by } = buildingState;

    // Spawn units from BUILDING_SPAWN_ON_COMPLETE (carriers from residences, soldiers from barracks)
    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingState.buildingType];
    if (spawnDef) {
        if (spawnCtx) {
            spawnUnitsAroundBuilding(state, spawnDef, bx, by, entity.player, spawnCtx, eventBus);
        } else {
            spawnUnitsAtBuilding(state, spawnDef, bx, by, entity.player, buildingState.entityId, eventBus);
        }
    }

    // Spawn dedicated worker from BUILDING_UNIT_TYPE if placeBuildingsWithWorker is enabled
    if (gameSettings.state.placeBuildingsWithWorker) {
        const workerType = BUILDING_UNIT_TYPE[buildingState.buildingType as BuildingType];
        if (workerType !== undefined) {
            // Spawn worker at the building's location (workers "work inside" buildings)
            const workerEntity = state.addEntity(EntityType.Unit, workerType, bx, by, entity.player);

            // Restore building's tile occupancy - workers "work inside" buildings
            // and shouldn't claim the building's tile
            state.tileOccupancy.set(tileKey(bx, by), buildingState.entityId);

            eventBus.emit('unit:spawned', {
                entityId: workerEntity.id,
                unitType: workerType,
                x: bx,
                y: by,
                player: entity.player,
            });
        }
    }
}
