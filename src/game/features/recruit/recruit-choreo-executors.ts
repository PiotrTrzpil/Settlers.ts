/**
 * Factory functions for carrier-to-specialist transformation choreo executors.
 * Each factory captures its dependencies via closure and returns a ChoreoExecutor
 * that can be registered on a ChoreoSystem instance.
 */

import type { ChoreoExecutor } from '../../systems/choreo';
import { TaskResult } from '../../systems/choreo';
import type { Entity } from '../../entity';
import { UnitType } from '../../core/unit-types';
import type { ChoreoJobState } from '../../systems/choreo';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { ToolSourceResolver } from '../../systems/recruit/tool-source-resolver';
import { createLogger } from '@/utilities/logger';

const log = createLogger('RecruitmentJob');

/**
 * Create a TRANSFORM_RECRUIT executor.
 *
 * Withdraws 1 unit of tool material from the pile's inventory slot (free, output, or storage),
 * then emits `recruitment:completed` so UnitTransformer can finalize the transform.
 * Instant (single-tick) executor.
 */
export function createTransformRecruitExecutor(
    _gameState: GameState,
    eventBus: EventBus,
    inventoryManager: BuildingInventoryManager
): ChoreoExecutor {
    return (settler: Entity, job: ChoreoJobState) => {
        const pileEntityId = job.targetId;
        if (pileEntityId === null) {
            throw new Error(`TRANSFORM_RECRUIT: settler ${settler.id} has no targetId on job`);
        }

        const slot = inventoryManager.getSlotByEntityId(pileEntityId);
        if (!slot || slot.currentAmount < 1) {
            const reason = slot ? 'pile_empty' : 'pile_gone';
            log.warn(`TRANSFORM_RECRUIT: pile ${pileEntityId} ${reason} for settler ${settler.id}`);
            eventBus.emit('recruitment:failed', {
                unitId: settler.id,
                unitType: settler.subType as UnitType,
                reason,
                level: 'warn',
            });
            return TaskResult.DONE;
        }

        inventoryManager.withdraw(slot.id, 1);

        const targetUnitType = job.metadata!['unitType'] as UnitType;
        eventBus.emit('recruitment:completed', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            targetUnitType,
            level: 'info',
        });
        log.debug(
            `TRANSFORM_RECRUIT: settler ${settler.id} picked up ${slot.materialType} from pile ${pileEntityId}, ` +
                `target type ${targetUnitType}`
        );
        return TaskResult.DONE;
    };
}

/**
 * Create a TRANSFORM_RECRUIT_BUILDING executor.
 *
 * Withdraws multiple materials from a building's inventory via a reservation handle,
 * then emits `recruitment:completed` so UnitTransformer can finalize the transform.
 * Instant (single-tick) executor.
 */
export function createTransformRecruitBuildingExecutor(
    eventBus: EventBus,
    toolSourceResolver: ToolSourceResolver
): ChoreoExecutor {
    return (settler: Entity, job: ChoreoJobState) => {
        const reservationId = job.metadata!['reservationId'] as number;
        const handle = toolSourceResolver.getReservationHandle(reservationId);
        if (!handle) {
            log.warn(`TRANSFORM_RECRUIT_BUILDING: no reservation handle ${reservationId} for settler ${settler.id}`);
            eventBus.emit('recruitment:failed', {
                unitId: settler.id,
                unitType: settler.subType as UnitType,
                reason: 'reservation_gone',
                level: 'warn',
            });
            return TaskResult.DONE;
        }

        toolSourceResolver.withdrawBuildingReservation(handle);

        const targetUnitType = job.metadata!['unitType'] as UnitType;
        eventBus.emit('recruitment:completed', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            targetUnitType,
            level: 'info',
        });
        log.debug(
            `TRANSFORM_RECRUIT_BUILDING: settler ${settler.id} consumed materials from building ${handle.buildingId}, ` +
                `target type ${targetUnitType}`
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
        const targetUnitType = job.metadata!['unitType'] as UnitType;
        eventBus.emit('recruitment:completed', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            targetUnitType,
            level: 'info',
        });
        log.debug(`TRANSFORM_DIRECT: settler ${settler.id} transforming directly into ${targetUnitType}`);
        return TaskResult.DONE;
    };
}
