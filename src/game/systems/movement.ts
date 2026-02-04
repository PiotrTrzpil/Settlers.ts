import { GameState } from '../game-state';

/**
 * Per-tick movement system.
 * Advances units along their paths based on their speed and delta time.
 */
export function updateMovement(state: GameState, deltaSec: number): void {
    for (const unit of state.unitStates.values()) {
        if (unit.pathIndex >= unit.path.length) continue;

        unit.moveProgress += unit.speed * deltaSec;

        while (unit.moveProgress >= 1 && unit.pathIndex < unit.path.length) {
            unit.moveProgress -= 1;
            const wp = unit.path[unit.pathIndex];

            // Update entity position in game state (handles occupancy)
            state.updateEntityPosition(unit.entityId, wp.x, wp.y);

            unit.pathIndex++;
        }

        // If path is complete, reset
        if (unit.pathIndex >= unit.path.length) {
            unit.path = [];
            unit.pathIndex = 0;
            unit.moveProgress = 0;
        }
    }
}
