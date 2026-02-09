/**
 * Parser for MapPlayerInformation chunk (type 2)
 * Extracts tribe assignment for each player
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4Tribe } from '../../s4-types';
import type { MapPlayerInfo } from '../../map-entity-data';

const log = new LogHandler('PlayerInfoParser');

/**
 * Parse MapPlayerInformation chunk data
 *
 * Expected format (estimated based on S4ModApi):
 * - 4 bytes per player entry
 * - Each entry: player index (1 byte) + tribe (1 byte) + padding (2 bytes)
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

    // Try to determine entry size from data length
    // Common player counts: 1-8 players
    // Try 4-byte entries first (most likely)
    const possibleEntrySizes = [4, 8, 2];
    let entrySize = 4;

    for (const size of possibleEntrySizes) {
        if (dataLength % size === 0 && dataLength / size <= 8) {
            entrySize = size;
            break;
        }
    }

    const entryCount = Math.floor(dataLength / entrySize);

    log.debug(`Parsing player info: ${dataLength} bytes, ${entryCount} entries (${entrySize} bytes each)`);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        if (entrySize >= 4) {
            // 4+ byte format: index, tribe, padding
            const playerIndex = reader.readByte();
            const tribeValue = reader.readByte();

            // Skip remaining bytes in entry
            for (let j = 2; j < entrySize; j++) {
                reader.readByte();
            }

            // Validate tribe value
            const tribe = validateTribe(tribeValue);

            players.push({
                playerIndex,
                tribe,
            });

            log.debug(`  Player ${playerIndex}: tribe=${S4Tribe[tribe]} (${tribeValue})`);
        } else if (entrySize === 2) {
            // 2 byte format: index, tribe
            const playerIndex = reader.readByte();
            const tribeValue = reader.readByte();
            const tribe = validateTribe(tribeValue);

            players.push({
                playerIndex,
                tribe,
            });
        } else {
            // 1 byte format: just tribe, index implied
            const tribeValue = reader.readByte();
            const tribe = validateTribe(tribeValue);

            players.push({
                playerIndex: i,
                tribe,
            });
        }

        // Safety check
        if (reader.getOffset() === startPos) {
            log.error('Parser stuck, breaking');
            break;
        }
    }

    log.debug(`Parsed ${players.length} player entries`);
    return players;
}

/**
 * Validate tribe value and clamp to valid range
 */
function validateTribe(value: number): S4Tribe {
    if (value >= S4Tribe.ROMAN && value <= S4Tribe.TROJAN) {
        return value as S4Tribe;
    }
    log.debug(`Unknown tribe value ${value}, defaulting to ROMAN`);
    return S4Tribe.ROMAN;
}
