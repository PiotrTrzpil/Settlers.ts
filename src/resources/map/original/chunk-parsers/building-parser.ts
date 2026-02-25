/**
 * Parser for MapBuildings chunk (type 8)
 * Extracts starting building data from map files
 *
 * Binary format (20 bytes per entry):
 *   Bytes 0-1:  x position (uint16 LE)
 *   Bytes 2-3:  y position (uint16 LE)
 *   Byte  4:    building type (S4BuildingType)
 *   Byte  5:    player index
 *   Bytes 6-19: flags/extra data (unknown, skipped)
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4BuildingType } from '../../s4-types';
import type { MapBuildingData } from '../../map-entity-data';

const log = new LogHandler('Map:Buildings');

/** Bytes per building entry in the chunk */
const ENTRY_SIZE = 20;

/**
 * Parse MapBuildings chunk data
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Array of building data entries
 */
export function parseBuildings(reader: BinaryReader): MapBuildingData[] {
    const buildings: MapBuildingData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty buildings chunk');
        return buildings;
    }

    const entryCount = Math.floor(dataLength / ENTRY_SIZE);
    const remainder = dataLength % ENTRY_SIZE;

    log.debug(`Parsing buildings: ${dataLength} bytes, ${entryCount} entries (${ENTRY_SIZE} bytes each)`);
    if (remainder !== 0) {
        log.debug(`Warning: ${remainder} trailing bytes after entries`);
    }

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        const x = reader.readWord();
        const y = reader.readWord();
        const buildingType = reader.readByte();
        const player = reader.readByte();

        // Skip remaining 14 bytes of the entry
        const bytesRead = reader.getOffset() - startPos;
        for (let j = bytesRead; j < ENTRY_SIZE; j++) {
            reader.readByte();
        }

        // Skip empty/padding entries
        if (x === 0 && y === 0 && buildingType === 0) {
            continue;
        }

        if (!isValidBuildingType(buildingType)) {
            log.debug(`Skipping invalid building type ${buildingType} at (${x}, ${y})`);
            continue;
        }

        if (x > 10000 || y > 10000) {
            log.debug(`Skipping out-of-bounds building at (${x}, ${y})`);
            continue;
        }

        buildings.push({
            x,
            y,
            buildingType: buildingType as S4BuildingType,
            player,
        });
    }

    log.debug(`Parsed ${buildings.length} building entries`);
    return buildings;
}

/**
 * Check if building type value is valid
 */
function isValidBuildingType(value: number): boolean {
    // Valid building types are 1-82 (see S4BuildingType enum)
    return value >= 1 && value <= 82;
}
