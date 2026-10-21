/**
 * SettlerTaskPersistence — Persistable for unit runtimes and commitments.
 *
 * Saves per unit: its home assignment and its commitment — `{ owner, ref, reserved }` plus the
 * owned job as `{ kind, params, nodeIndex, targets }` (nodes are never saved), or the move target,
 * or nothing (a hold). Every kind saves and restores the same way.
 *
 * Restore (deserialize, `after: ['constructionSites']`): home assignments, move tasks and the
 * commitment records are applied right away; jobs are only queued in PendingJobResumes and are
 * built + resumed in the final restore pass (`onRestoreResume`), after every owner rebuilt its
 * domain state from commitments in `onRestoreComplete`.
 *
 * Not saved (the unit loads idle): commitments of `persist: false` owners.
 */

import { createLogger } from '@/utilities/logger';
import type { Persistable } from '../../persistence/types';
import type { SerializedCommitment, SerializedJob, SerializedUnitRuntime } from '../../state/persistence-types';
import type { GameState } from '../../game-state';
import type { UnitCommitmentQuery, UnitCommitmentWriter } from '../../systems/unit-commitment';
import type { JobKind } from '../../systems/choreo';
import type { UnitRuntime, UnitRuntimeStore } from './unit-runtime';
import type { WorkerAssignments } from './worker-assignments';
import type { JobState } from './types';
import type { JobOwnerRegistry } from './internal/job-owners';
import type { MoveTaskRunner } from './internal/move-tasks';
import type { PendingJobResumes } from './internal/job-resume';

const log = createLogger('SettlerTaskPersistence');

export interface SettlerTaskPersistenceConfig {
    gameState: GameState;
    runtimes: UnitRuntimeStore;
    assignments: WorkerAssignments;
    owners: JobOwnerRegistry;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
    moveTasks: MoveTaskRunner;
    pendingResumes: PendingJobResumes;
}

// ─────────────────────────────────────────────────────────────
// Serialize
// ─────────────────────────────────────────────────────────────

function serializeJob(job: JobState): SerializedJob {
    const saved: SerializedJob = { kind: job.kind, params: job.params, nodeIndex: job.nodeIndex };
    if (job.targetId !== null) {
        saved.targetId = job.targetId;
    }
    if (job.targetPos !== null) {
        saved.targetPos = job.targetPos;
    }
    if (job.approachPos !== null) {
        saved.approachPos = job.approachPos;
    }
    return saved;
}

function serializeCommitment(
    entityId: number,
    runtime: UnitRuntime,
    config: SettlerTaskPersistenceConfig
): SerializedCommitment | undefined {
    const commitment = config.commitments.get(entityId);
    if (!commitment) {
        return undefined;
    }
    const persisted = commitment.hasJob
        ? config.owners.persistsJobs(commitment.owner as JobKind)
        : config.owners.persistsHolds(commitment.owner);
    if (!persisted) {
        return undefined;
    }
    const saved: SerializedCommitment = { owner: commitment.owner, ref: commitment.ref, reserved: commitment.reserved };
    if (commitment.hasJob) {
        saved.job = serializeJob(runtime.job!);
    } else if (runtime.moveTask) {
        saved.moveTarget = { x: runtime.moveTask.targetX, y: runtime.moveTask.targetY };
    }
    return saved;
}

function buildSerializedRuntime(
    entityId: number,
    runtime: UnitRuntime,
    config: SettlerTaskPersistenceConfig
): SerializedUnitRuntime | null {
    const commitment = serializeCommitment(entityId, runtime, config);
    if (!commitment && !runtime.homeAssignment) {
        return null;
    }
    const serialized: SerializedUnitRuntime = { id: entityId };
    if (runtime.homeAssignment) {
        serialized.home = {
            buildingId: runtime.homeAssignment.buildingId,
            hasVisited: runtime.homeAssignment.hasVisited,
        };
    }
    if (commitment) {
        serialized.commitment = commitment;
    }
    return serialized;
}

// ─────────────────────────────────────────────────────────────
// Deserialize
// ─────────────────────────────────────────────────────────────

function restoreHomeAssignment(
    entityId: number,
    home: { buildingId: number; hasVisited: boolean },
    config: SettlerTaskPersistenceConfig
): void {
    const building = config.gameState.getEntity(home.buildingId);
    if (!building) {
        log.warn(`Skipping home assignment for unit ${entityId}: building ${home.buildingId} not found`);
        return;
    }

    // If the settler was inside the building at save time (hidden + hasVisited),
    // restore it as Inside so the location manager matches entity.hidden state.
    const entity = config.gameState.getEntityOrThrow(entityId, 'unit with saved home assignment');
    if (entity.hidden && home.hasVisited) {
        config.assignments.assignWorkerInside(entityId, home.buildingId);
    } else {
        config.assignments.assignWorker(entityId, home.buildingId);
        config.runtimes.get(entityId)!.homeAssignment!.hasVisited = home.hasVisited;
    }
}

/** Apply a saved commitment: jobs are queued for resume, moves restart, holds are set as-is. */
function restoreCommitment(entityId: number, saved: SerializedCommitment, config: SettlerTaskPersistenceConfig): void {
    const { owner, ref, reserved } = saved;
    if (saved.job) {
        config.commitmentWriter.set(entityId, { owner, ref, reserved, hasJob: true });
        config.pendingResumes.add(entityId, saved.job);
        return;
    }
    config.owners.holdOwner(owner);
    if (saved.moveTarget && !config.moveTasks.restore(entityId, saved.moveTarget)) {
        log.debug(`Move task restore failed for unit ${entityId} (pathfinding blocked), leaving IDLE`);
        if (owner === 'player-move') {
            return;
        }
    }
    config.commitmentWriter.set(entityId, { owner, ref, reserved, hasJob: false });
}

function restoreUnitRuntime(serialized: SerializedUnitRuntime, config: SettlerTaskPersistenceConfig): void {
    const { id } = serialized;
    // Snapshot data is external input: a unit missing from the entity table is skipped.
    if (!config.gameState.getEntity(id)) {
        log.warn(`Skipping runtime restore for unit ${id}: entity not found`);
        return;
    }
    if (serialized.home) {
        restoreHomeAssignment(id, serialized.home, config);
    }
    if (serialized.commitment) {
        restoreCommitment(id, serialized.commitment, config);
    }
}

// ─────────────────────────────────────────────────────────────
// SettlerTaskPersistence — Persistable factory
// ─────────────────────────────────────────────────────────────

/** Create the Persistable for settler task runtimes (created by the feature from the system's peers). */
export function createSettlerTaskPersistence(
    config: SettlerTaskPersistenceConfig
): Persistable<SerializedUnitRuntime[]> {
    return {
        persistKey: 'settlerTasks',

        serialize(): SerializedUnitRuntime[] {
            const result: SerializedUnitRuntime[] = [];
            for (const [entityId, runtime] of config.runtimes) {
                const serialized = buildSerializedRuntime(entityId, runtime, config);
                if (serialized !== null) {
                    result.push(serialized);
                }
            }
            return result;
        },

        deserialize(data: SerializedUnitRuntime[]): void {
            for (const serialized of data) {
                try {
                    restoreUnitRuntime(serialized, config);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`Failed to restore runtime for unit ${serialized.id}`, err);
                }
            }
        },
    };
}
