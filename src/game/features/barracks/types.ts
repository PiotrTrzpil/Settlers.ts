/**
 * Barracks Training — type definitions.
 *
 * Training recipes describe how the barracks converts weapons and gold into soldiers.
 * Each recipe has explicit { material, count } inputs and produces a specific unit type at a level.
 */

import type { EMaterialType } from '@/game/economy/material-type';
import type { UnitType } from '@/game/unit-types';

/** Single training recipe — inputs consumed to produce one soldier. */
export interface TrainingRecipe {
    /** Materials consumed per training cycle (explicit counts for multi-material recipes). */
    inputs: readonly { material: EMaterialType; count: number }[];
    /** Base soldier type produced (e.g. Swordsman, not Swordsman2). */
    unitType: UnitType;
    /** Soldier level (1, 2, or 3). */
    level: number;
}

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
