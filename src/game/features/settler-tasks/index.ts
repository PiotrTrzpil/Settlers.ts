/**
 * settler-tasks — the domain-free unit job runtime.
 *
 * Peers (each one responsibility):
 * - SettlerTaskSystem: tick loop + composition root, work-handler registration, debug
 * - JobService: job ownership API — JobKind handlers / hold owners, assign / cancel / hold
 * - JobRunner: job start + node advance, entity.jobId; implements TaskDispatcher and WorkerStateQuery
 *   (internal: JobOutcomes = complete/fail/preempt/cancel, MoveTaskRunner, UnitRemovalHandler, job resume)
 * - WorkerAssignments: home-building assignments, occupants, idle-specialist lookup;
 *   implements WorkerAssignmentQuery
 * - WorkerAutonomy: idle work search, job selection, waiting at home, search pacing
 * - UnitVisualSync: direction / walk / idle animation following movement
 * - SettlerLifecycleCoordinator: reactions to workplace removal, cancellation, dismissal events
 * - UnitRuntimeStore: the per-unit runtime records (single factory)
 */
export { SettlerTaskSystem } from './settler-task-system';
export { JobRunner } from './job-runner';
export { WorkerAssignments } from './worker-assignments';
export type { JobService, JobAssignOptions, HoldOwnerHandler } from './job-service';
export type { WorkJobParams } from './work-job-kind';
export {
    JobType,
    TaskResult,
    SearchType,
    SettlerState,
    WorkHandlerType,
    type SettlerConfig,
    type JobState,
    type EntityWorkHandler,
    type PositionWorkHandler,
    type WorkHandler,
    type TaskDispatcher,
    type WorkerStateQuery,
    type WorkerAssignmentQuery,
} from './types';
export type { ChoreoJobState, MovementContext } from './choreo-types';
export { choreo } from './choreo-types';

// Feature definition (self-registering via FeatureRegistry)
export { SettlerTaskFeature, type SettlerTaskExports } from './settler-tasks-feature';
export { executeMoveSelectedUnits, type MoveCommandDeps } from './move-commands';
