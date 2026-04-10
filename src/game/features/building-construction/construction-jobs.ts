/**
 * Choreo job factories for construction workers (diggers and builders).
 *
 * Each factory returns a ChoreoJobState ready to be assigned to a worker.
 * The siteId is stashed in metadata so executors and the demand system
 * can look up the construction site.
 */

import { UnitType } from '@/game/core/unit-types';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import { ChoreoTaskType, type ChoreoJobState } from '@/game/systems/choreo/types';

/** Build a choreo job for a digger to level one tile at the given position. */
export function buildDigTileJob(tileX: number, tileY: number, siteId: number, tileIndex: number): ChoreoJobState {
    return choreo('DIG_TILE')
        .goTo({ x: tileX, y: tileY })
        .addNode(ChoreoTaskType.DIG_TILE)
        .meta({ siteId, tileIndex })
        .build();
}

/** Build a choreo job for a builder to perform one build cycle at the given position. */
export function buildBuildStepJob(posX: number, posY: number, siteId: number): ChoreoJobState {
    return choreo('BUILD_STEP').goTo({ x: posX, y: posY }).addNode(ChoreoTaskType.BUILD_STEP).meta({ siteId }).build();
}

/** Combined recruit-then-dig: carrier walks to pile, transforms to digger, walks to tile, digs. */
export function buildRecruitDiggerJob(
    pileX: number,
    pileY: number,
    pileEntityId: number,
    tileX: number,
    tileY: number,
    siteId: number,
    tileIndex: number
): ChoreoJobState {
    return choreo('RECRUIT_DIGGER')
        .goTo({ x: pileX, y: pileY }, pileEntityId)
        .transformRecruit(UnitType.Digger)
        .goTo({ x: tileX, y: tileY })
        .addNode(ChoreoTaskType.DIG_TILE)
        .target(pileEntityId)
        .meta({ siteId, tileIndex })
        .build();
}

/** Combined recruit-then-build: carrier walks to pile, transforms to builder, walks to site, builds. */
export function buildRecruitBuilderJob(
    pileX: number,
    pileY: number,
    pileEntityId: number,
    posX: number,
    posY: number,
    siteId: number
): ChoreoJobState {
    return choreo('RECRUIT_BUILDER')
        .goTo({ x: pileX, y: pileY }, pileEntityId)
        .transformRecruit(UnitType.Builder)
        .goTo({ x: posX, y: posY })
        .addNode(ChoreoTaskType.BUILD_STEP)
        .target(pileEntityId)
        .meta({ siteId })
        .build();
}
