/**
 * Job teardown steps shared by every way a job ends early (failure, preemption, owner cancel,
 * unit removal): stop the building trigger, tell the work handler its target work was
 * interrupted, and run the node `onAbort` hooks of every node that did not complete.
 */

import type { Entity, UnitType } from '../../../entity';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { ChoreoSystem } from '../../../systems/choreo';
import type { TriggerSystem } from '../../building-overlays';
import type { JobState, SettlerConfig } from '../types';
import type { UnitRuntime } from '../unit-runtime';
import type { WorkHandlerRegistry } from '../work-handler-registry';
import { safeCall } from '../safe-call';
import { homeBuildingIdOf } from './job-progress';

export interface JobTeardownDeps {
    choreoSystem: ChoreoSystem;
    triggerSystem: TriggerSystem;
    handlerRegistry: WorkHandlerRegistry;
    settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    handlerErrorLogger: ThrottledLogger;
}

/** Stop the building overlay trigger a work node started, if the unit still has a home. */
export function stopActiveTrigger(deps: JobTeardownDeps, runtime: UnitRuntime, job: JobState): void {
    if (!job.activeTrigger) {
        return;
    }
    const homeId = homeBuildingIdOf(runtime);
    if (homeId !== null) {
        deps.triggerSystem.stopTrigger(homeId, job.activeTrigger);
    }
}

/**
 * Tell the unit's entity work handler that work on the job's target was interrupted (releases the
 * target reservation). `unit` may be the removal snapshot of an entity already gone from GameState.
 */
export function interruptTargetWork(deps: JobTeardownDeps, unit: Entity, job: JobState): void {
    if (!job.targetId || !job.workStarted) {
        return;
    }
    // Nullable by design: units without a settler config (angels, …) have no work handlers.
    const config = deps.settlerConfigs.get(unit.subType as UnitType);
    const entityHandler = config ? deps.handlerRegistry.getEntityHandler(config.search) : undefined;
    if (!entityHandler) {
        return;
    }
    const targetId = job.targetId;
    safeCall(
        () => entityHandler.onWorkInterrupt?.(targetId, unit.id),
        deps.handlerErrorLogger,
        `onWorkInterrupt failed for target ${targetId}`
    );
}

/** Run `onAbort` for every node that did not complete (the current node and all after it). */
export function runAbortHooks(choreoSystem: ChoreoSystem, unitId: number, job: JobState): void {
    for (let i = job.nodeIndex; i < job.nodes.length; i++) {
        const node = job.nodes[i]!;
        const hooks = choreoSystem.hooksFor(node.task);
        if (hooks?.onAbort) {
            hooks.onAbort(unitId, node);
        }
    }
}
