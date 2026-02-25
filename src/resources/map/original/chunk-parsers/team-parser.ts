/**
 * Parser for MapTeamInformation chunk (type 3)
 * Extracts team/alliance assignments per player.
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import type { MapTeamData } from '../../map-entity-data';

const log = new LogHandler('Map:Teams');

/**
 * Parse MapTeamInformation chunk data.
 *
 * Format: one byte per player slot indicating team assignment.
 *
 * @param reader BinaryReader positioned at start of chunk data
 * @returns Team assignment data
 */
export function parseTeamInformation(reader: BinaryReader): MapTeamData {
    const dataLength = reader.length;
    const teamAssignments: number[] = [];

    for (let i = 0; i < dataLength && !reader.eof(); i++) {
        teamAssignments.push(reader.readByte());
    }

    log.debug(`Parsed ${teamAssignments.length} team assignments: [${teamAssignments.join(', ')}]`);

    return { teamAssignments };
}
