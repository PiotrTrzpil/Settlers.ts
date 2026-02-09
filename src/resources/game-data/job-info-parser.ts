/**
 * Parser for jobInfo.xml
 */

import { LogHandler } from '@/utilities/log-handler';
import type { RaceId, RaceJobData, JobInfo, JobNode } from './types';
import { parseXML, getChildText, getChildNumber } from './xml-utils';

const log = new LogHandler('JobInfoParser');

function parseJobNode(nodeEl: Element): JobNode {
    return {
        task: getChildText(nodeEl, 'task'),
        jobPart: getChildText(nodeEl, 'jobPart'),
        x: getChildNumber(nodeEl, 'x'),
        y: getChildNumber(nodeEl, 'y'),
        duration: getChildNumber(nodeEl, 'duration'),
        dir: getChildNumber(nodeEl, 'dir', -1),
        forward: getChildNumber(nodeEl, 'forward', 1),
        visible: getChildNumber(nodeEl, 'visible', 1),
    };
}

function parseJob(jobEl: Element): JobInfo {
    const id = jobEl.getAttribute('id') ?? '';
    const nodes: JobNode[] = [];

    const nodeElements = jobEl.getElementsByTagName('node');
    for (let i = 0; i < nodeElements.length; i++) {
        nodes.push(parseJobNode(nodeElements[i]));
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
        const raceEl = raceElements[i];
        const raceId = raceEl.getAttribute('id') as RaceId;
        if (!raceId) continue;

        const jobs = new Map<string, JobInfo>();
        const jobElements = raceEl.getElementsByTagName('job');

        for (let j = 0; j < jobElements.length; j++) {
            const job = parseJob(jobElements[j]);
            jobs.set(job.id, job);
        }

        result.set(raceId, { jobs });
        log.debug(`Parsed ${jobs.size} jobs for ${raceId}`);
    }

    return result;
}
