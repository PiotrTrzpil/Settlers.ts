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
import type { MapObjectData } from '../../map-entity-data';

const log = new LogHandler('Map:Objects');

/**
 * Parse MapObjects chunk data.
 * Returns ALL non-zero object types (trees 1-18, decorations >18).
 */
export function parseMapObjects(reader: BinaryReader, mapWidth: number, mapHeight: number): MapObjectData[] {
    const objects: MapObjectData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty map objects chunk');
        return objects;
    }

    const tileCount = mapWidth * mapHeight;
    const data = reader.getBuffer();
    const bytesPerTile = dataLength / tileCount;

    if (bytesPerTile === 4) {
        // 4 bytes per tile (interleaved format)
        for (let i = 0; i < tileCount; i++) {
            const objectType = data[i * 4]!; // Byte 0 = object type
            if (objectType !== 0) {
                objects.push({
                    x: i % mapWidth,
                    y: Math.floor(i / mapWidth),
                    objectType,
                });
            }
        }
    } else if (bytesPerTile === 1) {
        // 1 byte per tile format
        for (let i = 0; i < tileCount; i++) {
            const objectType = data[i]!;
            if (objectType !== 0) {
                objects.push({
                    x: i % mapWidth,
                    y: Math.floor(i / mapWidth),
                    objectType,
                });
            }
        }
    } else {
        log.debug(`Unknown format: ${bytesPerTile} bytes/tile`);
    }

    return objects;
}
