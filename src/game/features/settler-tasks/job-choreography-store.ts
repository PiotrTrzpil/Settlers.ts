/**
 * JobChoreographyStore — converts parsed JobInfo XML objects into typed ChoreoJob objects.
 *
 * Acts as a thin caching wrapper over GameDataLoader.getJob() that performs the
 * JobNode → ChoreoNode conversion (numeric flags to booleans, task strings to enums).
 */

import type { RaceId, JobInfo, JobNode } from '@/resources/game-data';
import { getGameDataLoader } from '@/resources/game-data';
import type { GameDataLoader } from '@/resources/game-data';
import { ChoreoTaskType, parseChoreoTaskType, type ChoreoJob, type ChoreoNode } from './choreo-types';
import { UnitType } from '../../unit-types';

// ─────────────────────────────────────────────────────────────
// UnitType → XML settler ID mapping (mirrors settler-data-access.ts)
// ─────────────────────────────────────────────────────────────

/**
 * UnitType → XML settler ID for worker settlers that have animLists in SettlerValues.xml.
 * Only includes settlers whose animLists reference jobInfo.xml job IDs.
 */
const UNIT_TYPE_TO_XML_SETTLER: Partial<Record<UnitType, string>> = {
    [UnitType.Woodcutter]: 'SETTLER_WOODCUTTER',
    [UnitType.Stonecutter]: 'SETTLER_STONECUTTER',
    [UnitType.Forester]: 'SETTLER_FORESTER',
    [UnitType.Farmer]: 'SETTLER_FARMERGRAIN',
    [UnitType.AgaveFarmer]: 'SETTLER_AGAVEFARMER',
    [UnitType.Beekeeper]: 'SETTLER_BEEKEEPER',
    [UnitType.Miner]: 'SETTLER_MINEWORKER',
    [UnitType.Carrier]: 'SETTLER_CARRIER',
    [UnitType.Builder]: 'SETTLER_BUILDER',
    [UnitType.Digger]: 'SETTLER_DIGGER',
    [UnitType.Smith]: 'SETTLER_SMITH',
    [UnitType.SawmillWorker]: 'SETTLER_SAWMILLWORKER',
    [UnitType.Miller]: 'SETTLER_MILLER',
    [UnitType.Butcher]: 'SETTLER_BUTCHER',
    [UnitType.Winemaker]: 'SETTLER_VINTNER',
    [UnitType.Meadmaker]: 'SETTLER_MEADMAKER',
    [UnitType.Tequilamaker]: 'SETTLER_TEQUILAMAKER',
    [UnitType.Smelter]: 'SETTLER_SMELTER',
    [UnitType.TempleServant]: 'SETTLER_TEMPLE_SERVANT',
};

const ALL_RACE_IDS: RaceId[] = ['RACE_ROMAN', 'RACE_VIKING', 'RACE_MAYA', 'RACE_DARK', 'RACE_TROJAN'];

// ─────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────

/** Convert a single JobNode (raw XML) to a ChoreoNode (typed). */
function convertNode(node: JobNode): ChoreoNode {
    return {
        task: parseChoreoTaskType(node.task),
        jobPart: node.jobPart,
        x: node.x,
        y: node.y,
        duration: node.duration,
        dir: node.dir,
        forward: node.forward !== 0,
        visible: node.visible !== 0,
        useWork: node.useWork,
        entity: node.entity,
        trigger: node.trigger,
    };
}

/** Convert a JobInfo (raw XML) to a ChoreoJob (typed). */
function convertJob(info: JobInfo): ChoreoJob {
    return {
        id: info.id,
        nodes: info.nodes.map(convertNode),
    };
}

// ─────────────────────────────────────────────────────────────
// JobChoreographyStore
// ─────────────────────────────────────────────────────────────

/** Cache key encodes both raceId and jobId to avoid Map-of-Map overhead. */
function cacheKey(raceId: RaceId, jobId: string): string {
    return `${raceId}|${jobId}`;
}

export class JobChoreographyStore {
    private readonly loader: GameDataLoader;
    /** Cache of converted jobs, keyed by `raceId|jobId`. */
    private readonly cache = new Map<string, ChoreoJob>();

    constructor(loader?: GameDataLoader) {
        this.loader = loader ?? getGameDataLoader();
    }

    /**
     * Get the converted ChoreoJob for the given race and job ID.
     * Returns undefined if the job does not exist in the XML data.
     * Throws if the job exists but contains an unknown task type string.
     */
    getJob(raceId: RaceId, jobId: string): ChoreoJob | undefined {
        const key = cacheKey(raceId, jobId);
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;

        const raw = this.loader.getJob(raceId, jobId);
        if (raw === undefined) return undefined;

        const converted = convertJob(raw);
        this.cache.set(key, converted);
        return converted;
    }

    /**
     * Get all ChoreoJobs that a settler of the given unit type can perform.
     *
     * Uses the settler's `animLists` from SettlerValues.xml to enumerate which job IDs
     * belong to this settler type. Falls back to searching all races if the settler
     * is not present in the requested race (some settlers only exist in one race's XML).
     *
     * Returns an empty array if:
     * - The unit type has no XML settler mapping
     * - The settler has no animLists entries
     * - The referenced jobs do not exist in the race's job data
     */
    getJobsForSettler(raceId: RaceId, unitType: UnitType): ChoreoJob[] {
        const xmlSettlerId = UNIT_TYPE_TO_XML_SETTLER[unitType];
        if (xmlSettlerId === undefined) return [];

        // Try the requested race first, then fall back to any race
        const settlerInfo = this.loader.getSettler(raceId, xmlSettlerId) ?? this.findSettlerInfoAnyRace(xmlSettlerId);
        if (settlerInfo === undefined) return [];

        const jobs: ChoreoJob[] = [];
        for (const jobId of settlerInfo.animLists) {
            const job = this.getJob(raceId, jobId);
            if (job !== undefined) {
                jobs.push(job);
            }
        }
        return jobs;
    }

    /** Search for a settler definition across all races. */
    private findSettlerInfoAnyRace(xmlSettlerId: string) {
        for (const id of ALL_RACE_IDS) {
            const info = this.loader.getSettler(id, xmlSettlerId);
            if (info !== undefined) return info;
        }
        return undefined;
    }

    // Expose for testing
    get cacheSize(): number {
        return this.cache.size;
    }
}

/** Convenience function: get the singleton store backed by the singleton GameDataLoader. */
let _store: JobChoreographyStore | null = null;

export function getJobChoreographyStore(): JobChoreographyStore {
    if (!_store) {
        _store = new JobChoreographyStore();
    }
    return _store;
}

/** Reset the singleton store (for unit tests). */
export function resetJobChoreographyStore(): void {
    _store = null;
}

// Re-export ChoreoTaskType so callers can import from one place if needed.
export { ChoreoTaskType };
