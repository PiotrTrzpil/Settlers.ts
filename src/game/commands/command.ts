import { BuildingType, EntityType, EXTENDED_OFFSETS, UnitType, BUILDING_UNIT_TYPE } from '../entity';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint, isPassable } from '../systems/placement';
import { restoreOriginalTerrain } from '../systems/terrain-leveling';
import { TerritoryMap } from '../systems/territory';
import { findPath } from '../systems/pathfinding';
import { MapSize } from '@/utilities/map-size';

export type Command =
    | { type: 'place_building'; buildingType: BuildingType; x: number; y: number; player: number }
    | { type: 'spawn_unit'; unitType: UnitType; x: number; y: number; player: number }
    | { type: 'move_unit'; entityId: number; targetX: number; targetY: number }
    | { type: 'select'; entityId: number | null }
    | { type: 'select_area'; x1: number; y1: number; x2: number; y2: number }
    | { type: 'remove_entity'; entityId: number };

/**
 * Execute a player command against the game state.
 * Returns true if the command was successfully executed.
 */
export function executeCommand(
    state: GameState,
    cmd: Command,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    territory?: TerritoryMap
): boolean {
    switch (cmd.type) {
    case 'place_building': {
        // Check if player already has buildings (for territory rules)
        const hasBuildings = state.entities.some(
            e => e.type === EntityType.Building && e.player === cmd.player
        );

        // Use footprint-aware placement validation with territory checks
        // Territory is optional - if not provided, only basic placement rules apply
        if (territory) {
            if (!canPlaceBuildingFootprint(
                groundType, groundHeight, mapSize, state.tileOccupancy,
                territory, cmd.x, cmd.y, cmd.player, hasBuildings, cmd.buildingType
            )) {
                return false;
            }
        } else {
            // Fallback: basic footprint validation without territory
            // Create a dummy territory for validation that always returns NO_OWNER
            const dummyTerritory = new TerritoryMap(mapSize);
            if (!canPlaceBuildingFootprint(
                groundType, groundHeight, mapSize, state.tileOccupancy,
                dummyTerritory, cmd.x, cmd.y, cmd.player, false, cmd.buildingType
            )) {
                return false;
            }
        }
        state.addEntity(EntityType.Building, cmd.buildingType, cmd.x, cmd.y, cmd.player);

        // Auto-spawn the associated worker unit adjacent to the building
        const workerType = BUILDING_UNIT_TYPE[cmd.buildingType];
        if (workerType !== undefined) {
            for (const [dx, dy] of EXTENDED_OFFSETS) {
                const nx = cmd.x + dx;
                const ny = cmd.y + dy;
                if (nx >= 0 && nx < mapSize.width && ny >= 0 && ny < mapSize.height) {
                    if (!state.getEntityAt(nx, ny)) {
                        state.addEntity(EntityType.Unit, workerType, nx, ny, cmd.player);
                        break;
                    }
                }
            }
        }

        return true;
    }

    case 'spawn_unit': {
        // Spawn at the given tile, or find adjacent free & passable tile
        let spawnX = cmd.x;
        let spawnY = cmd.y;

        const isTileValid = (x: number, y: number) =>
            x >= 0 && x < mapSize.width && y >= 0 && y < mapSize.height &&
            isPassable(groundType[mapSize.toIndex(x, y)]) &&
            !state.getEntityAt(x, y);

        if (!isTileValid(spawnX, spawnY)) {
            let found = false;
            for (const [dx, dy] of EXTENDED_OFFSETS) {
                const nx = spawnX + dx;
                const ny = spawnY + dy;
                if (isTileValid(nx, ny)) {
                    spawnX = nx;
                    spawnY = ny;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }

        state.addEntity(EntityType.Unit, cmd.unitType, spawnX, spawnY, cmd.player);
        return true;
    }

    case 'move_unit': {
        const entity = state.getEntity(cmd.entityId);
        if (!entity) return false;

        const unitState = state.unitStates.get(cmd.entityId);
        if (!unitState) return false;

        const path = findPath(
            entity.x, entity.y,
            cmd.targetX, cmd.targetY,
            groundType, groundHeight,
            mapSize.width, mapSize.height,
            state.tileOccupancy
        );

        if (!path || path.length === 0) return false;

        unitState.path = path;
        unitState.pathIndex = 0;
        unitState.moveProgress = 0;

        return true;
    }

    case 'select': {
        state.selectedEntityId = cmd.entityId;
        state.selectedEntityIds.clear();
        if (cmd.entityId !== null) {
            state.selectedEntityIds.add(cmd.entityId);
        }
        return true;
    }

    case 'select_area': {
        const entities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
        // Prefer selecting units over buildings
        const units = entities.filter(e => e.type === EntityType.Unit);
        const toSelect = units.length > 0 ? units : entities;

        state.selectedEntityIds.clear();
        for (const e of toSelect) {
            state.selectedEntityIds.add(e.id);
        }
        state.selectedEntityId = toSelect.length > 0 ? toSelect[0].id : null;
        return true;
    }

    case 'remove_entity': {
        const entity = state.getEntity(cmd.entityId);
        if (!entity) return false;

        // Restore terrain before removing a building that modified it
        if (entity.type === EntityType.Building) {
            const bs = state.buildingStates.get(cmd.entityId);
            if (bs) {
                restoreOriginalTerrain(bs, groundType, groundHeight, mapSize);
            }
        }

        state.removeEntity(cmd.entityId);
        return true;
    }

    default:
        return false;
    }
}
