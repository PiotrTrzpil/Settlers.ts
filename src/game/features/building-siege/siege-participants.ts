/**
 * Siege participants — the ejected defender and the door attackers of a siege.
 *
 * A participant is committed to the siege as a reserved `'siege'` hold whose ref is the besieged
 * building (docs/designs/job-ownership.md, "Readers & siege migration"), and its movement
 * controller is marked busy so it is not bumped off the door. The siege system registers itself
 * as the `'siege'` hold owner, so it learns of a participant's removal / preemption directly.
 *
 * Invariant: a unit is listed in a SiegeState ⇔ it holds a `'siege'` commitment for that building.
 * Whoever drops a unit from a SiegeState releases it here.
 */

import type { GameState } from '../../game-state';
import type { CombatSystem } from '../combat/combat-system';
import type { JobService } from '../settler-tasks';

/** Commitment owner of every siege participant. */
export const SIEGE_OWNER = 'siege';

export class SiegeParticipants {
    constructor(
        private readonly gameState: GameState,
        private readonly combatSystem: CombatSystem,
        private readonly jobs: JobService
    ) {}

    /** Whether the unit is reserved by any owner (siege participants included). */
    isReserved(unitId: number): boolean {
        return this.jobs.commitments.isReserved(unitId);
    }

    /** Commit the unit to the siege of `buildingId`: reserved hold, not bumpable. */
    join(unitId: number, buildingId: number): void {
        this.jobs.hold(unitId, SIEGE_OWNER, buildingId, true);
        this.gameState.movement.getController(unitId)!.busy = true;
    }

    /** Release a live participant: clear busy, unlock, release from combat, end the siege hold. */
    release(unitId: number): void {
        this.gameState.movement.getController(unitId)!.busy = false;
        this.combatSystem.unlockTarget(unitId);
        if (this.combatSystem.isInCombat(unitId)) {
            this.combatSystem.releaseFromCombat(unitId);
        }
        this.jobs.releaseHold(unitId, SIEGE_OWNER);
    }

    /** End the siege hold of a defeated participant (about to be removed — no flags to reset). */
    releaseDefeated(unitId: number): void {
        this.jobs.releaseHold(unitId, SIEGE_OWNER);
    }

    /** The building whose siege holds the unit. Nullable by design: undefined ⇔ not a participant. */
    siegeOf(unitId: number): number | undefined {
        const commitment = this.jobs.commitments.get(unitId);
        return commitment && commitment.owner === SIEGE_OWNER ? commitment.ref : undefined;
    }
}
