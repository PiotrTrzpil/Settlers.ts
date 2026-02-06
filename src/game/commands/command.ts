import { EntityType, EXTENDED_OFFSETS, BUILDING_UNIT_TYPE } from '../entity';
import { GameState } from '../game-state';
import { canPlaceBuildingFootprint, isPassable } from '../systems/placement';
import { restoreOriginalTerrain } from '../systems/terrain-leveling';
import { TerritoryMap } from '../buildings/territory';
import { MapSize } from '@/utilities/map-size';
import { Command, FORMATION_OFFSETS } from './command-types';

// Re-export Command type and related types for backward compatibility
export type { Command } from './command-types';
export type {
    PlaceBuildingCommand,
    SpawnUnitCommand,
    MoveUnitCommand,
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    MoveSelectedUnitsCommand,
    RemoveEntityCommand,
} from './command-types';
export {
    FORMATION_OFFSETS,
    isBuildingCommand,
    isUnitCommand,
    isSelectionCommand,
    isMovementCommand,
} from './command-types';

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
        // Delegate to the MovementSystem
        return state.movement.moveUnit(cmd.entityId, cmd.targetX, cmd.targetY);
    }

    case 'select': {
        // Respect selectable flag (undefined = selectable, false = not selectable)
        if (cmd.entityId !== null) {
            const ent = state.getEntity(cmd.entityId);
            if (ent && ent.selectable === false) {
                // Can't select unselectable entities - treat as deselect
                state.selectedEntityId = null;
                state.selectedEntityIds.clear();
                return true;
            }
        }
        state.selectedEntityId = cmd.entityId;
        state.selectedEntityIds.clear();
        if (cmd.entityId !== null) {
            state.selectedEntityIds.add(cmd.entityId);
        }
        return true;
    }

    case 'select_at_tile': {
        const rawEntity = state.getEntityAt(cmd.x, cmd.y);
        // Skip unselectable entities
        const entity = rawEntity?.selectable !== false ? rawEntity : undefined;
        if (cmd.addToSelection) {
            if (entity) {
                // Toggle: remove if already selected, add if not
                if (state.selectedEntityIds.has(entity.id)) {
                    state.selectedEntityIds.delete(entity.id);
                    if (state.selectedEntityId === entity.id) {
                        // Set primary to first remaining, or null
                        state.selectedEntityId = state.selectedEntityIds.size > 0
                            ? state.selectedEntityIds.values().next().value!
                            : null;
                    }
                } else {
                    state.selectedEntityIds.add(entity.id);
                    if (state.selectedEntityId === null) {
                        state.selectedEntityId = entity.id;
                    }
                }
            }
        } else {
            // Replace selection
            state.selectedEntityIds.clear();
            state.selectedEntityId = entity?.id ?? null;
            if (entity) {
                state.selectedEntityIds.add(entity.id);
            }
        }
        return true;
    }

    case 'toggle_selection': {
        const entity = state.getEntity(cmd.entityId);
        if (!entity || entity.selectable === false) return false;
        if (state.selectedEntityIds.has(cmd.entityId)) {
            state.selectedEntityIds.delete(cmd.entityId);
            if (state.selectedEntityId === cmd.entityId) {
                state.selectedEntityId = state.selectedEntityIds.size > 0
                    ? state.selectedEntityIds.values().next().value!
                    : null;
            }
        } else {
            state.selectedEntityIds.add(cmd.entityId);
            if (state.selectedEntityId === null) {
                state.selectedEntityId = cmd.entityId;
            }
        }
        return true;
    }

    case 'select_area': {
        const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
        const entities = allEntities.filter(e => e.selectable !== false);
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

    case 'move_selected_units': {
        // Move all selected units toward target with formation offsets
        const selectedUnits: number[] = [];
        for (const entityId of state.selectedEntityIds) {
            const e = state.getEntity(entityId);
            if (e && e.type === EntityType.Unit) {
                selectedUnits.push(entityId);
            }
        }
        if (selectedUnits.length === 0) return false;

        let anyMoved = false;
        for (let i = 0; i < selectedUnits.length; i++) {
            const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
            const targetX = cmd.targetX + offset[0];
            const targetY = cmd.targetY + offset[1];

            if (state.movement.moveUnit(selectedUnits[i], targetX, targetY)) {
                anyMoved = true;
            }
        }
        return anyMoved;
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
