/**
 * Parser for jobInfo.xml
 */

import type { RaceId, RaceJobData, JobInfo, JobNode } from './types';
import { parseXML, getChildText, getChildNumber, getChildBool } from './xml-utils';

function parseJobNode(nodeEl: Element): JobNode {
    return {
        task: getChildText(nodeEl, 'task').replace('CEntityTask::', ''),
        jobPart: getChildText(nodeEl, 'jobPart'),
        x: getChildNumber(nodeEl, 'x'),
        y: getChildNumber(nodeEl, 'y'),
        duration: getChildNumber(nodeEl, 'duration'),
        dir: getChildNumber(nodeEl, 'dir', -1),
        forward: getChildNumber(nodeEl, 'forward', 1),
        visible: getChildNumber(nodeEl, 'visible', 1),
        useWork: getChildBool(nodeEl, 'useWork', true),
        entity: getChildText(nodeEl, 'entity'),
        trigger: getChildText(nodeEl, 'trigger'),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// XML data fix: jobPart / entity material mismatch
//
// The original jobInfo.xml has a bug in JOB_SMELTERIRON_WORK:
//   <jobPart>SME_PICKUP_GOLDORE</jobPart>  +  <entity>GOOD_IRONORE</entity>
//
// The jobPart says GOLDORE but the entity is IRONORE. Our resolver derives
// the pickup/carry animation from the jobPart suffix, so this mismatch causes
// the wrong animation to play. We fix the jobPart at parse time to match the
// entity, since the entity field is authoritative (it's what the game actually
// picks up / puts down).
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_PREFIX = 'GOOD_';

/** Material-bearing suffixes in jobPart names: PICKUP_X, WALK_X, DROP_X */
const MATERIAL_ACTION_PREFIXES = ['PICKUP_', 'WALK_', 'DROP_'] as const;

/**
 * If a node has a GOOD_* entity and the jobPart contains a material suffix
 * that doesn't match the entity, correct the jobPart to match.
 */
function fixJobPartEntityMismatch(node: JobNode, jobId: string): void {
    if (!node.entity.startsWith(GOOD_PREFIX)) return;

    const entityMaterial = node.entity.slice(GOOD_PREFIX.length); // e.g., 'IRONORE'
    const underscoreIdx = node.jobPart.indexOf('_');
    if (underscoreIdx === -1) return;

    const prefix = node.jobPart.slice(0, underscoreIdx + 1); // e.g., 'SME_'
    const action = node.jobPart.slice(underscoreIdx + 1); // e.g., 'PICKUP_GOLDORE'

    for (const actionPrefix of MATERIAL_ACTION_PREFIXES) {
        if (!action.startsWith(actionPrefix)) continue;
        const jobPartMaterial = action.slice(actionPrefix.length); // e.g., 'GOLDORE'
        if (jobPartMaterial && jobPartMaterial !== entityMaterial) {
            const fixed = `${prefix}${actionPrefix}${entityMaterial}`;
            console.info(
                `[jobInfo fix] ${jobId}: corrected jobPart '${node.jobPart}' → '${fixed}' ` +
                    `(entity says ${node.entity})`
            );
            node.jobPart = fixed;
        }
        return;
    }
}

function parseJob(jobEl: Element): JobInfo {
    const id = jobEl.getAttribute('id') ?? '';
    const nodes: JobNode[] = [];

    const nodeElements = jobEl.getElementsByTagName('node');
    for (let i = 0; i < nodeElements.length; i++) {
        const node = parseJobNode(nodeElements[i]!);
        fixJobPartEntityMismatch(node, id);
        nodes.push(node);
    }

    return { id, nodes };
}

/**
 * Parse jobInfo.xml content into job data per race.
 */
export function parseJobInfo(xmlContent: string): Map<RaceId, RaceJobData> {
    const doc = parseXML(xmlContent);
    const result = new Map<RaceId, RaceJobData>();

    const raceElements = doc.getElementsByTagName('race');
    for (let i = 0; i < raceElements.length; i++) {
        const raceEl = raceElements[i]!;
        const raceId = raceEl.getAttribute('id') as RaceId;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getAttribute may return null despite cast
        if (!raceId) continue;

        const jobs = new Map<string, JobInfo>();
        const jobElements = raceEl.getElementsByTagName('job');

        for (let j = 0; j < jobElements.length; j++) {
            const job = parseJob(jobElements[j]!);
            jobs.set(job.id, job);
        }

        result.set(raceId, { jobs });
    }

    return result;
}
