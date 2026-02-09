/**
 * Parser for MapStacks chunk (type 9)
 * Extracts starting resource pile data from map files
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4GoodType } from '../../s4-types';
import type { MapStackData } from '../../map-entity-data';

const log = new LogHandler('StackParser');

/** Maximum valid coordinate value */
const MAX_COORDINATE = 10000;

/** Valid good type range */
const MAX_GOOD_TYPE = 42;

/**
 * Determine entry size from data length
 */
function determineEntrySize(dataLength: number): number {
    const possibleEntrySizes = [8, 6, 10, 12];
    for (const size of possibleEntrySizes) {
        if (dataLength % size === 0) {
            return size;
        }
    }
    return 8;
}

/**
 * Read material type and amount from entry
 */
function readMaterialAndAmount(reader: BinaryReader, entrySize: number): { materialType: number; amount: number } {
    const materialType = reader.readByte();
    const amount = entrySize >= 6 ? reader.readByte() : 1;
    return { materialType, amount };
}

/**
 * Skip remaining bytes in entry to align reader
 */
function skipRemainingBytes(reader: BinaryReader, startPos: number, entrySize: number): void {
    const bytesRead = reader.getOffset() - startPos;
    for (let j = bytesRead; j < entrySize; j++) {
        reader.readByte();
    }
}

/**
 * Validate stack entry data
 */
function isValidStackEntry(x: number, y: number, materialType: number, amount: number): boolean {
    if (x > MAX_COORDINATE || y > MAX_COORDINATE) return false;
    if (materialType < 0 || materialType > MAX_GOOD_TYPE) return false;
    if (amount === 0 || amount > 255) return false;
    return true;
}

/**
 * Parse MapStacks chunk data
 *
 * Expected format (estimated based on S4ModApi):
 * - 8 bytes per stack entry
 * - Entry: x (2 bytes), y (2 bytes), type (1 byte), amount (1 byte), padding (2 bytes)
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Array of stack data entries
 */
export function parseStacks(reader: BinaryReader): MapStackData[] {
    const stacks: MapStackData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty stacks chunk');
        return stacks;
    }

    const entrySize = determineEntrySize(dataLength);
    const entryCount = Math.floor(dataLength / entrySize);

    log.debug(`Parsing stacks: ${dataLength} bytes, ${entryCount} entries (${entrySize} bytes each)`);

    for (let i = 0; i < entryCount && !reader.eof(); i++) {
        const startPos = reader.getOffset();

        const x = reader.readWordBE();
        const y = reader.readWordBE();
        const { materialType, amount } = readMaterialAndAmount(reader, entrySize);

        skipRemainingBytes(reader, startPos, entrySize);

        if (!isValidStackEntry(x, y, materialType, amount)) continue;

        stacks.push({
            x,
            y,
            materialType: materialType as S4GoodType,
            amount,
        });

        if (reader.getOffset() === startPos) {
            log.error('Parser stuck, breaking');
            break;
        }
    }

    log.debug(`Parsed ${stacks.length} stack entries`);
    return stacks;
}
