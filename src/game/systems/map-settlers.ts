/**
 * Populates units (settlers) from map entity data.
 * Maps S4SettlerType to internal UnitType and creates unit entities with correct race.
 */

import { getUnitLevel } from '../entity';
import { Race } from '../race';
import { GameState } from '../game-state';
import { S4_TO_UNIT_TYPE } from '../game-data-access';
import { LogHandler } from '@/utilities/log-handler';
import type { MapSettlerData } from '@/resources/map/map-entity-data';
import { S4SettlerType } from '@/resources/map/s4-types';

const log = new LogHandler('Map:Settlers');

export interface PopulateMapSettlersOptions {
    /** Per-player race mapping (player index → Race) */
    playerRaces?: Map<number, Race>;
}

/**
 * Create unit entities from parsed map settler data.
 *
 * @returns Number of settlers successfully created
 */
export function populateMapSettlers(
    state: GameState,
    settlers: MapSettlerData[],
    options: PopulateMapSettlersOptions
): number {
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

        // Skip if tile is already occupied
        if (state.getEntityAt(settlerData.x, settlerData.y)) {
            log.debug(`Skipping settler at occupied tile (${settlerData.x}, ${settlerData.y})`);
            skipped++;
            continue;
        }

        const race = options.playerRaces?.get(settlerData.player);
        if (race === undefined) {
            throw new Error(
                `No race mapping for player ${settlerData.player} — playerRaces must be populated before spawning settlers`
            );
        }
        const entity = state.addUnit(unitType, settlerData.x, settlerData.y, settlerData.player, race);
        entity.level = getUnitLevel(unitType);

        created++;
    }

    if (skipped > 0) {
        log.debug(`Skipped ${skipped} settlers (unmapped types or occupied tiles)`);
    }

    return created;
}
