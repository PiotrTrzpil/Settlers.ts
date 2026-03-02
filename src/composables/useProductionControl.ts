/**
 * Composable for production control UI on multi-recipe buildings.
 * Provides reactive state for production mode, proportions, and manual queue.
 */
import { computed, type Ref } from 'vue';
import type { Game } from '@/game/game';
import type { Entity } from '@/game/entity';
import { BuildingType, EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { hasMultipleRecipes, getRecipeSet } from '@/game/economy/building-production';
import { type ProductionMode } from '@/game/features/production-control';

export interface RecipeInfo {
    /** Recipe index in the building's RecipeSet */
    index: number;
    output: EMaterialType;
    outputName: string;
    weight: number;
}

export interface ProductionControlState {
    /** Whether this building supports multiple recipes */
    isMultiRecipe: boolean;
    /** Current production mode */
    mode: ProductionMode;
    /** Available recipes with weights */
    recipes: RecipeInfo[];
    /** Manual mode queue (output material names) */
    queue: string[];
    /** Raw queue as recipe indices */
    queueRaw: number[];
}

/**
 * Returns reactive production control state and action dispatchers for the selected building.
 *
 * @param gameRef - Computed ref to the current Game instance (may be null)
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useProductionControl(
    gameRef: Ref<Game | null>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): {
    productionControl: Ref<ProductionControlState | null>;
    setProductionMode: (mode: ProductionMode) => void;
    setRecipeProportion: (recipeIndex: number, weight: number) => void;
    addToProductionQueue: (recipeIndex: number) => void;
    removeFromProductionQueue: (recipeIndex: number) => void;
} {
    const state = computed<ProductionControlState | null>(() => {
        // Touch tick to re-evaluate each frame
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const game = gameRef.value;
        const entity = selectedEntity.value;
        if (!game || !entity) return null;
        if (entity.type !== EntityType.Building) return null;

        const bt = entity.subType as BuildingType;
        if (!hasMultipleRecipes(bt)) return null;

        const recipeSet = getRecipeSet(bt);
        if (!recipeSet) return null;

        const pcm = game.services.productionControlManager;

        const prodState = pcm.getProductionState(entity.id);
        if (!prodState) return null;

        const recipes: RecipeInfo[] = [];
        for (let i = 0; i < recipeSet.recipes.length; i++) {
            const r = recipeSet.recipes[i]!;
            recipes.push({
                index: i,
                output: r.output,
                outputName: EMaterialType[r.output],
                weight: prodState.proportions.get(i) ?? 1,
            });
        }

        return {
            isMultiRecipe: true,
            mode: prodState.mode,
            recipes,
            queue: prodState.queue.map(idx => {
                const r = recipeSet.recipes[idx];
                return r ? EMaterialType[r.output] : `Recipe ${idx}`;
            }),
            queueRaw: [...prodState.queue],
        };
    });

    function setMode(mode: ProductionMode): void {
        const entity = selectedEntity.value;
        const game = gameRef.value;
        if (!entity || !game) return;
        game.execute({ type: 'set_production_mode', buildingId: entity.id, mode });
    }

    function setProportion(recipeIndex: number, weight: number): void {
        const entity = selectedEntity.value;
        const game = gameRef.value;
        if (!entity || !game) return;
        game.execute({ type: 'set_recipe_proportion', buildingId: entity.id, recipeIndex, weight });
    }

    function addToQueue(recipeIndex: number): void {
        const entity = selectedEntity.value;
        const game = gameRef.value;
        if (!entity || !game) return;
        game.execute({ type: 'add_to_production_queue', buildingId: entity.id, recipeIndex });
    }

    function removeFromQueue(recipeIndex: number): void {
        const entity = selectedEntity.value;
        const game = gameRef.value;
        if (!entity || !game) return;
        game.execute({ type: 'remove_from_production_queue', buildingId: entity.id, recipeIndex });
    }

    return {
        productionControl: state,
        setProductionMode: setMode,
        setRecipeProportion: setProportion,
        addToProductionQueue: addToQueue,
        removeFromProductionQueue: removeFromQueue,
    };
}
