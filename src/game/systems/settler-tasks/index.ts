/**
 * Settler Task System - data-driven settler behaviors.
 */

export { SettlerTaskSystem } from './settler-task-system';
export {
    TaskType,
    TaskResult,
    SearchType,
    SettlerState,
    type AnimationType,
    type SettlerConfig,
    type TaskNode,
    // New composed job state types
    type CommonJobFields,
    type WorkerJobData,
    type CarrierJobData,
    type WorkerJobState,
    type CarrierJobState,
    type JobState,
    // Legacy flattened type (deprecated)
    type SettlerJobState,
    type WorkHandler,
} from './types';
