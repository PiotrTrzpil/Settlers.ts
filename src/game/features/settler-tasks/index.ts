/**
 * settler-tasks — the domain-free unit job runtime.
 *
 * Peers (each one responsibility):
 * - SettlerTaskSystem: tick loop + composition root, work-handler registration, debug
 * - JobRunner: job lifecycle (assign/start/advance/complete/interrupt), entity.jobId, move tasks;
 *   implements TaskDispatcher and WorkerStateQuery
 * - WorkerAssignments: home-building assignments, occupants, idle-specialist lookup;
 *   implements WorkerAssignmentQuery
 * - WorkerAutonomy: idle work search, job selection, waiting at home, search pacing
 * - UnitVisualSync: direction / walk / idle animation following movement
 * - SettlerLifecycleCoordinator: reactions to removal, cancellation, dismissal events
 * - UnitRuntimeStore: the per-unit runtime records (single factory)
 */
export { SettlerTaskSystem } from './settler-task-system';
export { JobRunner } from './job-runner';
export { WorkerAssignments } from './worker-assignments';
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
