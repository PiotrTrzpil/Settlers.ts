/**
 * Barracks Training Feature Module
 *
 * Manages soldier training at barracks buildings. Converts weapons, gold,
 * and armor into military units via a choreography-based training pipeline.
 *
 * Public API:
 * - Types: TrainingRecipe, TrainingRecipeSet, BarracksTrainingState
 * - Manager: BarracksTrainingManager, BarracksTrainingManagerConfig
 * - Job kind: BarracksJobParams, barracksJobSpec
 * - Recipes: getTrainingRecipes, getTrainingRecipeSet, getSpecialistUnitType, getSpecialistWeapon,
 *   getRecipeTargetUnitType, getRecipeForTargetUnitType
 * - Recipe indices: TrainingRecipeIndex
 * - Constants: TRAINING_DURATION_FRAMES
 */

// Types
export type { TrainingRecipe, TrainingRecipeSet, BarracksTrainingState } from './types';

// Manager
export { BarracksTrainingManager } from './barracks-training-manager';
export type { BarracksTrainingManagerConfig } from './barracks-training-manager';

// Job kind
export { TRAINING_DURATION_FRAMES, barracksJobSpec, type BarracksJobParams } from './barracks-job-kind';

// Feature definition (self-registering via FeatureRegistry)
export { BarracksFeature, type BarracksExports } from './barracks-feature';

// Recipe data
export {
    getTrainingRecipes,
    getTrainingRecipeSet,
    getSpecialistUnitType,
    getSpecialistWeapon,
    getRecipeTargetUnitType,
    getRecipeForTargetUnitType,
    TrainingRecipeIndex,
} from './training-recipes';
export type { TrainingRecipeIndexValue } from './training-recipes';
