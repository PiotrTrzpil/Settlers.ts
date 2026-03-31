/**
 * SettlerTaskPersistence — Persistable implementation for unit runtimes.
 *
 * Serializes the minimal state needed to resume settler activity after a
 * save/load: building assignments, move tasks, and job intent (jobId +
 * safe nodeIndex + target).
 *
 * Jobs are NOT serialized in full — only the intent is saved so the job
 * can re-acquire runtime state (animation, handlers, callbacks) naturally
 * by re-walking to its target from the snapped nodeIndex.
 *
 * Transport jobs (carriers) are explicitly excluded — they are handled by
 * LogisticsDispatcherFeature persistence + onRestoreComplete re-dispatch.
 */

import { createLogger } from '@/utilities/logger';
import type { Persistable } from '../../persistence/types';
import type { SerializedUnitRuntime, SerializedJobIntent } from '../../state/persistence-types';
import type { GameState } from '../../game-state';
import type { IndexedMap } from '../../utils/indexed-map';
import type { UnitRuntime } from './unit-state-machine';
import type { BuildingWorkerTracker } from './building-worker-tracker';
import type { JobChoreographyStore } from './job-choreography-store';
import { SettlerState } from './types';
import { ChoreoTaskType, createChoreoJobState } from './choreo-types';
import { raceToRaceId } from '../../data/game-data-access';

const log = createLogger('SettlerTaskPersistence');

// ─────────────────────────────────────────────────────────────
// Movement/search task types — safe points to resume a job from
// ─────────────────────────────────────────────────────────────

/**
 * Choreography task types that represent movement or search steps —
 * these are "safe resume points" where re-starting the node will
 * naturally re-acquire any runtime state (animation, target acquisition).
 */
const SAFE_RESUME_TASKS = new Set<ChoreoTaskType>([
    ChoreoTaskType.GO_TO_TARGET,
    ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    ChoreoTaskType.GO_TO_POS,
    ChoreoTaskType.GO_TO_POS_ROUGHLY,
    ChoreoTaskType.GO_TO_SOURCE_PILE,
    ChoreoTaskType.GO_TO_DESTINATION_PILE,
    ChoreoTaskType.GO_HOME,
    ChoreoTaskType.SEARCH,
]);

// ─────────────────────────────────────────────────────────────
// Serialize helpers
// ─────────────────────────────────────────────────────────────

/**
 * Snap nodeIndex back to the nearest prior safe resume node.
 * Returns 0 if no safe node is found before the current index.
 */
function snapToSafeNode(nodes: readonly { task: ChoreoTaskType }[], currentIndex: number): number {
    const clampedIndex = Math.min(currentIndex, nodes.length - 1);
    for (let i = clampedIndex; i >= 0; i--) {
        if (SAFE_RESUME_TASKS.has(nodes[i]!.task)) {
            return i;
        }
    }
    return 0;
}

function serializeJobIntent(runtime: UnitRuntime): SerializedJobIntent | undefined {
    const job = runtime.job;
    if (!job) {
        return undefined;
    }

    // Skip synthetic (builder-created) jobs — they can't be restored from the choreography store
    if (job.synthetic) {
        return undefined;
    }

    const safeNodeIndex = snapToSafeNode(job.nodes, job.nodeIndex);

    const intent: SerializedJobIntent = {
        jobId: job.jobId,
        nodeIndex: safeNodeIndex,
    };

    if (job.targetId !== null) {
        intent.targetId = job.targetId;
    }
    if (job.targetPos !== null) {
        intent.targetPos = job.targetPos;
    }

    return intent;
}

function buildSerializedRuntime(entityId: number, runtime: UnitRuntime): SerializedUnitRuntime | null {
    const isIdle = runtime.state === SettlerState.IDLE;
    const hasMoveTask = runtime.moveTask !== null;
    const hasJob = runtime.job !== null && !runtime.job.synthetic;
    const hasHome = runtime.homeAssignment !== null;

    // Skip truly idle units with no persistent state to save
    if (isIdle && !hasHome && !hasMoveTask && !hasJob) {
        return null;
    }

    const serialized: SerializedUnitRuntime = {
        id: entityId,
        state: runtime.state,
    };

    if (hasMoveTask) {
        serialized.moveTarget = {
            x: runtime.moveTask!.targetX,
            y: runtime.moveTask!.targetY,
        };
    } else if (hasJob) {
        serialized.job = serializeJobIntent(runtime);
    }

    if (hasHome) {
        serialized.home = {
            buildingId: runtime.homeAssignment!.buildingId,
            hasVisited: runtime.homeAssignment!.hasVisited,
        };
    }

    return serialized;
}

// ─────────────────────────────────────────────────────────────
// Deserialize helpers
// ─────────────────────────────────────────────────────────────

interface RestoreContext {
    gameState: GameState;
    runtimes: IndexedMap<number, UnitRuntime>;
    workerTracker: BuildingWorkerTracker;
    choreographyStore: JobChoreographyStore;
}

function restoreHomeAssignment(
    entityId: number,
    home: { buildingId: number; hasVisited: boolean },
    ctx: RestoreContext
): void {
    const building = ctx.gameState.getEntity(home.buildingId);
    if (!building) {
        log.warn(`Skipping home assignment for unit ${entityId}: building ${home.buildingId} not found`);
        return;
    }

    // If the settler was inside the building at save time (hidden + hasVisited),
    // restore it as Inside so the location manager matches entity.hidden state.
    const entity = ctx.gameState.getEntity(entityId);
    if (entity?.hidden && home.hasVisited) {
        ctx.workerTracker.assignWorkerInside(entityId, home.buildingId);
    } else {
        ctx.workerTracker.assignWorker(entityId, home.buildingId);
        const runtime = ctx.runtimes.get(entityId);
        if (runtime?.homeAssignment) {
            runtime.homeAssignment.hasVisited = home.hasVisited;
        }
    }
}

function restoreMoveTask(entityId: number, target: { x: number; y: number }, ctx: RestoreContext): void {
    const entity = ctx.gameState.getEntity(entityId);
    if (!entity) {
        log.warn(`Skipping move task for unit ${entityId}: entity not found`);
        return;
    }

    const runtime = ctx.runtimes.get(entityId);
    if (!runtime) {
        log.warn(`Skipping move task for unit ${entityId}: runtime not found`);
        return;
    }

    const moveSuccess = ctx.gameState.movement.moveUnit(entityId, target.x, target.y);
    if (!moveSuccess) {
        log.debug(`Move task restore failed for unit ${entityId} (pathfinding blocked), leaving IDLE`);
        runtime.state = SettlerState.IDLE;
        return;
    }

    runtime.moveTask = { type: 'move', targetX: target.x, targetY: target.y };
    runtime.state = SettlerState.WORKING;

    // Start walk animation using the current movement controller direction
    const controller = ctx.gameState.movement.getController(entityId);
    if (controller) {
        log.debug(`Restored move task for unit ${entityId} to (${target.x}, ${target.y})`);
    }
}

function restoreJobIntent(entityId: number, intent: SerializedJobIntent, ctx: RestoreContext): void {
    const entity = ctx.gameState.getEntity(entityId);
    if (!entity) {
        log.warn(`Skipping job restore for unit ${entityId}: entity not found`);
        return;
    }

    const runtime = ctx.runtimes.get(entityId);
    if (!runtime) {
        log.warn(`Skipping job restore for unit ${entityId}: runtime not found`);
        return;
    }

    const raceId = raceToRaceId(entity.race);
    const choreoJob = ctx.choreographyStore.getJob(raceId, intent.jobId);
    if (!choreoJob) {
        log.warn(`Skipping job restore for unit ${entityId}: job ${intent.jobId} not found for race ${raceId}`);
        return;
    }

    const jobState = createChoreoJobState(intent.jobId, choreoJob.nodes, false);
    jobState.nodeIndex = Math.min(intent.nodeIndex, choreoJob.nodes.length - 1);
    jobState.targetId = intent.targetId ?? null;
    jobState.targetPos = intent.targetPos ?? null;

    runtime.job = jobState;
    runtime.state = SettlerState.WORKING;
    runtime.moveTask = null;

    log.debug(`Restored job ${intent.jobId} for unit ${entityId} at node ${jobState.nodeIndex}`);
}

function restoreUnitRuntime(serialized: SerializedUnitRuntime, ctx: RestoreContext): void {
    const { id } = serialized;

    // Verify entity exists before restoring state
    if (!ctx.gameState.getEntity(id)) {
        log.warn(`Skipping runtime restore for unit ${id}: entity not found`);
        return;
    }

    // Step 1: restore home assignment (sets workerTracker index + occupant count)
    if (serialized.home) {
        restoreHomeAssignment(id, serialized.home, ctx);
    }

    // Step 2: restore move task OR job (mutually exclusive)
    if (serialized.moveTarget) {
        restoreMoveTask(id, serialized.moveTarget, ctx);
    } else if (serialized.job) {
        restoreJobIntent(id, serialized.job, ctx);
    }
}

// ─────────────────────────────────────────────────────────────
// SettlerTaskPersistence — Persistable factory
// ─────────────────────────────────────────────────────────────

export interface SettlerTaskPersistenceConfig {
    gameState: GameState;
    runtimes: IndexedMap<number, UnitRuntime>;
    workerTracker: BuildingWorkerTracker;
    choreographyStore: JobChoreographyStore;
}

/**
 * Create the Persistable for settler task runtimes.
 *
 * Takes references to SettlerTaskSystem internals so that the persistable
 * can be created in the feature file without needing to subclass
 * SettlerTaskSystem (which already implements multiple interfaces).
 */
export function createSettlerTaskPersistence(
    config: SettlerTaskPersistenceConfig
): Persistable<SerializedUnitRuntime[]> {
    return {
        persistKey: 'settlerTasks',

        serialize(): SerializedUnitRuntime[] {
            const result: SerializedUnitRuntime[] = [];
            for (const [entityId, runtime] of config.runtimes) {
                const serialized = buildSerializedRuntime(entityId, runtime);
                if (serialized !== null) {
                    result.push(serialized);
                }
            }
            return result;
        },

        deserialize(data: SerializedUnitRuntime[]): void {
            const ctx: RestoreContext = {
                gameState: config.gameState,
                runtimes: config.runtimes,
                workerTracker: config.workerTracker,
                choreographyStore: config.choreographyStore,
            };
            for (const serialized of data) {
                try {
                    restoreUnitRuntime(serialized, ctx);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`Failed to restore runtime for unit ${serialized.id}`, err);
                }
            }
        },
    };
}
