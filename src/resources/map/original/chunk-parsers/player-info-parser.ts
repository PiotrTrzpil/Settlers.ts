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
 * Determine entry size from data length
 */
function determineEntrySize(dataLength: number): number {
    const possibleEntrySizes = [8, 12, 4, 2];
    for (const size of possibleEntrySizes) {
        if (dataLength % size === 0 && dataLength / size <= 8) {
            return size;
        }
    }
    return 8;
}

/**
 * Skip remaining bytes in entry to align reader
 */
function skipRemainingBytes(reader: BinaryReader, bytesRead: number, entrySize: number): void {
    for (let j = bytesRead; j < entrySize; j++) {
        reader.readByte();
    }
}

/**
 * Validate tribe value and clamp to valid range
 */
function validateTribe(value: number): S4Tribe {
    if (value >= S4Tribe.ROMAN && value <= S4Tribe.TROJAN) {
        return value as S4Tribe;
    }
    return S4Tribe.ROMAN;
}

/**
 * Parse 8+ byte format entry (with coordinates)
 */
function parse8ByteEntry(reader: BinaryReader, entrySize: number): MapPlayerInfo {
    const x = reader.readWord();
    const y = reader.readWord();
    const tribeValue = reader.readByte();
    const playerIndex = reader.readByte();

    skipRemainingBytes(reader, 6, entrySize);

    const tribe = validateTribe(tribeValue);
    const hasValidPos = x > 10 && y > 10 && x < 10000 && y < 10000;

    return {
        playerIndex,
        tribe,
        startX: hasValidPos ? x : undefined,
        startY: hasValidPos ? y : undefined,
    };
}

/**
 * Parse 4 byte format entry (index, tribe, padding)
 */
function parse4ByteEntry(reader: BinaryReader, entrySize: number): MapPlayerInfo {
    const playerIndex = reader.readByte();
    const tribeValue = reader.readByte();

    skipRemainingBytes(reader, 2, entrySize);

    return {
        playerIndex,
        tribe: validateTribe(tribeValue),
    };
}

/**
 * Parse 2 byte format entry (index, tribe)
 */
function parse2ByteEntry(reader: BinaryReader): MapPlayerInfo {
    const playerIndex = reader.readByte();
    const tribeValue = reader.readByte();

    return {
        playerIndex,
        tribe: validateTribe(tribeValue),
    };
}

/**
 * Parse 1 byte format entry (just tribe, index implied)
 */
function parse1ByteEntry(reader: BinaryReader, index: number): MapPlayerInfo {
    const tribeValue = reader.readByte();

    return {
        playerIndex: index,
        tribe: validateTribe(tribeValue),
    };
}

/**
 * Parse MapPlayerInformation chunk data
 *
 * Format varies by map type. Common formats:
 * - 8 bytes per player: x (2 bytes), y (2 bytes), tribe (1 byte), player (1 byte), padding (2 bytes)
 * - 4 bytes per player: player (1 byte), tribe (1 byte), padding (2 bytes)
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

    const entrySize = determineEntrySize(dataLength);
    const entryCount = Math.floor(dataLength / entrySize);

    log.debug(`Parsing player info: ${dataLength} bytes, ${entryCount} entries (${entrySize} bytes each)`);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        if (entrySize >= 8) {
            players.push(parse8ByteEntry(reader, entrySize));
        } else if (entrySize >= 4) {
            players.push(parse4ByteEntry(reader, entrySize));
        } else if (entrySize === 2) {
            players.push(parse2ByteEntry(reader));
        } else {
            players.push(parse1ByteEntry(reader, i));
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
