/**
 * Trees Feature Module
 *
 * Manages tree lifecycle: growth, cutting, decay, and forest expansion.
 */

export { TreeFeature, type TreeFeatureExports } from './tree-feature';

// Re-export TreeSystem types for convenience
export { TreeSystem, TreeStage, type TreeState } from './tree-system';

// Tree expansion — grow forests around seed trees
export { expandTrees, type ExpandTreesOptions } from './tree-expansion';
