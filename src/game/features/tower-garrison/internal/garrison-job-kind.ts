/**
 * The `Garrison` job kind and the Garrison hold owner (docs/designs/job-ownership.md,
 * "Garrison migration").
 *
 * - En route: a reserved Garrison job (ref = tower id, params `{ towerId }`) — goToDoor +
 *   ENTER_BUILDING. Completion finalizes the garrison, which turns the unit into a hold.
 * - Garrisoned: a reserved Garrison hold (ref = tower id), persisted; the slot sets are rebuilt
 *   from the holds on restore.
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { HoldOwnerHandler } from '@/game/features/settler-tasks';
import { JobKind, choreo, type JobKindHandler } from '@/game/systems/choreo';
import type { TowerGarrisonManager } from '../tower-garrison-manager';

/** Params of a Garrison job: the tower the unit walks into. */
export type GarrisonJobParams = { readonly towerId: number };

export interface GarrisonJobKindDeps {
    gameState: GameState;
    terrain: TerrainData;
    manager: TowerGarrisonManager;
}

/** The Garrison kind handler — owner of en-route units' jobs. */
export function createGarrisonJobKind(deps: GarrisonJobKindDeps): JobKindHandler<GarrisonJobParams> {
    const { gameState, terrain, manager } = deps;
    return {
        kind: JobKind.Garrison,
        persist: true,
        restorable: (_unitId, _ref, params) => manager.getGarrison(params.towerId) !== undefined,
        build: (_unitId, params) =>
            choreo('WORKER_DISPATCH').goToDoorAndEnter(params.towerId, { gameState, terrain }).toJobBuild(),
        onCompleted: (unitId, _ref, params) => manager.finalizeGarrison(unitId, params.towerId),
        onFailed: unitId => manager.releaseEnRoute(unitId),
        // Home assignment and location record of the dead unit are dropped by Core / settler-location;
        // the en-route slot count is derived from commitments, so nothing is left to release.
        onUnitRemoved: () => {},
    };
}

/** The Garrison hold owner — owner of garrisoned units. */
export function createGarrisonHoldOwner(manager: TowerGarrisonManager): HoldOwnerHandler {
    return {
        owner: JobKind.Garrison,
        persist: true,
        onUnitRemoved: (unitId, towerId) => manager.onGarrisonedUnitRemoved(unitId, towerId),
        onPreempted: (unitId, towerId) => manager.onGarrisonedUnitPreempted(unitId, towerId),
    };
}
