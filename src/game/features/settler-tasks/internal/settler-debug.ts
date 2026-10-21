/**
 * Settler debug extractors — pure diagnostic views over unit runtimes
 * (debug panel entries, worker-assignment summary). No side effects.
 */

import type { EMaterialType } from '../../../economy';
import type { CommitmentOwner, UnitCommitmentQuery } from '../../../systems/unit-commitment';
import type { WorkerStateQuery } from '../types';
import type { UnitRuntime } from '../unit-runtime';

export interface SettlerDebugEntry {
    entityId: number;
    state: string;
    jobId: string | null;
    jobType: string | null;
    taskIndex: number | null;
    progress: number | null;
    targetId: number | null;
    carryingGood: EMaterialType | null;
    assignedBuilding: number | null;
    /** Commitment owner — null when idle. */
    owner: CommitmentOwner | null;
    /** Owner's key (record / demand / tower id) — null when idle. */
    ownerRef: number | null;
    /** Player moves rejected (reserved commitment). */
    reserved: boolean;
}

type RuntimeEntries = Iterable<[number, UnitRuntime]>;

function buildDebugEntry(entityId: number, runtime: UnitRuntime, commitments: UnitCommitmentQuery): SettlerDebugEntry {
    const job = runtime.job;
    return {
        entityId,
        state: runtime.state,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        jobId: job?.jobId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        jobType: job?.type ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        taskIndex: job?.nodeIndex ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        progress: job?.progress ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        targetId: job?.targetId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        carryingGood: job?.carryingGood ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
        ...commitmentDebugFields(entityId, commitments),
    };
}

/** Owner / ref / reserved of a unit's commitment (null owner and ref when idle). */
function commitmentDebugFields(
    entityId: number,
    commitments: UnitCommitmentQuery
): Pick<SettlerDebugEntry, 'owner' | 'ownerRef' | 'reserved'> {
    const commitment = commitments.get(entityId);
    return {
        owner: commitment ? commitment.owner : null,
        ownerRef: commitment ? commitment.ref : null,
        reserved: commitments.isReserved(entityId),
    };
}

/**
 * Build a debug entry array for all active settlers.
 * Returns one SettlerDebugEntry per runtime, in iteration order.
 */
export function dumpSettlerDebug(runtimes: RuntimeEntries, commitments: UnitCommitmentQuery): SettlerDebugEntry[] {
    const result: SettlerDebugEntry[] = [];
    for (const [entityId, runtime] of runtimes) {
        result.push(buildDebugEntry(entityId, runtime, commitments));
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
export function dumpWorkerAssignments(runtimes: RuntimeEntries, stateQuery: WorkerStateQuery): string {
    const byBuilding = new Map<number, number[]>();
    let unassigned = 0;

    for (const [entityId, runtime] of runtimes) {
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
        const stateList = settlers.map(id => stateQuery.getSettlerState(id)?.toLowerCase() ?? 'unknown').join(', ');
        lines.push(`Building ${buildingId}: settlers [${settlers.join(', ')}] (${stateList})`);
    }

    if (unassigned > 0) {
        lines.push(`Unassigned: ${unassigned} settler${unassigned === 1 ? '' : 's'}`);
    }

    return lines.length > 0 ? lines.join('\n') : '(no settlers)';
}
