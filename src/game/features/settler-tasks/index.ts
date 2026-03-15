export { SettlerTaskSystem } from './settler-task-system';
export { SettlerLifecycleCoordinator } from './settler-lifecycle';
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
export type { ChoreoJobState } from './choreo-types';
export type { ChoreoSystem } from '../../systems/choreo';

// Dispatch executors (used by building-demand feature)
export { createEnterBuildingExecutor } from './internal/dispatch-executors';

// Feature definition (self-registering via FeatureRegistry)
export { SettlerTaskFeature, type SettlerTaskExports } from './settler-tasks-feature';
