/**
 * Builds a reverse lookup from "fileNum:jobIndex" -> human-readable name
 * by walking the existing JIL index constants from the game codebase.
 *
 * This avoids duplicating any naming data — all names come from jil-indices.ts.
 */
import {
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    BUILDING_JOB_INDICES,
    RESOURCE_JOB_INDICES,
    TREE_JOB_INDICES,
    TREE_JOB_OFFSET,
    DARK_TREE_JOB_INDICES,
    DARK_TREE_STATIC_JOB_INDICES,
    DARK_TRIBE_TREE_JOBS,
    SEA_ROCK_JOBS,
    RESOURCE_SIGN_JOBS,
    TERRITORY_DOT_JOB,
    type SettlerAnimData,
} from '../../src/game/renderer/sprite-metadata/jil-indices';
import { MapObjectType } from '../../src/game/types/map-object-types';

/** GFX file number -> category label */
const FILE_LABELS: Record<string, string> = {
    '3': 'Resources (3)',
    '4': 'Landscape (4)',
    '5': 'MapObjects (5)',
    '6': 'Landscape2 (6)',
    '7': 'Landscape3 (7)',
    '8': 'UI (8)',
    '10': 'Buildings-Roman (10)',
    '11': 'Buildings-Viking (11)',
    '12': 'Buildings-Mayan (12)',
    '13': 'Buildings-DarkTribe (13)',
    '14': 'Buildings-Trojan (14)',
    '20': 'Settlers-Roman (20)',
    '21': 'Settlers-Viking (21)',
    '22': 'Settlers-Mayan (22)',
    '23': 'Settlers-DarkTribe (23)',
    '24': 'Settlers-Trojan (24)',
    '30': 'Effects-Roman (30)',
    '31': 'Effects-Viking (31)',
    '32': 'Effects-Mayan (32)',
    '33': 'Effects-DarkTribe (33)',
    '34': 'Effects-Trojan (34)',
    '36': 'Effects2 (36)',
    '37': 'Effects3 (37)',
};

/** Settler file numbers (20-24) — share the same SETTLER_JOB_INDICES */
const SETTLER_FILES = ['20', '21', '22', '23', '24'];

/** Building file numbers (10-14) — share the same BUILDING_JOB_INDICES */
const BUILDING_FILES = ['10', '11', '12', '13', '14'];

export function buildFileLabel(fileNum: string): string {
    return FILE_LABELS[fileNum] ?? `file ${fileNum}`;
}

/**
 * Build reverse index: "fileNum:jobIndex" -> "unitName/actionName" or similar.
 * Reuses all naming data from the game's jil-indices.ts constants.
 */
function addSettlerJobs(index: Map<string, string>): void {
    for (const [unitKey, animData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[unitKey];
        const unitLabel = unitKey.replace(/_/g, ' ');

        for (const [actionKey, jobIndex] of Object.entries(animData as SettlerAnimData)) {
            const name = `${unitLabel}/${actionKey}` + (unitType !== undefined ? '' : ' (unmapped)');
            for (const file of SETTLER_FILES) {
                index.set(`${file}:${jobIndex}`, name);
            }
        }
    }
}

function addTreeJobs(index: Map<string, string>, mapObjNumToName: Map<number, string>): void {
    const treeStageNames = Object.entries(TREE_JOB_OFFSET) as [string, number][];

    for (const [motStr, baseJobs] of Object.entries(TREE_JOB_INDICES)) {
        const mot = Number(motStr) as MapObjectType;
        const treeName = mapObjNumToName.get(mot) ?? `Tree_${mot}`;

        for (let v = 0; v < baseJobs!.length; v++) {
            const baseJob = baseJobs![v]!;
            for (const [stageName, offset] of treeStageNames) {
                const jobIndex = baseJob + offset;
                const label = baseJobs!.length > 1 ? `${treeName}/v${v}/${stageName}` : `${treeName}/${stageName}`;
                index.set(`5:${jobIndex}`, label);
            }
        }
    }
}

/**
 * Build reverse index: "fileNum:jobIndex" -> "unitName/actionName" or similar.
 * Reuses all naming data from the game's jil-indices.ts constants.
 */
export function buildJobNameIndex(): Map<string, string> {
    const index = new Map<string, string>();

    addSettlerJobs(index);

    // --- Building jobs (files 10-14) ---
    for (const [buildingType, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
        if (jobIndex === undefined) continue;
        for (const file of BUILDING_FILES) {
            index.set(`${file}:${jobIndex}`, buildingType);
        }
    }

    // --- Resource jobs (file 3) ---
    for (const [materialType, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
        if (jobIndex === undefined) continue;
        index.set(`3:${jobIndex}`, `resource/${materialType}`);
    }

    // --- Tree jobs (file 5) ---
    const mapObjNames = Object.entries(MapObjectType).filter(([, v]) => typeof v === 'number') as [string, number][];
    const mapObjNumToName = new Map(mapObjNames.map(([k, v]) => [v, k]));

    addTreeJobs(index, mapObjNumToName);

    // --- Dark trees (file 5) ---
    for (const entry of DARK_TREE_JOB_INDICES) {
        const names = entry.types.map(t => mapObjNumToName.get(t) ?? `DarkTree_${t}`);
        index.set(`5:${entry.job}`, names.join('/'));
    }
    for (const entry of DARK_TREE_STATIC_JOB_INDICES) {
        const names = entry.types.map(t => mapObjNumToName.get(t) ?? `DarkTree_${t}`);
        index.set(`5:${entry.job}`, `${names.join('/')} (static)`);
    }

    // --- Dark tribe trees (file 5) ---
    for (const [variant, job] of Object.entries(DARK_TRIBE_TREE_JOBS)) {
        index.set(`5:${job}`, `DarkTribeTree_${variant}`);
    }

    // --- Sea rocks (file 5) ---
    for (const [variant, job] of Object.entries(SEA_ROCK_JOBS)) {
        index.set(`5:${job}`, `SeaRock_${variant}`);
    }

    // --- Resource signs (file 5) ---
    index.set(`5:${RESOURCE_SIGN_JOBS.EMPTY}`, 'ResourceSign/EMPTY');
    for (const [resource, levels] of Object.entries(RESOURCE_SIGN_JOBS)) {
        if (resource === 'EMPTY') continue;
        const lvls = levels as { LOW: number; MED: number; RICH: number };
        index.set(`5:${lvls.LOW}`, `ResourceSign/${resource}_LOW`);
        index.set(`5:${lvls.MED}`, `ResourceSign/${resource}_MED`);
        index.set(`5:${lvls.RICH}`, `ResourceSign/${resource}_RICH`);
    }

    // --- Territory dot (file 5) ---
    index.set(`5:${TERRITORY_DOT_JOB}`, 'TerritoryDot');

    return index;
}
