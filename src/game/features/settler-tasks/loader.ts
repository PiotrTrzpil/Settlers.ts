import { parse as parseYaml } from 'yaml';
import type { SettlerConfig, TaskNode, AnimationType } from './types';
import { SearchType, TaskType } from './types';
import { UnitType } from '../../entity';
import { EMaterialType } from '../../economy';

// Import YAML as raw text (Vite handles this)
import settlersYaml from './data/settlers.yaml?raw';
import jobsYaml from './data/jobs.yaml?raw';

/** Validate that a string is a member of the given set, with a contextual error message. */
function parseEnum<T extends string>(name: string, validValues: ReadonlySet<string>, label: string): T {
    if (!validValues.has(name)) {
        throw new Error(`Unknown ${label} in YAML: "${name}". Valid: ${[...validValues].join(', ')}`);
    }
    return name as T;
}

const SEARCH_TYPES = new Set(Object.values(SearchType));
const TASK_TYPES = new Set(Object.values(TaskType));
const ANIMATION_TYPES: ReadonlySet<string> = new Set<AnimationType>([
    'walk',
    'idle',
    'carry',
    'pickup',
    'dropoff',
    'chop',
    'harvest',
    'plant',
    'mine',
    'hammer',
    'dig',
    'work',
]);

function parseMaterialType(name: string | undefined): EMaterialType | undefined {
    if (name === undefined) return undefined;
    const value = EMaterialType[name as keyof typeof EMaterialType] as EMaterialType | undefined;
    if (value === undefined) {
        throw new Error(
            `Unknown material type in YAML: "${name}". Valid: ${Object.keys(EMaterialType)
                .filter(k => isNaN(Number(k)))
                .join(', ')}`
        );
    }
    return value;
}

/** Parsed settler configs keyed by settler name */
export type SettlerConfigs = Map<UnitType, SettlerConfig>;

/** Parsed job definitions keyed by job ID */
export type JobDefinitions = Map<string, TaskNode[]>;

const SETTLER_NAME_MAP: Record<string, UnitType> = {
    woodcutter: UnitType.Woodcutter,
    stonecutter: UnitType.Stonecutter,
    forester: UnitType.Forester,
    farmer: UnitType.Farmer,
    miner: UnitType.Miner,
    carrier: UnitType.Carrier,
    builder: UnitType.Builder,
    digger: UnitType.Digger,
    smith: UnitType.Smith,
    sawmillworker: UnitType.SawmillWorker,
    miller: UnitType.Miller,
    butcher: UnitType.Butcher,
    agavefarmer: UnitType.AgaveFarmer,
    beekeeper: UnitType.Beekeeper,
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

export function loadSettlerConfigs(): SettlerConfigs {
    const raw = parseYaml(settlersYaml) as Record<string, RawSettlerConfig>;
    const configs = new Map<UnitType, SettlerConfig>();

    for (const [name, rawConfig] of Object.entries(raw)) {
        const unitType = SETTLER_NAME_MAP[name];
        if (unitType === undefined) {
            throw new Error(
                `Unknown settler type in YAML: "${name}". Valid: ${Object.keys(SETTLER_NAME_MAP).join(', ')}`
            );
        }

        configs.set(unitType, {
            search: parseEnum<SearchType>(rawConfig.search, SEARCH_TYPES, 'search type'),
            tool: parseMaterialType(rawConfig.tool),
            jobs: rawConfig.jobs,
        });
    }

    return configs;
}

export function loadJobDefinitions(): JobDefinitions {
    const raw = parseYaml(jobsYaml) as Record<string, RawTaskNode[]>;
    const jobs = new Map<string, TaskNode[]>();

    for (const [jobId, rawTasks] of Object.entries(raw)) {
        const tasks: TaskNode[] = rawTasks.map(rawTask => ({
            task: parseEnum<TaskType>(rawTask.task, TASK_TYPES, 'task type'),
            anim: parseEnum<AnimationType>(rawTask.anim, ANIMATION_TYPES, 'animation type'),
            duration: rawTask.duration,
            good: parseMaterialType(rawTask.good),
        }));

        jobs.set(jobId, tasks);
    }

    return jobs;
}
