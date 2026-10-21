/**
 * ChoreoSystem — plugin registry for choreography executors.
 *
 * A kernel service (created by GameServices, provided to every feature via
 * FeatureContext.choreoSystem). Each feature registers the executors for the task
 * types whose domain it owns, as closures that already capture their dependencies:
 * settler-tasks registers the domain-free runtime executors (movement, wait, work timing),
 * material-transfer the goods executors, construction DIG_TILE/BUILD_STEP, and so on.
 *
 * Per-call state that depends on the executing unit (its workplace and work handlers)
 * is passed explicitly as a {@link ChoreoExecutionScope} — executors never read it from
 * shared mutable contexts.
 */

import type { Entity } from '../../entity';
import { ChoreoTaskType, type ChoreoJobState, type ChoreoNode, type TaskResult } from './types';
import type { EntityWorkHandler, PositionWorkHandler } from './work-handler-types';

/**
 * Per-call execution scope: what the job runtime resolved for the executing unit
 * before running the current node. Immutable for the duration of one executor call.
 */
export interface ChoreoExecutionScope {
    /** The unit's assigned workplace building, or null (carriers, soldiers, dispatch-only units). */
    readonly homeBuildingId: number | null;
    /** Entity work handler for the unit's search type — undefined when the unit has none. */
    readonly entityHandler: EntityWorkHandler | undefined;
    /** Position work handler for the unit's (plant) search type — undefined when the unit has none. */
    readonly positionHandler: PositionWorkHandler | undefined;
}

/** Unified executor signature — feature deps are captured via closure at registration time. */
export type ChoreoExecutor = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    scope: ChoreoExecutionScope
) => TaskResult;

/**
 * Per-task-type lifecycle hooks, registered next to the executor by the feature that owns the task.
 * Run by the job runtime for every job containing the node (owned and legacy alike).
 */
export interface ChoreoNodeHooks {
    /** The node's side effect is irreversible once it completed — resume never snaps back across it. */
    readonly irreversible?: boolean;
    /** The job ended (failed / preempted / cancelled / unit removed) before this node completed. */
    onAbort?(unitId: number, node: ChoreoNode): void;
    /** Restore: the job resumes at or before this node. false ⇒ resume impossible (→ 'restoreFailed'). */
    onRestore?(unitId: number, node: ChoreoNode): boolean;
}

/** All declared task types (string and numeric enum members, without numeric reverse-mapping keys). */
function allTaskTypes(): ChoreoTaskType[] {
    return Object.keys(ChoreoTaskType)
        .filter(key => Number.isNaN(Number(key)))
        .map(key => ChoreoTaskType[key as keyof typeof ChoreoTaskType]);
}

export class ChoreoSystem {
    private readonly executors = new Map<ChoreoTaskType, ChoreoExecutor>();
    private readonly hooks = new Map<ChoreoTaskType, ChoreoNodeHooks>();

    /** Register an executor (and optional node hooks) for a task type. Throws if the task type already has one. */
    register(taskType: ChoreoTaskType, executor: ChoreoExecutor, hooks?: ChoreoNodeHooks): void {
        if (this.executors.has(taskType)) {
            throw new Error(`Choreo executor already registered for task: ${String(taskType)}`);
        }
        this.executors.set(taskType, executor);
        if (hooks) {
            this.hooks.set(taskType, hooks);
        }
    }

    /** Hooks registered for a task type. Nullable by design: most task types have none. */
    hooksFor(taskType: ChoreoTaskType): ChoreoNodeHooks | undefined {
        return this.hooks.get(taskType);
    }

    /**
     * Assert that every declared ChoreoTaskType has an executor.
     * Called once after all features are loaded, so a missing registration fails at startup
     * instead of on the first job that reaches the node.
     */
    assertAllRegistered(): void {
        const missing = allTaskTypes().filter(taskType => !this.executors.has(taskType));
        if (missing.length > 0) {
            const names = missing.map(t => (typeof t === 'number' ? ChoreoTaskType[t] : t));
            throw new Error(`No choreo executor registered for task types: ${names.join(', ')}`);
        }
    }

    /** Dispatch to the registered executor for the node's task type. Throws if unregistered. */
    execute(
        settler: Entity,
        job: ChoreoJobState,
        node: ChoreoNode,
        dt: number,
        scope: ChoreoExecutionScope
    ): TaskResult {
        const executor = this.executors.get(node.task);
        if (!executor) {
            throw new Error(`No choreo executor registered for task: ${String(node.task)}`);
        }
        return executor(settler, job, node, dt, scope);
    }
}
