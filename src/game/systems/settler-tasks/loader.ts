/**
 * Loads settler and job definitions from YAML files.
 */

import { parse as parseYaml } from 'yaml';
import type { SettlerConfig, TaskNode, AnimationType } from './types';
import { SearchType, TaskType } from './types';
import { UnitType } from '../../entity';
import { EMaterialType } from '../../economy';

// Import YAML as raw text (Vite handles this)
import settlersYaml from './data/settlers.yaml?raw';
import jobsYaml from './data/jobs.yaml?raw';

/** Parse a material type string from YAML to EMaterialType enum value */
function parseMaterialType(name: string | undefined): EMaterialType | undefined {
    if (name === undefined) return undefined;
    const value = EMaterialType[name as keyof typeof EMaterialType];
    if (value === undefined) {
        throw new Error(`Unknown material type in YAML: "${name}". Valid types: ${Object.keys(EMaterialType).filter(k => isNaN(Number(k))).join(', ')}`);
    }
    return value;
}

/** Parse a search type string from YAML */
function parseSearchType(name: string): SearchType {
    const validTypes = ['TREE', 'TREE_SEED_POS', 'STONE', 'FISH', 'VENISON', 'GRAIN', 'RESOURCE_POS', 'GOOD', 'CONSTRUCTION', 'TERRAIN', 'FORGE', 'WORKPLACE'];
    if (!validTypes.includes(name)) {
        throw new Error(`Unknown search type in YAML: "${name}". Valid types: ${validTypes.join(', ')}`);
    }
    return name as SearchType;
}

/** Parse a task type string from YAML */
function parseTaskType(name: string): TaskType {
    const validTypes = ['GO_TO_TARGET', 'GO_TO_POS', 'GO_TO_SOURCE', 'GO_TO_DEST', 'GO_HOME', 'SEARCH_POS', 'WORK_ON_ENTITY', 'STAY', 'WORK', 'WAIT', 'PICKUP', 'DROPOFF'];
    if (!validTypes.includes(name)) {
        throw new Error(`Unknown task type in YAML: "${name}". Valid types: ${validTypes.join(', ')}`);
    }
    return name as TaskType;
}

/** Parse an animation type string from YAML */
function parseAnimationType(name: string): AnimationType {
    const validTypes = ['walk', 'idle', 'carry', 'pickup', 'dropoff', 'chop', 'harvest', 'plant', 'mine', 'hammer', 'dig', 'work'];
    if (!validTypes.includes(name)) {
        throw new Error(`Unknown animation type in YAML: "${name}". Valid types: ${validTypes.join(', ')}`);
    }
    return name as AnimationType;
}

/** Parsed settler configs keyed by settler name */
export type SettlerConfigs = Map<UnitType, SettlerConfig>;

/** Parsed job definitions keyed by job ID */
export type JobDefinitions = Map<string, TaskNode[]>;

/** Map settler names from YAML to UnitType enum */
const SETTLER_NAME_MAP: Record<string, UnitType> = {
    woodcutter: UnitType.Woodcutter,
    forester: UnitType.Forester,
    farmer: UnitType.Farmer,
    miner: UnitType.Miner,
    carrier: UnitType.Carrier,
    builder: UnitType.Builder,
    digger: UnitType.Digger,
    smith: UnitType.Smith,
    sawmillworker: UnitType.SawmillWorker,
};

interface RawSettlerConfig {
    search: string;
    tool?: string;
    jobs: string[];
}

interface RawTaskNode {
    task: string;
    anim: string;
    duration?: number;
    good?: string;
}

/**
 * Parse and validate settler configs from YAML.
 */
export function loadSettlerConfigs(): SettlerConfigs {
    const raw = parseYaml(settlersYaml) as Record<string, RawSettlerConfig>;
    const configs = new Map<UnitType, SettlerConfig>();

    for (const [name, rawConfig] of Object.entries(raw)) {
        const unitType = SETTLER_NAME_MAP[name];
        if (unitType === undefined) {
            throw new Error(`Unknown settler type in YAML: "${name}". Valid types: ${Object.keys(SETTLER_NAME_MAP).join(', ')}`);
        }

        configs.set(unitType, {
            search: parseSearchType(rawConfig.search),
            tool: parseMaterialType(rawConfig.tool),
            jobs: rawConfig.jobs,
        });
    }

    return configs;
}

/**
 * Parse and validate job definitions from YAML.
 */
export function loadJobDefinitions(): JobDefinitions {
    const raw = parseYaml(jobsYaml) as Record<string, RawTaskNode[]>;
    const jobs = new Map<string, TaskNode[]>();

    for (const [jobId, rawTasks] of Object.entries(raw)) {
        const tasks: TaskNode[] = rawTasks.map((rawTask) => ({
            task: parseTaskType(rawTask.task),
            anim: parseAnimationType(rawTask.anim),
            duration: rawTask.duration,
            good: parseMaterialType(rawTask.good),
        }));

        jobs.set(jobId, tasks);
    }

    return jobs;
}
