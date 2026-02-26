/**
 * Parser for MapQuestText (type 11) and MapQuestTip (type 12) chunks.
 * Extracts null-terminated quest/mission strings.
 */

import { BinaryReader } from '@/resources/file/binary-reader';

/**
 * Parse a quest text chunk (type 11 or 12).
 *
 * The chunk contains a null-terminated string, possibly with trailing padding.
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns The parsed text string
 */
export function parseQuestText(reader: BinaryReader): string {
    const dataLength = reader.length;
    if (dataLength === 0) {
        return '';
    }

    const text = reader.readString(dataLength).replaceAll('\0', '').trim();

    return text;
}
