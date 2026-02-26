/**
 * Populates units (settlers) from map entity data.
 * Maps S4SettlerType to internal UnitType and creates unit entities with correct race.
 */

import { EntityType, UnitType } from '../entity';
import { Race } from '../race';
import { GameState } from '../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { MapSettlerData } from '@/resources/map/map-entity-data';
import { S4SettlerType } from '@/resources/map/s4-types';

const log = new LogHandler('Map:Settlers');

/**
 * Mapping from S4SettlerType to internal UnitType.
 * Only includes types that are implemented in the engine.
 */
const S4_TO_UNIT_TYPE: Partial<Record<S4SettlerType, UnitType>> = {
    [S4SettlerType.CARRIER]: UnitType.Carrier,
    [S4SettlerType.BUILDER]: UnitType.Builder,
    [S4SettlerType.WOODCUTTER]: UnitType.Woodcutter,
    [S4SettlerType.STONECUTTER]: UnitType.Stonecutter,
    [S4SettlerType.FORESTER]: UnitType.Forester,
    [S4SettlerType.SWORDSMAN_01]: UnitType.Swordsman,
    [S4SettlerType.SWORDSMAN_02]: UnitType.Swordsman,
    [S4SettlerType.SWORDSMAN_03]: UnitType.Swordsman,
    [S4SettlerType.BOWMAN_01]: UnitType.Bowman,
    [S4SettlerType.BOWMAN_02]: UnitType.Bowman,
    [S4SettlerType.BOWMAN_03]: UnitType.Bowman,
    [S4SettlerType.PRIEST]: UnitType.Priest,
    [S4SettlerType.PIONEER]: UnitType.Pioneer,
    [S4SettlerType.THIEF]: UnitType.Thief,
    [S4SettlerType.GEOLOGIST]: UnitType.Geologist,
    [S4SettlerType.SMITH]: UnitType.Smith,
    [S4SettlerType.SQUADLEADER]: UnitType.SquadLeader,
    [S4SettlerType.DARKGARDENER]: UnitType.DarkGardener,
    [S4SettlerType.SHAMAN]: UnitType.Shaman,
    [S4SettlerType.MEDIC_01]: UnitType.Medic,
    [S4SettlerType.MEDIC_02]: UnitType.Medic,
    [S4SettlerType.MEDIC_03]: UnitType.Medic,
    [S4SettlerType.MINEWORKER]: UnitType.Miner,
    [S4SettlerType.SMELTER]: UnitType.Smelter,
    [S4SettlerType.HUNTER]: UnitType.Hunter,
    [S4SettlerType.HEALER]: UnitType.Healer,
    [S4SettlerType.DONKEY]: UnitType.Donkey,
    [S4SettlerType.SAWMILLWORKER]: UnitType.SawmillWorker,
    // Farming
    [S4SettlerType.FARMERGRAIN]: UnitType.Farmer,
    [S4SettlerType.AGAVEFARMER]: UnitType.AgaveFarmer,
    [S4SettlerType.BEEKEEPER]: UnitType.Beekeeper,
    // Dark Tribe specific
    [S4SettlerType.MUSHROOMFARMER]: UnitType.MushroomFarmer,
    [S4SettlerType.ANGEL_01]: UnitType.Angel,
    [S4SettlerType.ANGEL_02]: UnitType.Angel,
    [S4SettlerType.ANGEL_03]: UnitType.Angel,
};

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

        const entity = state.addEntity(EntityType.Unit, unitType, settlerData.x, settlerData.y, settlerData.player);
        const race = options.playerRaces?.get(settlerData.player);
        if (race === undefined) {
            throw new Error(
                `No race mapping for player ${settlerData.player} — playerRaces must be populated before spawning settlers`
            );
        }
        entity.race = race;

        created++;
    }

    if (skipped > 0) {
        log.debug(`Skipped ${skipped} settlers (unmapped types or occupied tiles)`);
    }

    return created;
}
