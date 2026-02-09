/**
 * Parser for MapBuildings chunk (type 8)
 * Extracts starting building data from map files
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4BuildingType } from '../../s4-types';
import type { MapBuildingData } from '../../map-entity-data';

const log = new LogHandler('BuildingParser');

/**
 * Parse MapBuildings chunk data
 *
 * Expected format (estimated based on S4ModApi):
 * - 8 bytes per building entry
 * - Entry: x (2 bytes), y (2 bytes), type (2 bytes), player (1 byte), flags (1 byte)
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

    log.debug(`Parsing buildings: ${dataLength} bytes, ${entryCount} entries (${entrySize} bytes each)`);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        // Read coordinates as little-endian words
        const x = reader.readWordBE();
        const y = reader.readWordBE();

        // Read building type
        let buildingType: number;
        if (entrySize >= 8) {
            buildingType = reader.readWordBE();
        } else {
            buildingType = reader.readByte();
        }

        // Read player
        const player = reader.readByte();

        // Skip remaining bytes in entry
        const bytesRead = reader.getOffset() - startPos;
        for (let j = bytesRead; j < entrySize; j++) {
            reader.readByte();
        }

        // Validate building type
        if (!isValidBuildingType(buildingType)) {
            log.debug(`Skipping invalid building type ${buildingType} at (${x}, ${y})`);
            continue;
        }

        // Validate coordinates (basic sanity check)
        if (x > 10000 || y > 10000) {
            log.debug(`Skipping building with suspicious coordinates (${x}, ${y})`);
            continue;
        }

        buildings.push({
            x,
            y,
            buildingType: buildingType as S4BuildingType,
            player,
        });

        log.debug(`  Building at (${x}, ${y}): type=${S4BuildingType[buildingType] ?? buildingType}, player=${player}`);

        // Safety check
        if (reader.getOffset() === startPos) {
            log.error('Parser stuck, breaking');
            break;
        }
    }

    log.debug(`Parsed ${buildings.length} building entries`);
    return buildings;
}

/**
 * Check if building type value is valid
 */
function isValidBuildingType(value: number): boolean {
    // Valid building types are 1-82 (see S4BuildingType enum)
    // Also accept 0 as NONE
    return value >= 0 && value <= 82;
}
