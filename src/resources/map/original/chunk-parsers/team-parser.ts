/**
 * Parser for MapTeamInformation chunk (type 3)
 * Extracts team/alliance assignments per player.
 *
 * Format: 34 bytes reserved (zeros) + 1 byte per player slot (team ID).
 * Team IDs group players into alliances (same team ID = allies).
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import type { MapTeamData } from '../../map-entity-data';

const log = new LogHandler('Map:Teams');

/** Fixed header/padding size before the per-player team bytes */
const HEADER_SIZE = 34;

/**
 * Parse MapTeamInformation chunk data.
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Team assignment data (1-indexed: teamAssignments[0] = player 1's team)
 */
export function parseTeamInformation(reader: BinaryReader): MapTeamData {
    const dataLength = reader.length;

    if (dataLength <= HEADER_SIZE) {
        log.debug(`Team chunk too small (${dataLength} bytes), no team data`);
        return { teamAssignments: [] };
    }

    // Skip the 34-byte reserved header
    for (let i = 0; i < HEADER_SIZE; i++) {
        reader.readByte();
    }

    const playerCount = dataLength - HEADER_SIZE;
    const teamAssignments: number[] = [];

    for (let i = 0; i < playerCount && !reader.eof(); i++) {
        teamAssignments.push(reader.readByte());
    }

    return { teamAssignments };
}
