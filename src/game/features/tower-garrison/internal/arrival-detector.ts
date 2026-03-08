import type { GameState } from '@/game/game-state';
import type { TowerGarrisonManager } from '../tower-garrison-manager';

/**
 * Translates `unit:movementStopped` events into garrison finalization.
 *
 * When a unit that is en-route to a tower stops moving, this detector delegates
 * to `manager.tryFinalizeAtDoor`, which checks whether the unit is within
 * Chebyshev distance <= 1 of the door. If so, it finalizes the garrison.
 * If not (pathfinding stopped early), the unit remains en-route — the
 * auto-garrison or movement system will retry.
 *
 * If the tower no longer exists (removed while the unit was walking), the
 * en-route state is explicitly cancelled so the unit is not left reserved forever.
 */
export class ArrivalDetector {
    constructor(
        private readonly manager: TowerGarrisonManager,
        private readonly gameState: GameState
    ) {}

    onMovementStopped(entityId: number): void {
        const towerId = this.manager.getTowerIdForEnRouteUnit(entityId);
        if (towerId === undefined) return;

        // If the tower was removed while this unit was walking, clean up the dangling en-route state.
        if (!this.gameState.getEntity(towerId)) {
            this.manager.cancelEnRoute(entityId);
            return;
        }

        this.manager.tryFinalizeAtDoor(entityId, towerId);
    }
}
