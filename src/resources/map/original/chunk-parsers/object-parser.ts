/**
 * Parser for MapObjects chunk (type 6)
 * Extracts map object data (trees, decorations) from map files
 *
 * Format: 4 bytes per tile (interleaved)
 * - Byte 0: Object type (tree type 1-18, or decoration type >18)
 * - Byte 1: Zone/biome ID (not used for trees)
 * - Byte 2: Flags (1=empty, 64/65=has object)
 * - Byte 3: Unknown
 *
 * Confirmed via CLI analysis: INTRLV_B0 gives correct trees with 0% on water.
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4TreeType } from '../../s4-types';
import type { MapObjectData } from '../../map-entity-data';

const log = new LogHandler('ObjectParser');

/**
 * Parse MapObjects chunk data
 */
export function parseMapObjects(
    reader: BinaryReader,
    mapWidth: number,
    mapHeight: number
): MapObjectData[] {
    const objects: MapObjectData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty map objects chunk');
        return objects;
    }

    const tileCount = mapWidth * mapHeight;
    const data = reader.getBuffer();
    const bytesPerTile = dataLength / tileCount;

    log.debug(`MapObjects: ${dataLength} bytes, ${mapWidth}x${mapHeight} map, ${bytesPerTile} bytes/tile`);

    if (bytesPerTile === 4) {
        // 4 bytes per tile (interleaved format)
        // Use byte 0 which contains tree type (confirmed via terrain analysis)
        for (let i = 0; i < tileCount; i++) {
            const objectType = data[i * 4]; // Byte 0 = object type
            if (objectType >= S4TreeType.OAK && objectType <= S4TreeType.OLIVE_SMALL) {
                objects.push({
                    x: i % mapWidth,
                    y: Math.floor(i / mapWidth),
                    objectType: objectType as S4TreeType,
                });
            }
        }
    } else if (bytesPerTile === 1) {
        // 1 byte per tile format
        for (let i = 0; i < tileCount; i++) {
            const objectType = data[i];
            if (objectType >= S4TreeType.OAK && objectType <= S4TreeType.OLIVE_SMALL) {
                objects.push({
                    x: i % mapWidth,
                    y: Math.floor(i / mapWidth),
                    objectType: objectType as S4TreeType,
                });
            }
        }
    } else {
        log.debug(`Unknown format: ${bytesPerTile} bytes/tile`);
    }

    log.debug(`Parsed ${objects.length} map objects (trees)`);
    return objects;
}
