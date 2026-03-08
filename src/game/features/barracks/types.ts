/**
 * Barracks Training — type definitions.
 *
 * Training recipes describe how the barracks converts weapons and gold into soldiers.
 * Each recipe has explicit { material, count } inputs and produces a specific unit type at a level.
 */

// TrainingRecipe is defined in event-bus (no feature deps) and re-exported here.
import type { TrainingRecipe } from '@/game/event-bus';
export type { TrainingRecipe };

/** Per-race recipe collection for the barracks. */
export interface TrainingRecipeSet {
    /** All training recipes available to this race's barracks. */
    recipes: readonly TrainingRecipe[];
}

/**
 * Runtime state for an active training session at a barracks.
 * The carrier's movement and training phases are handled by the choreography system.
 */
export interface BarracksTrainingState {
    /** The recipe being trained. */
    recipe: TrainingRecipe;
    /** Entity ID of the recruited carrier (executing the training choreography). */
    carrierId: number;
}
