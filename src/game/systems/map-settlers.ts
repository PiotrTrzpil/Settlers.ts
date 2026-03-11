/**
 * Populates units (settlers) from map entity data.
 * Maps S4SettlerType to internal UnitType and creates unit entities with correct race.
 */

import { EntityType, getUnitLevel } from '../entity';
import { GameState } from '../game-state';
import { S4_TO_UNIT_TYPE } from '../data/game-data-access';
import { LogHandler } from '@/utilities/log-handler';
import type { EventBus } from '../event-bus';
import type { MapSettlerData } from '@/resources/map/map-entity-data';
import { S4SettlerType } from '@/resources/map/s4-types';

const log = new LogHandler('Map:Settlers');

/**
 * Create unit entities from parsed map settler data.
 *
 * @returns Number of settlers successfully created
 */
export function populateMapSettlers(state: GameState, settlers: MapSettlerData[], eventBus?: EventBus): number {
    let created = 0;
    let skipped = 0;

    for (const settlerData of settlers) {
        const unitType = S4_TO_UNIT_TYPE[settlerData.settlerType];
        if (unitType === undefined) {
            log.debug(
                `Skipping unmapped settler type: ${S4SettlerType[settlerData.settlerType]} at (${settlerData.x}, ${settlerData.y})`
            );
            skipped++;
            continue;
        }

        // Skip if tile is occupied by another unit.
        // Settlers placed inside building footprints are valid — they become workers.
        if (state.getUnitAt(settlerData.x, settlerData.y)) {
            log.debug(`Skipping settler at occupied tile (${settlerData.x}, ${settlerData.y})`);
            skipped++;
            continue;
        }

        // If placed on a building footprint, skip unit occupancy to preserve building's tile ownership
        const groundEntity = state.getGroundEntityAt(settlerData.x, settlerData.y);
        const onBuilding = groundEntity?.type === EntityType.Building;
        const entity = state.addUnit(unitType, settlerData.x, settlerData.y, settlerData.player, {
            occupancy: !onBuilding,
        });
        entity.level = getUnitLevel(unitType);

        // Register the unit with carrier/combat/task systems (same event as spawn_unit command)
        eventBus?.emit('unit:spawned', {
            unitId: entity.id,
            unitType,
            x: settlerData.x,
            y: settlerData.y,
            player: settlerData.player,
        });

        created++;
    }

    if (skipped > 0) {
        log.debug(`Skipped ${skipped} settlers (unmapped types or occupied tiles)`);
    }

    return created;
}
