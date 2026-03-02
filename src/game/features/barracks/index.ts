/**
 * Barracks Training Feature Module
 *
 * Manages soldier training at barracks buildings. Converts weapons, gold,
 * and armor into military units via a choreography-based training pipeline.
 *
 * Public API:
 * - Types: TrainingRecipe, TrainingRecipeSet, BarracksTrainingState
 * - Manager: BarracksTrainingManager, BarracksTrainingManagerConfig
 * - Recipes: getTrainingRecipes, getTrainingRecipeSet, getSpecialistUnitType, getSpecialistWeapon
 * - Recipe indices: TrainingRecipeIndex
 * - Constants: TRAINING_DURATION_FRAMES
 */

// Types
export type { TrainingRecipe, TrainingRecipeSet, BarracksTrainingState } from './types';

// Manager
export { BarracksTrainingManager, TRAINING_DURATION_FRAMES } from './barracks-training-manager';
export type { BarracksTrainingManagerConfig } from './barracks-training-manager';

// Recipe data
export {
    getTrainingRecipes,
    getTrainingRecipeSet,
    getSpecialistUnitType,
    getSpecialistWeapon,
    TrainingRecipeIndex,
} from './training-recipes';
export type { TrainingRecipeIndexValue } from './training-recipes';
