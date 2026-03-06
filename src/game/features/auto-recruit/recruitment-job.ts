import type { Entity } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { UnitType } from '../../unit-types';
import {
    ChoreoTaskType,
    createChoreoJobState,
    type ChoreoNode,
    type ChoreoJobState,
    type ControlContext,
} from '../settler-tasks/choreo-types';
import { TaskResult } from '../settler-tasks/types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('RecruitmentJob');

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
 * Execute the TRANSFORM_RECRUIT choreography step.
 *
 * Withdraws 1 unit of tool material from the free pile inventory,
 * then emits `recruitment:completed` so the AutoRecruitSystem can
 * trigger the UnitTransformer. Instant (single-tick) executor.
 */
export function executeTransformRecruit(
    settler: Entity,
    job: ChoreoJobState,
    _node: ChoreoNode,
    _dt: number,
    ctx: ControlContext
): TaskResult {
    const pileEntityId = job.targetId;
    if (pileEntityId === null) {
        throw new Error(`TRANSFORM_RECRUIT: settler ${settler.id} has no targetId on job`);
    }

    const pile = ctx.gameState.getEntity(pileEntityId);
    if (!pile) {
        log.warn(`TRANSFORM_RECRUIT: pile ${pileEntityId} no longer exists for settler ${settler.id}`);
        ctx.eventBus.emit('recruitment:failed', { carrierId: settler.id, reason: 'pile_gone' });
        return TaskResult.DONE;
    }

    const material = pile.subType as EMaterialType;
    const withdrawn = ctx.inventoryManager!.withdrawOutput(pileEntityId, material, 1);
    if (withdrawn < 1) {
        log.warn(`TRANSFORM_RECRUIT: pile ${pileEntityId} has no ${material} for settler ${settler.id}`);
        ctx.eventBus.emit('recruitment:failed', { carrierId: settler.id, reason: 'pile_empty' });
        return TaskResult.DONE;
    }

    const targetUnitType = job.carryingGood as unknown as UnitType;

    ctx.eventBus.emit('recruitment:completed', { carrierId: settler.id, targetUnitType });

    log.debug(
        `TRANSFORM_RECRUIT: settler ${settler.id} picked up ${material} from pile ${pileEntityId}, ` +
            `target type ${UnitType[targetUnitType]}`
    );

    return TaskResult.DONE;
}
