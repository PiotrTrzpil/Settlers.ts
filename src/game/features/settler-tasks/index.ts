export { SettlerTaskSystem } from './settler-task-system';
export { SettlerLifecycleCoordinator } from './settler-lifecycle';
export { UnitJobService } from './unit-job-service';
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
} from './types';
export type { ChoreoJobState, MovementContext } from './choreo-types';
export { choreo } from './choreo-types';

// Feature definition (self-registering via FeatureRegistry)
export { SettlerTaskFeature, type SettlerTaskExports } from './settler-tasks-feature';
export { executeMoveSelectedUnits, type MoveCommandDeps } from './move-commands';
