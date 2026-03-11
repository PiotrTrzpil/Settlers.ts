/**
 * AI Decision Tree — composable behavior tree for AI player evaluation.
 *
 * Built from existing BT primitives (selector, guard, action) with
 * T = AiPlayerController. Priority-based: the first guard that passes
 * wins, short-circuiting lower-priority branches.
 *
 * Tree structure (highest priority first):
 *   1. Game over     → do nothing (stop evaluating)
 *   2. Can build     → place next building from build order
 *   3. Can train     → recruit a soldier
 *   4. Should attack → send soldiers to nearest enemy castle
 */

import { selector, guard, action, type Node } from '@/game/ai/behavior-tree';
import type { AiPlayerController } from './ai-player-controller';

/**
 * Build the AI decision tree. Called once per controller at creation time.
 * Conditions close over the controller instance via the `ctrl` parameter
 * passed by the BT tick mechanism.
 */
export function createAiDecisionTree(): Node<AiPlayerController> {
    return selector<AiPlayerController>(
        guard(
            ctrl => ctrl.isGameOver(),
            action(() => {
                /* game ended — do nothing */
            })
        ),
        guard(
            ctrl => ctrl.canPlaceNextBuilding(),
            action(ctrl => ctrl.placeBuilding())
        ),
        guard(
            ctrl => ctrl.canTrainSoldier(),
            action(ctrl => ctrl.trainSoldier())
        ),
        guard(
            ctrl => ctrl.shouldAttack(),
            action(ctrl => ctrl.launchAttack())
        )
    );
}
