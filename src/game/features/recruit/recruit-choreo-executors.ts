/**
 * Factory functions for carrier-to-specialist transformation choreo executors.
 * Each factory captures its dependencies via closure and returns a ChoreoExecutor
 * that can be registered on a ChoreoSystem instance.
 */

import type { ChoreoExecutor } from '../../systems/choreo';
import { TaskResult } from '../../systems/choreo';
import type { Entity } from '../../entity';
import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';
import type { ChoreoJobState } from '../../systems/choreo';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import { createLogger } from '@/utilities/logger';

const log = createLogger('RecruitmentJob');

/**
 * Create a TRANSFORM_RECRUIT executor.
 *
 * Withdraws 1 unit of tool material from the free pile inventory,
 * then emits `recruitment:completed` so UnitTransformer can finalize the transform.
 * Instant (single-tick) executor.
 */
export function createTransformRecruitExecutor(
    gameState: GameState,
    eventBus: EventBus,
    inventoryManager: BuildingInventoryManager
): ChoreoExecutor {
    return (settler: Entity, job: ChoreoJobState) => {
        const pileEntityId = job.targetId;
        if (pileEntityId === null) {
            throw new Error(`TRANSFORM_RECRUIT: settler ${settler.id} has no targetId on job`);
        }

        const pile = gameState.getEntity(pileEntityId);
        if (!pile) {
            log.warn(`TRANSFORM_RECRUIT: pile ${pileEntityId} no longer exists for settler ${settler.id}`);
            eventBus.emit('recruitment:failed', { carrierId: settler.id, reason: 'pile_gone' });
            return TaskResult.DONE;
        }

        const material = pile.subType as EMaterialType;
        const withdrawn = inventoryManager.withdrawOutput(pileEntityId, material, 1);
        if (withdrawn < 1) {
            log.warn(`TRANSFORM_RECRUIT: pile ${pileEntityId} has no ${material} for settler ${settler.id}`);
            eventBus.emit('recruitment:failed', { carrierId: settler.id, reason: 'pile_empty' });
            return TaskResult.DONE;
        }

        const targetUnitType = job.metadata!['unitType'] as number as UnitType;
        eventBus.emit('recruitment:completed', { carrierId: settler.id, targetUnitType });
        log.debug(
            `TRANSFORM_RECRUIT: settler ${settler.id} picked up ${material} from pile ${pileEntityId}, ` +
                `target type ${UnitType[targetUnitType]}`
        );
        return TaskResult.DONE;
    };
}

/**
 * Create a TRANSFORM_DIRECT executor.
 *
 * Emits `recruitment:completed` directly — no tool pile involved.
 * Instant (single-tick) executor.
 */
export function createTransformDirectExecutor(eventBus: EventBus): ChoreoExecutor {
    return (settler: Entity, job: ChoreoJobState) => {
        const targetUnitType = job.metadata!['unitType'] as number as UnitType;
        eventBus.emit('recruitment:completed', { carrierId: settler.id, targetUnitType });
        log.debug(`TRANSFORM_DIRECT: settler ${settler.id} transforming directly into ${UnitType[targetUnitType]}`);
        return TaskResult.DONE;
    };
}
