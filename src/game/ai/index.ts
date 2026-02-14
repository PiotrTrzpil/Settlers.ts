/**
 * AI Module
 *
 * Provides behavior tree primitives for entity AI.
 *
 * @module ai
 */

// Behavior tree primitives
export {
    // Core types
    NodeStatus,
    Node,

    // Composite nodes
    Sequence,
    Selector,
    Parallel,

    // Leaf nodes
    Condition,
    Action,
    StatusAction,

    // Decorator nodes
    Guard,
    Repeat,
    RepeatCount,
    Sleep,
    ResetAfter,

    // Builder functions
    sequence,
    selector,
    parallel,
    condition,
    action,
    statusAction,
    guard,
    repeat,
    repeatCount,
    sleep,
    resetAfter,
} from './behavior-tree';

// Tick wrapper
export { Tick } from './tick';
