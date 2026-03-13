/**
 * ChoreoSystem — plugin registry for choreography executors.
 *
 * Features register their executors as closures that already capture their
 * dependencies. WorkerTaskExecutor registers the core executors; domain
 * features (e.g. recruit) register their own task types independently.
 *
 * This breaks the former settler-tasks → feature coupling where choreo-executors.ts
 * had to import from other feature modules.
 */

import type { Entity } from '../../entity';
import type { ChoreoTaskType, ChoreoJobState, ChoreoNode, TaskResult } from './types';

/** Unified executor signature — deps are captured via closure at registration time. */
export type ChoreoExecutor = (settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number) => TaskResult;

export class ChoreoSystem {
    private readonly executors = new Map<ChoreoTaskType, ChoreoExecutor>();

    /** Register an executor for a task type. Overwrites any previous registration. */
    register(taskType: ChoreoTaskType, executor: ChoreoExecutor): void {
        this.executors.set(taskType, executor);
    }

    /** Dispatch to the registered executor for the node's task type. Throws if unregistered. */
    execute(settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number): TaskResult {
        const executor = this.executors.get(node.task);
        if (!executor) {
            throw new Error(`No choreo executor registered for task: ${String(node.task)}`);
        }
        return executor(settler, job, node, dt);
    }
}
