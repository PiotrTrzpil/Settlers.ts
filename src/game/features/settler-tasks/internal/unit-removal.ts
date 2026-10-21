/**
 * Unit removal — the COMMITMENTS-priority cleanup handler (runs before every other cleanup
 * handler).
 *
 * `GameState.removeEntity` deletes the entity before emitting `entity:removed`, so this handler
 * works from the payload's entity snapshot and the unit runtime — never `getEntity`. In one pass:
 * 1. job teardown — stop the trigger, interrupt target work, node onAbort hooks (carried goods are
 *    dropped by material-transfer at EARLY, location bookkeeping by settler-location at DEFAULT);
 * 2. the owner learns it once: `JobKindHandler.onUnitRemoved` / `HoldOwnerHandler.onUnitRemoved`;
 * 3. home assignment release, runtime and commitment delete;
 * 4. notification `settler:jobAborted { reason: 'unitRemoved' }`.
 */

import { EntityType, type Entity, type UnitType } from '../../../entity';
import type { EventBus } from '../../../event-bus';
import { createLogger } from '@/utilities/logger';
import type { UnitCommitmentQuery, UnitCommitmentWriter } from '../../../systems/unit-commitment';
import type { JobState } from '../types';
import type { UnitRuntime, UnitRuntimeStore } from '../unit-runtime';
import type { WorkerAssignments } from '../worker-assignments';
import type { IdleSearchCooldowns } from '../idle-search-cooldowns';
import type { JobOwnerRegistry } from './job-owners';
import { interruptTargetWork, runAbortHooks, stopActiveTrigger, type JobTeardownDeps } from './job-teardown';
import { emitJobAborted } from './job-events';

const log = createLogger('UnitRemoval');

export interface UnitRemovalConfig {
    eventBus: EventBus;
    runtimes: UnitRuntimeStore;
    owners: JobOwnerRegistry;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
    assignments: WorkerAssignments;
    idleCooldowns: IdleSearchCooldowns;
    teardown: JobTeardownDeps;
}

export class UnitRemovalHandler {
    private readonly eventBus: EventBus;
    private readonly runtimes: UnitRuntimeStore;
    private readonly owners: JobOwnerRegistry;
    private readonly commitments: UnitCommitmentQuery;
    private readonly writer: UnitCommitmentWriter;
    private readonly assignments: WorkerAssignments;
    private readonly idleCooldowns: IdleSearchCooldowns;
    private readonly teardown: JobTeardownDeps;

    constructor(cfg: UnitRemovalConfig) {
        this.eventBus = cfg.eventBus;
        this.runtimes = cfg.runtimes;
        this.owners = cfg.owners;
        this.commitments = cfg.commitments;
        this.writer = cfg.commitmentWriter;
        this.assignments = cfg.assignments;
        this.idleCooldowns = cfg.idleCooldowns;
        this.teardown = cfg.teardown;
    }

    /** Cleanup-registry handler (CLEANUP_PRIORITY.COMMITMENTS). `unit` is the removal snapshot. */
    onEntityRemoved(entityId: number, unit: Entity): void {
        if (unit.type !== EntityType.Unit) {
            return;
        }
        const runtime = this.runtimes.get(entityId);
        if (runtime && runtime.job) {
            this.abortJob(unit, runtime, runtime.job);
        } else {
            this.releaseHold(entityId);
        }
        this.releasePositionWork(unit);
        this.idleCooldowns.cancelAll(entityId);
        if (runtime) {
            this.assignments.releaseRemovedUnit(entityId, runtime);
            this.runtimes.delete(entityId);
        }
    }

    /** Steps 1–2 and 4 for a unit that was running a job. */
    private abortJob(unit: Entity, runtime: UnitRuntime, job: JobState): void {
        runtime.job = null;
        stopActiveTrigger(this.teardown, runtime, job);
        interruptTargetWork(this.teardown, unit, job);
        runAbortHooks(this.teardown.choreoSystem, unit.id, job);
        this.clearCommitment(unit.id, job);

        log.debug(`Unit ${unit.id} removed during job ${job.jobId} (${job.kind}, ref ${job.ref})`);
        this.owners.kind(job.kind).onUnitRemoved(unit.id, job.ref, job.params);
        emitJobAborted(this.eventBus, unit.id, job, 'unitRemoved');
    }

    /** Step 2 for a unit without a job: its hold / move owner learns it lost the unit. */
    private releaseHold(unitId: number): void {
        const commitment = this.commitments.get(unitId);
        if (!commitment) {
            return;
        }
        if (commitment.hasJob) {
            throw new Error(`Unit ${unitId} removed with a '${commitment.owner}' commitment but no running job`);
        }
        this.writer.clear(unitId);
        this.owners.holdOwner(commitment.owner).onUnitRemoved(unitId, commitment.ref);
    }

    private clearCommitment(unitId: number, job: JobState): void {
        const commitment = this.commitments.get(unitId);
        if (!commitment || commitment.owner !== job.kind) {
            throw new Error(`Removed unit ${unitId}: job '${job.jobId}' (${job.kind}) has no matching commitment`);
        }
        this.writer.clear(unitId);
    }

    /** Position work handlers forget the unit (e.g. an activated pioneer's search origin). */
    private releasePositionWork(unit: Entity): void {
        // Nullable by design: units without a settler config (angels, …) have no work handlers.
        const config = this.teardown.settlerConfigs.get(unit.subType as UnitType);
        if (!config) {
            return;
        }
        const posHandler = this.teardown.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        posHandler?.onSettlerRemoved?.(unit.id);
    }
}
