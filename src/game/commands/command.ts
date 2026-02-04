import { BuildingType, EntityType, UnitType } from '../entity';
import { GameState } from '../game-state';
import { canPlaceBuilding } from '../systems/placement';
import { findPath } from '../systems/pathfinding';
import { MapSize } from '@/utilities/map-size';

export type Command =
    | { type: 'place_building'; buildingType: BuildingType; x: number; y: number; player: number }
    | { type: 'spawn_unit'; unitType: UnitType; x: number; y: number; player: number }
    | { type: 'move_unit'; entityId: number; targetX: number; targetY: number }
    | { type: 'select'; entityId: number | null };

/**
 * Execute a player command against the game state.
 * Returns true if the command was successfully executed.
 */
export function executeCommand(
    state: GameState,
    cmd: Command,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    switch (cmd.type) {
    case 'place_building': {
        if (!canPlaceBuilding(groundType, groundHeight, mapSize, state.tileOccupancy, cmd.x, cmd.y)) {
            return false;
        }
        state.addEntity(EntityType.Building, cmd.buildingType, cmd.x, cmd.y, cmd.player);
        return true;
    }

    case 'spawn_unit': {
        // Spawn at the given tile, or find adjacent free tile
        let spawnX = cmd.x;
        let spawnY = cmd.y;

        // If tile is occupied, try adjacent tiles
        if (state.getEntityAt(spawnX, spawnY)) {
            const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
            let found = false;
            for (const [dx, dy] of offsets) {
                const nx = spawnX + dx;
                const ny = spawnY + dy;
                if (nx >= 0 && nx < mapSize.width && ny >= 0 && ny < mapSize.height) {
                    if (!state.getEntityAt(nx, ny)) {
                        spawnX = nx;
                        spawnY = ny;
                        found = true;
                        break;
                    }
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
        return true;
    }

    default:
        return false;
    }
}
