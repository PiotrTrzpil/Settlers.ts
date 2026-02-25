/**
 * Parser for MapSettlers chunk (type 7)
 * Extracts starting settler data from map files
 *
 * Binary format (12 bytes per entry):
 *   Bytes 0-1:  x position (uint16 LE)
 *   Bytes 2-3:  y position (uint16 LE)
 *   Byte  4:    settler type (S4SettlerType)
 *   Byte  5:    player index
 *   Bytes 6-11: flags/extra data (unknown, skipped)
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4SettlerType } from '../../s4-types';
import type { MapSettlerData } from '../../map-entity-data';

const log = new LogHandler('Map:Settlers');

/** Bytes per settler entry in the chunk */
const ENTRY_SIZE = 12;

/**
 * Parse MapSettlers chunk data
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

    const entryCount = Math.floor(dataLength / ENTRY_SIZE);
    const remainder = dataLength % ENTRY_SIZE;

    log.debug(`Parsing settlers: ${dataLength} bytes, ${entryCount} entries (${ENTRY_SIZE} bytes each)`);
    if (remainder !== 0) {
        log.debug(`Warning: ${remainder} trailing bytes after entries`);
    }

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        const x = reader.readWord();
        const y = reader.readWord();
        const settlerType = reader.readByte();
        const player = reader.readByte();

        // Skip remaining 6 bytes
        const bytesRead = reader.getOffset() - startPos;
        for (let j = bytesRead; j < ENTRY_SIZE; j++) {
            reader.readByte();
        }

        // Skip empty/padding entries
        if (x === 0 && y === 0 && settlerType === 0) {
            continue;
        }

        if (!isValidSettlerType(settlerType)) {
            continue;
        }

        if (x > 10000 || y > 10000) {
            continue;
        }

        settlers.push({
            x,
            y,
            settlerType: settlerType as S4SettlerType,
            player,
        });
    }

    log.debug(`Parsed ${settlers.length} settler entries`);
    return settlers;
}

/**
 * Check if settler type value is valid
 */
function isValidSettlerType(value: number): boolean {
    // Valid settler types are 1-66 (see S4SettlerType enum)
    return value >= 1 && value <= 66;
}
