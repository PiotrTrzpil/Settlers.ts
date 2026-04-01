/**
 * JIL view lookup tables — reverse mappings from job indices to human-readable names.
 *
 * Extracted from jil-view.vue to keep the Vue SFC under the line limit.
 */

import {
    BUILDING_JOB_INDICES,
    RESOURCE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    SETTLER_FILE_NUMBERS,
    GFX_FILE_NUMBERS,
} from '@/game/renderer/sprite-metadata';
import { BuildingType } from '@/game/entity';

/** Settler files (20-24.jil) contain carrier sprites with materials */
export const SETTLER_FILE_IDS = new Set(Object.values(SETTLER_FILE_NUMBERS));

/** Building files are race-specific: 10=Roman, 11=Viking, 12=Mayan, 14=Trojan */
export const BUILDING_FILE_IDS = new Set([10, 11, 12, 14]);

// Build reverse lookup from job index to building name
export const jobToBuildingName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
    const buildingType = typeStr as BuildingType;
    jobToBuildingName.set(jobIndex, buildingType);
}

// Build reverse lookup from job index to resource/material name
export const jobToResourceName = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
    jobToResourceName.set(jobIndex, typeStr);
}

// Build reverse lookup from job index to carrier material name (mapped materials)
export const jobToCarrierMaterial = new Map<number, string>();
for (const [typeStr, jobIndex] of Object.entries(CARRIER_MATERIAL_JOB_INDICES)) {
    jobToCarrierMaterial.set(jobIndex, typeStr);
}

// Build reverse lookup from job index to worker state descriptions (settler files)
export const jobToWorkerLabels = new Map<number, string[]>();

function formatWorkerName(key: string): string {
    const unitType = SETTLER_KEY_TO_UNIT_TYPE[key];
    if (unitType !== undefined) {
        const levelMatch = /^.+_(\d+)$/.exec(key);
        return levelMatch ? `${unitType} L${levelMatch[1]}` : unitType;
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function addWorkerLabel(jobIndex: number, workerName: string, state: string): void {
    if (jobIndex < 0) {
        return;
    }
    const label = `${workerName}: ${state}`;
    const existing = jobToWorkerLabels.get(jobIndex);
    if (existing) {
        existing.push(label);
    } else {
        jobToWorkerLabels.set(jobIndex, [label]);
    }
}

for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
    const name = formatWorkerName(workerKey);
    for (const [field, value] of Object.entries(workerData as Record<string, number>)) {
        addWorkerLabel(value, name, field);
    }
}

/** Check if the given file ID is a settler file. */
export function isSettlerFile(fileId: number | null): boolean {
    return fileId !== null && SETTLER_FILE_IDS.has(fileId);
}

/** Get carrier material label for a job (e.g., "Carrier: AGAVE"). Only for settler files. */
export function getCarrierMaterialLabel(fileId: number | null, jobIndex: number): string | null {
    if (!isSettlerFile(fileId)) {
        return null;
    }
    const material = jobToCarrierMaterial.get(jobIndex);
    return material ? `Carrier: ${material}` : null;
}

/** Get worker state labels for a job (e.g., "Woodcutter: work.0"). Only for settler files. */
export function getWorkerLabel(fileId: number | null, jobIndex: number): string | null {
    if (!isSettlerFile(fileId)) {
        return null;
    }
    const labels = jobToWorkerLabels.get(jobIndex);
    return labels ? labels.join(', ') : null;
}

/** Get a human-readable name for a job index based on the current file type. */
export function getNameForJob(fileId: number | null, jobIndex: number): string | undefined {
    if (fileId === null) {
        return undefined;
    }
    if (BUILDING_FILE_IDS.has(fileId)) {
        return jobToBuildingName.get(jobIndex);
    }
    if (fileId === GFX_FILE_NUMBERS.RESOURCES) {
        return jobToResourceName.get(jobIndex);
    }
    return undefined;
}

/** Check if a job index has any known mapping (building, resource, worker, or carrier). */
export function isJobMapped(fileId: number | null, jobIndex: number): boolean {
    return (
        getNameForJob(fileId, jobIndex) !== null ||
        getWorkerLabel(fileId, jobIndex) !== null ||
        getCarrierMaterialLabel(fileId, jobIndex) !== null
    );
}

/** Get a combined label for dropdown display. */
export function getJobLabel(fileId: number | null, jobIndex: number): string {
    const buildingName = getNameForJob(fileId, jobIndex);
    if (buildingName) {
        return buildingName;
    }

    const workerLbl = getWorkerLabel(fileId, jobIndex);
    const carrierLbl = getCarrierMaterialLabel(fileId, jobIndex);

    if (workerLbl && carrierLbl) {
        return `${workerLbl} | ${carrierLbl}`;
    }
    if (workerLbl) {
        return workerLbl;
    }
    if (carrierLbl) {
        return carrierLbl;
    }

    if (isSettlerFile(fileId)) {
        return '[?]';
    }
    return '';
}
