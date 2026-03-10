import { UnitType } from '../../core/unit-types';
import { choreo, type ChoreoJobState } from '../choreo';

/**
 * Build a choreography job for a carrier to walk to a free pile and transform into a specialist.
 *
 * Nodes: GO_TO_TARGET (walk to pile) -> TRANSFORM_RECRUIT (withdraw tool, emit event).
 * The targetUnitType is stashed in `job.metadata.unitType`.
 */
export function createRecruitmentJob(
    pileEntityId: number,
    pileX: number,
    pileY: number,
    targetUnitType: UnitType
): ChoreoJobState {
    return choreo('AUTO_RECRUIT')
        .goTo(pileX, pileY, pileEntityId)
        .transformRecruit(targetUnitType)
        .target(pileEntityId)
        .build();
}

/**
 * Build a choreography job for a carrier to transform directly into a specialist without a tool.
 *
 * Node: TRANSFORM_DIRECT (instant — no movement, no tool withdrawal).
 * The targetUnitType is stashed in `job.metadata.unitType`.
 */
export function createDirectTransformJob(targetUnitType: UnitType): ChoreoJobState {
    return choreo('AUTO_RECRUIT').transformDirect(targetUnitType).build();
}
