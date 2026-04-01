/**
 * Settler debug extractor — pure diagnostic functions for the settler task system.
 *
 * Extracted from SettlerTaskSystem to separate diagnostics from task orchestration.
 * All functions are pure — they take a SettlerDebugSource and return data with no side effects.
 */

import type { BuildingWorkerTracker } from '../building-worker-tracker';
import type { UnitRuntime } from '../unit-state-machine';
import type { SettlerState } from '../types';
import { type SettlerDebugEntry, buildDebugEntry } from '../settler-task-config';

export type { SettlerDebugEntry };

/**
 * Read-only view of the settler task system required for debug output.
 * SettlerTaskSystem implements this interface directly.
 */
export interface SettlerDebugSource {
    readonly runtimes: Iterable<[number, UnitRuntime]>;
    readonly workerTracker: BuildingWorkerTracker;
    getActiveJobId(entityId: number): string | null;
    getSettlerState(entityId: number): SettlerState | null;
}

/**
 * Build a debug entry array for all active settlers.
 * Returns one SettlerDebugEntry per runtime, in iteration order.
 */
export function dumpSettlerDebug(source: SettlerDebugSource): SettlerDebugEntry[] {
    const result: SettlerDebugEntry[] = [];
    for (const [entityId, runtime] of source.runtimes) {
        result.push(buildDebugEntry(entityId, runtime));
    }
    return result;
}

/**
 * Format a human-readable worker assignment summary.
 * Groups settlers by their assigned building and lists their current state.
 *
 * Example output:
 *   Building 42: settlers [7, 13] (working, idle)
 *   Building 55: settlers [21] (working)
 *   Unassigned: 3 settlers
 */
export function dumpWorkerAssignments(source: SettlerDebugSource): string {
    const byBuilding = new Map<number, number[]>();
    let unassigned = 0;

    for (const [entityId, runtime] of source.runtimes) {
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        const buildingId = runtime.homeAssignment?.buildingId ?? null;
        if (buildingId === null) {
            unassigned++;
        } else {
            let group = byBuilding.get(buildingId);
            if (!group) {
                group = [];
                byBuilding.set(buildingId, group);
            }
            group.push(entityId);
        }
    }

    const lines: string[] = [];

    for (const [buildingId, settlers] of byBuilding) {
        // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
        const stateList = settlers.map(id => source.getSettlerState(id)?.toLowerCase() ?? 'unknown').join(', ');
        lines.push(`Building ${buildingId}: settlers [${settlers.join(', ')}] (${stateList})`);
    }

    if (unassigned > 0) {
        lines.push(`Unassigned: ${unassigned} settler${unassigned === 1 ? '' : 's'}`);
    }

    return lines.length > 0 ? lines.join('\n') : '(no settlers)';
}
