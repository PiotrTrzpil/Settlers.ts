/**
 * Parser for MapSettlers chunk (type 7)
 * Extracts starting settler data from map files
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4SettlerType } from '../../s4-types';
import type { MapSettlerData } from '../../map-entity-data';

const log = new LogHandler('SettlerParser');

/**
 * Parse MapSettlers chunk data
 *
 * Expected format (estimated based on S4ModApi):
 * - 8 bytes per settler entry
 * - Entry: x (2 bytes), y (2 bytes), type (2 bytes), player (1 byte), flags (1 byte)
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Array of settler data entries
 */
export function parseSettlers(reader: BinaryReader): MapSettlerData[] {
    const settlers: MapSettlerData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty settlers chunk');
        return settlers;
    }

    // Estimate entry size - try 8 bytes first (most common for entity data)
    const possibleEntrySizes = [8, 12, 10, 6];
    let entrySize = 8;

    for (const size of possibleEntrySizes) {
        if (dataLength % size === 0) {
            entrySize = size;
            break;
        }
    }

    const entryCount = Math.floor(dataLength / entrySize);

    log.debug(`Parsing settlers: ${dataLength} bytes, ${entryCount} entries (${entrySize} bytes each)`);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        // Read coordinates as little-endian words
        const x = reader.readWordBE();
        const y = reader.readWordBE();

        // Read settler type
        let settlerType: number;
        if (entrySize >= 8) {
            settlerType = reader.readWordBE();
        } else {
            settlerType = reader.readByte();
        }

        // Read player
        const player = reader.readByte();

        // Skip remaining bytes in entry
        const bytesRead = reader.getOffset() - startPos;
        for (let j = bytesRead; j < entrySize; j++) {
            reader.readByte();
        }

        // Validate settler type
        if (!isValidSettlerType(settlerType)) {
            log.debug(`Skipping invalid settler type ${settlerType} at (${x}, ${y})`);
            continue;
        }

        // Validate coordinates (basic sanity check)
        if (x > 10000 || y > 10000) {
            log.debug(`Skipping settler with suspicious coordinates (${x}, ${y})`);
            continue;
        }

        settlers.push({
            x,
            y,
            settlerType: settlerType as S4SettlerType,
            player,
        });

        log.debug(`  Settler at (${x}, ${y}): type=${S4SettlerType[settlerType] ?? settlerType}, player=${player}`);

        // Safety check
        if (reader.getOffset() === startPos) {
            log.error('Parser stuck, breaking');
            break;
        }
    }

    log.debug(`Parsed ${settlers.length} settler entries`);
    return settlers;
}

/**
 * Check if settler type value is valid
 */
function isValidSettlerType(value: number): boolean {
    // Valid settler types are 1-66 (see S4SettlerType enum)
    // Also accept 0 as NONE
    return value >= 0 && value <= 66;
}
