/**
 * Parser for MapPlayerInformation chunk (type 2)
 * Extracts tribe, start position, and name for each player.
 *
 * Format: 45 bytes per player entry (uint32 LE fields):
 *   - tribe    (4 bytes) — S4Tribe enum value
 *   - startX   (4 bytes)
 *   - startY   (4 bytes)
 *   - name     (33 bytes) — null-terminated ASCII string
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4Tribe } from '../../s4-types';
import type { MapPlayerInfo } from '../../map-entity-data';

const log = new LogHandler('Map:Players');

/** Known entry size: 4 (tribe) + 4 (x) + 4 (y) + 33 (name) = 45 bytes */
const ENTRY_SIZE = 45;

/** Name field length in bytes */
const NAME_LENGTH = 33;

function validateTribe(value: number): S4Tribe {
    if (value >= S4Tribe.ROMAN && value <= S4Tribe.TROJAN) {
        return value as S4Tribe;
    }
    return S4Tribe.ROMAN;
}

/**
 * Parse MapPlayerInformation chunk data.
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Array of player info entries
 */
export function parsePlayerInformation(reader: BinaryReader): MapPlayerInfo[] {
    const players: MapPlayerInfo[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty player information chunk');
        return players;
    }

    if (dataLength % ENTRY_SIZE !== 0) {
        log.warn(`Player info chunk size ${dataLength} is not a multiple of ${ENTRY_SIZE} — format may differ`);
    }

    const entryCount = Math.floor(dataLength / ENTRY_SIZE);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const tribe = validateTribe(reader.readInt());
        const startX = reader.readInt();
        const startY = reader.readInt();
        const name = reader.readString(NAME_LENGTH).replaceAll('\0', '');

        const hasValidPos = startX > 0 && startY > 0 && startX < 10000 && startY < 10000;

        const playerIndex = i + 1;

        players.push({
            playerIndex,
            tribe,
            startX: hasValidPos ? startX : undefined,
            startY: hasValidPos ? startY : undefined,
        });

        const nameStr = name ? `, name="${name}"` : '';
        log.debug(`Player ${playerIndex}: tribe=${S4Tribe[tribe]}, pos=(${startX}, ${startY})${nameStr}`);
    }

    log.debug(`Parsed ${players.length} player entries`);
    return players;
}
