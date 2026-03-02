/**
 * Choreography structure verification tests (parsed from real XML data).
 *
 * Parses actual jobInfo.xml from the game assets directory and verifies
 * that job node sequences match expected patterns (node ordering, CHECKIN
 * termination, correct resource types, etc.).
 *
 * Tests are skipped when game data files are not present (CI without game assets).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

// Set up DOMParser for Node environment (must be before parser imports)
const dom = new JSDOM('');
(global as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

import { parseJobInfo } from '@/resources/game-data/job-info-parser';
import { parseBuildingInfo } from '@/resources/game-data/building-info-parser';
import { parseSettlerValues } from '@/resources/game-data/settler-values-parser';
import { parseBuildingTriggers } from '@/resources/game-data/building-trigger-parser';
import type { GameData, RaceId } from '@/resources/game-data/types';

// ─────────────────────────────────────────────────────────────
// Load real XML files
// ─────────────────────────────────────────────────────────────

const GAME_DATA_PATH = join(__dirname, '../../../public/Siedler4/GameData');
const hasGameDataFiles = existsSync(join(GAME_DATA_PATH, 'jobInfo.xml'));

function loadXml(filename: string): string {
    return readFileSync(join(GAME_DATA_PATH, filename), 'utf-8');
}

/** Parse all XML files into a GameData object. Cached across tests. */
let cachedGameData: GameData | null = null;

function loadRealGameData(): GameData {
    if (cachedGameData) return cachedGameData;

    const jobs = parseJobInfo(loadXml('jobInfo.xml'));
    const buildings = parseBuildingInfo(loadXml('buildingInfo.xml'));
    const settlers = parseSettlerValues(loadXml('SettlerValues.xml'));
    const buildingTriggers = parseBuildingTriggers(loadXml('BuildingTrigger.xml'));

    cachedGameData = {
        buildings,
        jobs,
        objects: new Map(),
        buildingTriggers,
        settlers,
    };
    return cachedGameData;
}

/** Access a parsed job from the real data by race and ID. */
function getRealJob(raceId: string, jobId: string) {
    return loadRealGameData()
        .jobs.get(raceId as RaceId)!
        .jobs.get(jobId)!;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

const describeWithData = hasGameDataFiles ? describe : describe.skip;

describeWithData('Choreography structure verification (real XML data)', () => {
    it('woodcutter work job has correct node sequence', () => {
        const job = getRealJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
        expect(job.nodes.length).toBeGreaterThanOrEqual(10);
        expect(job.nodes[0]!.task).toBe('GO_TO_TARGET');
        expect(job.nodes[1]!.task).toBe('WORK_ON_ENTITY');
        const resNode = job.nodes.find(n => n.task === 'RESOURCE_GATHERING_VIRTUAL');
        expect(resNode).toBeDefined();
        expect(resNode!.entity).toBe('GOOD_LOG');
        const putNode = job.nodes.find(n => n.task === 'PUT_GOOD');
        expect(putNode).toBeDefined();
        expect(putNode!.entity).toBe('GOOD_LOG');
        expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
    });

    it('stonecutter work job has correct node sequence', () => {
        const job = getRealJob('RACE_ROMAN', 'JOB_STONECUTTER_WORK');
        expect(job.nodes[0]!.task).toBe('GO_TO_TARGET');
        expect(job.nodes[1]!.task).toBe('WORK_ON_ENTITY');
        const resNode = job.nodes.find(n => n.task === 'RESOURCE_GATHERING');
        expect(resNode).toBeDefined();
        expect(resNode!.entity).toBe('GOOD_STONE');
        expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
    });

    it('farmer grain has both harvest and plant jobs', () => {
        const harvest = getRealJob('RACE_ROMAN', 'JOB_FARMERGRAIN_HARVEST');
        const plant = getRealJob('RACE_ROMAN', 'JOB_FARMERGRAIN_PLANT');

        expect(harvest.nodes[0]!.task).toBe('GO_TO_TARGET');
        expect(harvest.nodes.find(n => n.entity === 'GOOD_GRAIN')).toBeDefined();

        expect(plant.nodes.find(n => n.task === 'PLANT')).toBeDefined();
        expect(plant.nodes[plant.nodes.length - 1]!.task).toBe('CHECKIN');
    });

    it('sawmill worker uses all-virtual interior nodes', () => {
        const job = getRealJob('RACE_ROMAN', 'JOB_SAWMILLWORKER_WORK');
        const moveNodes = job.nodes.filter(n => n.task.startsWith('GO'));
        expect(moveNodes.every(n => n.task === 'GO_VIRTUAL')).toBe(true);
        const getGood = job.nodes.find(n => n.task === 'GET_GOOD_VIRTUAL');
        expect(getGood).toBeDefined();
        expect(getGood!.entity).toBe('GOOD_LOG');
        const putGood = job.nodes.find(n => n.task === 'PUT_GOOD_VIRTUAL');
        expect(putGood).toBeDefined();
        expect(putGood!.entity).toBe('GOOD_BOARD');
        expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
    });

    it('all work jobs end with CHECKIN', () => {
        const workJobIds = [
            'JOB_WOODCUTTER_WORK',
            'JOB_STONECUTTER_WORK',
            'JOB_FARMERGRAIN_HARVEST',
            'JOB_FARMERGRAIN_PLANT',
            'JOB_FORESTER_PLANT',
            'JOB_SAWMILLWORKER_WORK',
        ];
        for (const jobId of workJobIds) {
            const job = getRealJob('RACE_ROMAN', jobId);
            const lastNode = job.nodes[job.nodes.length - 1]!;
            expect(lastNode.task).toBe('CHECKIN');
        }
    });

    it('forester plant job has PLANT node', () => {
        const job = getRealJob('RACE_ROMAN', 'JOB_FORESTER_PLANT');
        expect(job.nodes.find(n => n.task === 'PLANT')).toBeDefined();
        expect(job.nodes[job.nodes.length - 1]!.task).toBe('CHECKIN');
    });
});
