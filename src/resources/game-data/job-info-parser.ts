/**
 * Parser for jobInfo.xml
 *
 * Parses the raw XML into typed JobInfo/JobNode structures per race,
 * applying data fixes from {@link ./job-info-fixes} at parse time.
 */

import type { RaceId, RaceJobData, JobInfo, JobNode } from './types';
import { parseXML, getChildText, getChildNumber, getChildBool } from './xml-utils';
import { applyNodeFixes, applyJobFixes } from './job-info-fixes';

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

function parseJob(jobEl: Element, raceId: RaceId): JobInfo {
    const id = jobEl.getAttribute('id') ?? '';
    const nodes: JobNode[] = [];

    const nodeElements = jobEl.getElementsByTagName('node');
    for (let i = 0; i < nodeElements.length; i++) {
        const node = parseJobNode(nodeElements[i]!);
        applyNodeFixes(node);
        nodes.push(node);
    }

    applyJobFixes(id, nodes, raceId);

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
        if (!raceId) {
            continue;
        }

        const jobs = new Map<string, JobInfo>();
        const jobElements = raceEl.getElementsByTagName('job');

        for (let j = 0; j < jobElements.length; j++) {
            const job = parseJob(jobElements[j]!, raceId);
            jobs.set(job.id, job);
        }

        result.set(raceId, { jobs });
    }

    return result;
}
