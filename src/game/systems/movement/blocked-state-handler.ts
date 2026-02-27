/**
 * BlockedStateHandler encapsulates the escalation state machine for a unit that
 * cannot make progress on its current path.
 *
 * Escalation timeline:
 *   0s – BLOCKED_REPATH_TIMEOUT  → normal obstacle resolution (detour/repair/push)
 *   BLOCKED_REPATH_TIMEOUT       → escalated repath (ignore occupancy)
 *   BLOCKED_GIVEUP_TIMEOUT       → give up and clear path
 */

import { MovementController } from './movement-controller';
import type { IPathfinder } from './pathfinding-service';

/** After this many seconds blocked, do a full repath ignoring the blocker */
const BLOCKED_REPATH_TIMEOUT = 0.5;

/** After this many seconds blocked, give up and stop */
const BLOCKED_GIVEUP_TIMEOUT = 2.0;

/**
 * Result of handling the blocked state for one tick.
 */
export type BlockedHandleResult =
    | 'gave-up' // Path cleared; caller should stop processing this unit
    | 'escalated' // Escalated repath succeeded; caller can retry the move
    | 'still-blocked'; // Normal resolution should proceed

/**
 * Handles escalating responses when a unit is stuck behind an obstacle.
 */
export class BlockedStateHandler {
    private readonly pathfinder: IPathfinder;

    constructor(pathfinder: IPathfinder) {
        this.pathfinder = pathfinder;
    }

    /**
     * Evaluate the current blocked duration and apply the appropriate escalation step.
     *
     * @param controller The controller of the blocked unit
     * @param deltaSec   Time elapsed this tick (used to accumulate blocked time)
     * @returns A discriminated result indicating what happened
     */
    handle(controller: MovementController, _deltaSec: number): BlockedHandleResult {
        if (controller.blockedTime >= BLOCKED_GIVEUP_TIMEOUT) {
            controller.clearPath();
            return 'gave-up';
        }

        if (controller.blockedTime >= BLOCKED_REPATH_TIMEOUT) {
            if (this.tryEscalatedRepath(controller)) {
                return 'escalated';
            }
        }

        return 'still-blocked';
    }

    /**
     * Attempt a full repath to the goal, ignoring current occupancy.
     * Resets blocked time on success so escalation restarts if the unit gets stuck again.
     *
     * @returns true if a new path was found and set
     */
    private tryEscalatedRepath(controller: MovementController): boolean {
        const goal = controller.goal;
        if (!goal) return false;

        const newPath = this.pathfinder.findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            true // ignore occupancy — find ANY path to goal
        );

        if (newPath && newPath.length > 0) {
            controller.replacePath(newPath);
            controller.resetBlockedTime();
            return true;
        }

        return false;
    }
}
