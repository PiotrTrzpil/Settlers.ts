/**
 * Loads settler and job definitions from YAML files.
 */

import { parse as parseYaml } from 'yaml';
import type { SettlerConfig, TaskNode, SearchType, TaskType, AnimationType } from './types';
import { UnitType } from '../../entity';
import type { EMaterialType } from '../../economy';

// Import YAML as raw text (Vite handles this)
import settlersYaml from './data/settlers.yaml?raw';
import jobsYaml from './data/jobs.yaml?raw';

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
            console.warn(`Unknown settler type: ${name}`);
            continue;
        }

        configs.set(unitType, {
            search: rawConfig.search as SearchType,
            tool: rawConfig.tool as EMaterialType | undefined,
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
        const tasks: TaskNode[] = rawTasks.map(rawTask => ({
            task: rawTask.task as TaskType,
            anim: rawTask.anim as AnimationType,
            duration: rawTask.duration,
            good: rawTask.good as EMaterialType | undefined,
        }));

        jobs.set(jobId, tasks);
    }

    return jobs;
}
