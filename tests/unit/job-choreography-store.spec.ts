/**
 * Tests for JobChoreographyStore.
 *
 * Verifies:
 * - JobNode → ChoreoNode conversion (task string→enum, numeric flag→boolean)
 * - Cache returns the same object on second call
 * - Unknown job ID returns undefined
 * - getJobsForSettler uses settler animLists correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameDataLoader } from '@/resources/game-data/game-data-loader';
import type { GameData, JobInfo, SettlerValueInfo, RaceSettlerValueData } from '@/resources/game-data/types';
import { JobChoreographyStore, resetJobChoreographyStore } from '@/game/features/settler-tasks/job-choreography-store';
import { ChoreoTaskType } from '@/game/features/settler-tasks/choreo-types';
import { UnitType } from '@/game/unit-types';

// ─────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────

/** Build a minimal GameData with the given jobs for RACE_ROMAN. */
function buildTestGameData(jobs: JobInfo[], settlers: SettlerValueInfo[] = []): GameData {
    const jobMap = new Map<string, JobInfo>();
    for (const j of jobs) jobMap.set(j.id, j);

    const settlerMap = new Map<string, SettlerValueInfo>();
    for (const s of settlers) settlerMap.set(s.id, s);

    const romanSettlerData: RaceSettlerValueData = { settlers: settlerMap };

    return {
        buildings: new Map(),
        jobs: new Map([['RACE_ROMAN', { jobs: jobMap }]]),
        objects: new Map(),
        buildingTriggers: new Map(),
        settlers: new Map([['RACE_ROMAN', romanSettlerData]]),
    };
}

/** A minimal JobInfo for a woodcutter work cycle. */
const WOODCUTTER_WORK: JobInfo = {
    id: 'JOB_WOODCUTTER_WORK',
    nodes: [
        {
            task: 'GO_TO_TARGET',
            jobPart: 'WC_WALK',
            x: 0,
            y: 0,
            duration: -1,
            dir: -1,
            forward: 1,
            visible: 1,
            useWork: false,
            entity: '',
            trigger: '',
        },
        {
            task: 'WORK_ON_ENTITY',
            jobPart: 'WC_CHOP',
            x: 0,
            y: 0,
            duration: 50,
            dir: -1,
            forward: 1,
            visible: 1,
            useWork: false,
            entity: '',
            trigger: 'TRIGGER_WOODCUTTER_CHOP',
        },
        {
            task: 'RESOURCE_GATHERING',
            jobPart: 'WC_PICKUP',
            x: 0,
            y: 0,
            duration: 10,
            dir: -1,
            forward: 0,
            visible: 0,
            useWork: false,
            entity: 'GOOD_LOG',
            trigger: '',
        },
        {
            task: 'GO_HOME',
            jobPart: 'WC_WALK',
            x: 0,
            y: 0,
            duration: -1,
            dir: -1,
            forward: 1,
            visible: 1,
            useWork: false,
            entity: '',
            trigger: '',
        },
    ],
};

/** A minimal JobInfo with a WORK node at a specific position. */
const CARRIER_IDLE: JobInfo = {
    id: 'JOB_CARRIER_IDLE1',
    nodes: [
        {
            task: 'WAIT',
            jobPart: 'C_IDLE1',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: 1,
            visible: 1,
            useWork: false,
            entity: '',
            trigger: '',
        },
    ],
};

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('JobChoreographyStore', () => {
    let loader: GameDataLoader;

    beforeEach(() => {
        // Reset singleton state before each test
        GameDataLoader.resetInstance();
        resetJobChoreographyStore();
        loader = GameDataLoader.getInstance();
    });

    afterEach(() => {
        GameDataLoader.resetInstance();
        resetJobChoreographyStore();
    });

    describe('getJob - basic conversion', () => {
        it('returns undefined for an unknown job ID', () => {
            loader.setData(buildTestGameData([]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJob('RACE_ROMAN', 'JOB_DOES_NOT_EXIST');

            expect(result).toBeUndefined();
        });

        it('returns undefined for a known race with no jobs', () => {
            loader.setData(buildTestGameData([]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');

            expect(result).toBeUndefined();
        });

        it('converts JOB_WOODCUTTER_WORK and returns correct node count', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');

            expect(job).toBeDefined();
            expect(job!.id).toBe('JOB_WOODCUTTER_WORK');
            expect(job!.nodes).toHaveLength(4);
        });

        it('maps GO_TO_TARGET task string to the correct enum value', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const firstNode = job.nodes[0]!;

            expect(firstNode.task).toBe(ChoreoTaskType.GO_TO_TARGET);
        });

        it('maps WORK_ON_ENTITY task string to the correct enum value', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const workNode = job.nodes[1]!;

            expect(workNode.task).toBe(ChoreoTaskType.WORK_ON_ENTITY);
        });

        it('maps RESOURCE_GATHERING task string to the correct enum value', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const gatherNode = job.nodes[2]!;

            expect(gatherNode.task).toBe(ChoreoTaskType.RESOURCE_GATHERING);
        });

        it('maps GO_HOME task string to the correct enum value', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const homeNode = job.nodes[3]!;

            expect(homeNode.task).toBe(ChoreoTaskType.GO_HOME);
        });
    });

    describe('getJob - numeric flag → boolean conversion', () => {
        it('converts forward=1 to true and forward=0 to false', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;

            // Node 0: forward=1 → true
            expect(job.nodes[0]!.forward).toBe(true);
            // Node 2: forward=0 → false (RESOURCE_GATHERING plays in reverse)
            expect(job.nodes[2]!.forward).toBe(false);
        });

        it('converts visible=1 to true and visible=0 to false', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;

            // Node 0: visible=1 → true
            expect(job.nodes[0]!.visible).toBe(true);
            // Node 2: visible=0 → false
            expect(job.nodes[2]!.visible).toBe(false);
        });

        it('passes through scalar fields unchanged', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const workNode = job.nodes[1]!;

            expect(workNode.jobPart).toBe('WC_CHOP');
            expect(workNode.duration).toBe(50);
            expect(workNode.dir).toBe(-1);
            expect(workNode.trigger).toBe('TRIGGER_WOODCUTTER_CHOP');
            expect(workNode.entity).toBe('');
        });

        it('passes through entity field on RESOURCE_GATHERING node', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK')!;
            const gatherNode = job.nodes[2]!;

            expect(gatherNode.entity).toBe('GOOD_LOG');
        });
    });

    describe('getJob - WAIT task mapping', () => {
        it('maps WAIT task string to the correct enum value', () => {
            loader.setData(buildTestGameData([CARRIER_IDLE]));
            const store = new JobChoreographyStore(loader);

            const job = store.getJob('RACE_ROMAN', 'JOB_CARRIER_IDLE1')!;

            expect(job).toBeDefined();
            expect(job.nodes[0]!.task).toBe(ChoreoTaskType.WAIT);
        });
    });

    describe('getJob - caching', () => {
        it('returns the same object reference on a second call (cache hit)', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK]));
            const store = new JobChoreographyStore(loader);

            const first = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            const second = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');

            expect(first).toBe(second);
        });

        it('cache size increases after each unique job lookup', () => {
            loader.setData(buildTestGameData([WOODCUTTER_WORK, CARRIER_IDLE]));
            const store = new JobChoreographyStore(loader);

            expect(store.cacheSize).toBe(0);

            store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            expect(store.cacheSize).toBe(1);

            store.getJob('RACE_ROMAN', 'JOB_CARRIER_IDLE1');
            expect(store.cacheSize).toBe(2);

            // Same job again — cache size stays at 2
            store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            expect(store.cacheSize).toBe(2);
        });

        it('undefined results are NOT cached (re-checks loader on each miss)', () => {
            loader.setData(buildTestGameData([]));
            const store = new JobChoreographyStore(loader);

            // First call: job does not exist
            const first = store.getJob('RACE_ROMAN', 'JOB_MISSING');
            expect(first).toBeUndefined();
            expect(store.cacheSize).toBe(0);
        });
    });

    describe('getJob - error on unknown task type', () => {
        it('throws a descriptive error for an unknown CEntityTask string', () => {
            const badJob: JobInfo = {
                id: 'JOB_BAD',
                nodes: [
                    {
                        task: 'UNKNOWN_FUTURE_TASK',
                        jobPart: 'X',
                        x: 0,
                        y: 0,
                        duration: 0,
                        dir: -1,
                        forward: 1,
                        visible: 1,
                        useWork: false,
                        entity: '',
                        trigger: '',
                    },
                ],
            };
            loader.setData(buildTestGameData([badJob]));
            const store = new JobChoreographyStore(loader);

            expect(() => store.getJob('RACE_ROMAN', 'JOB_BAD')).toThrow(
                "Unknown CEntityTask type: 'UNKNOWN_FUTURE_TASK'"
            );
        });
    });

    describe('getJobsForSettler', () => {
        it('returns empty array for a unit type with no XML settler mapping', () => {
            loader.setData(buildTestGameData([]));
            const store = new JobChoreographyStore(loader);

            // UnitType.Swordsman has no XML settler mapping
            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Swordsman);

            expect(result).toEqual([]);
        });

        it('returns empty array when settler info is not found in any race', () => {
            loader.setData(buildTestGameData([]));
            const store = new JobChoreographyStore(loader);

            // SETTLER_WOODCUTTER not present in test data
            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);

            expect(result).toEqual([]);
        });

        it('returns empty array when settler has no animLists', () => {
            const settlerWithNoAnimLists: SettlerValueInfo = {
                id: 'SETTLER_WOODCUTTER',
                role: 'FREE_WORKER_ROLE',
                searchTypes: ['SEARCH_TREE'],
                tool: 'GOOD_AXE',
                animLists: [],
            };
            loader.setData(buildTestGameData([WOODCUTTER_WORK], [settlerWithNoAnimLists]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);

            expect(result).toEqual([]);
        });

        it('returns converted jobs matching the settler animLists', () => {
            const settlerWithAnimLists: SettlerValueInfo = {
                id: 'SETTLER_WOODCUTTER',
                role: 'FREE_WORKER_ROLE',
                searchTypes: ['SEARCH_TREE'],
                tool: 'GOOD_AXE',
                animLists: ['JOB_WOODCUTTER_WORK'],
            };
            loader.setData(buildTestGameData([WOODCUTTER_WORK], [settlerWithAnimLists]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);

            expect(result).toHaveLength(1);
            expect(result[0]!.id).toBe('JOB_WOODCUTTER_WORK');
            expect(result[0]!.nodes).toHaveLength(4);
        });

        it('returns multiple jobs when settler has multiple animLists entries', () => {
            const settlerWithMultipleJobs: SettlerValueInfo = {
                id: 'SETTLER_WOODCUTTER',
                role: 'FREE_WORKER_ROLE',
                searchTypes: ['SEARCH_TREE'],
                tool: 'GOOD_AXE',
                animLists: ['JOB_WOODCUTTER_WORK', 'JOB_CARRIER_IDLE1'],
            };
            loader.setData(buildTestGameData([WOODCUTTER_WORK, CARRIER_IDLE], [settlerWithMultipleJobs]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);

            expect(result).toHaveLength(2);
            const ids = result.map(j => j.id);
            expect(ids).toContain('JOB_WOODCUTTER_WORK');
            expect(ids).toContain('JOB_CARRIER_IDLE1');
        });

        it('skips animList entries whose job does not exist in game data', () => {
            const settlerWithMissingJob: SettlerValueInfo = {
                id: 'SETTLER_WOODCUTTER',
                role: 'FREE_WORKER_ROLE',
                searchTypes: ['SEARCH_TREE'],
                tool: 'GOOD_AXE',
                animLists: ['JOB_WOODCUTTER_WORK', 'JOB_NONEXISTENT'],
            };
            loader.setData(buildTestGameData([WOODCUTTER_WORK], [settlerWithMissingJob]));
            const store = new JobChoreographyStore(loader);

            const result = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);

            // Only the existing job is returned
            expect(result).toHaveLength(1);
            expect(result[0]!.id).toBe('JOB_WOODCUTTER_WORK');
        });

        it('populates the cache when loading jobs via getJobsForSettler', () => {
            const settlerWithAnimLists: SettlerValueInfo = {
                id: 'SETTLER_WOODCUTTER',
                role: 'FREE_WORKER_ROLE',
                searchTypes: ['SEARCH_TREE'],
                tool: 'GOOD_AXE',
                animLists: ['JOB_WOODCUTTER_WORK'],
            };
            loader.setData(buildTestGameData([WOODCUTTER_WORK], [settlerWithAnimLists]));
            const store = new JobChoreographyStore(loader);

            expect(store.cacheSize).toBe(0);
            store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter);
            // Job should now be in cache
            expect(store.cacheSize).toBe(1);

            // getJob should return same object (from cache)
            const direct = store.getJob('RACE_ROMAN', 'JOB_WOODCUTTER_WORK');
            const viaSettler = store.getJobsForSettler('RACE_ROMAN', UnitType.Woodcutter)[0];
            expect(direct).toBe(viaSettler);
        });
    });
});
