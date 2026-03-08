import type { EMaterialType } from '../../economy/material-type';
import { UnitType } from '../../core/unit-types';
import { ChoreoTaskType, createChoreoJobState, type ChoreoNode, type ChoreoJobState } from '../choreo';

/**
 * Build a choreography job for a carrier to walk to a free pile and transform into a specialist.
 *
 * Nodes: GO_TO_TARGET (walk to pile) -> TRANSFORM_RECRUIT (withdraw tool, emit event).
 * The targetUnitType is stashed in `job.carryingGood` (repurposed as a numeric slot).
 */
export function createRecruitmentJob(
    pileEntityId: number,
    pileX: number,
    pileY: number,
    targetUnitType: UnitType
): ChoreoJobState {
    const nodes: ChoreoNode[] = [
        {
            task: ChoreoTaskType.GO_TO_TARGET,
            jobPart: '',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: true,
            visible: true,
            useWork: false,
            entity: '',
            trigger: '',
        },
        {
            task: ChoreoTaskType.TRANSFORM_RECRUIT,
            jobPart: '',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: true,
            visible: true,
            useWork: false,
            entity: '',
            trigger: '',
        },
    ];
    const job = createChoreoJobState('AUTO_RECRUIT', nodes);
    job.targetId = pileEntityId;
    job.targetPos = { x: pileX, y: pileY };
    // Stash targetUnitType in carryingGood — both are numeric enums.
    job.carryingGood = targetUnitType as unknown as EMaterialType;
    return job;
}

/**
 * Build a choreography job for a carrier to transform directly into a specialist without a tool.
 *
 * Node: TRANSFORM_DIRECT (instant — no movement, no tool withdrawal).
 * The targetUnitType is stashed in `job.carryingGood` (repurposed as a numeric slot).
 */
export function createDirectTransformJob(targetUnitType: UnitType): ChoreoJobState {
    const nodes: ChoreoNode[] = [
        {
            task: ChoreoTaskType.TRANSFORM_DIRECT,
            jobPart: '',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: true,
            visible: true,
            useWork: false,
            entity: '',
            trigger: '',
        },
    ];
    const job = createChoreoJobState('AUTO_RECRUIT', nodes);
    job.carryingGood = targetUnitType as unknown as EMaterialType;
    return job;
}
