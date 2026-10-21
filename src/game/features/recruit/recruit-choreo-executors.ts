/**
 * Factory functions for carrier-to-specialist transformation choreo executors.
 * Each factory captures its dependencies via closure and returns a ChoreoExecutor
 * that can be registered on a ChoreoSystem instance.
 */

import type { ChoreoExecutor, ChoreoJobState, ChoreoNode } from '../../systems/choreo';
import { TaskResult } from '../../systems/choreo';
import type { Entity } from '../../entity';
import { UnitType } from '../../core/unit-types';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { ToolSourceResolver } from './tool-source-resolver';
import { transformArgsOf } from './recruit-segments';
import { createLogger } from '@/utilities/logger';

const log = createLogger('RecruitmentJob');

/** Target unit type of a TRANSFORM_* node: `node.args.transform` (owned jobs) or legacy metadata. */
function targetUnitTypeOf(node: ChoreoNode, job: ChoreoJobState): UnitType {
    if (node.args) {
        return transformArgsOf(node).unitType;
    }
    // TRANSITIONAL (deleted in Cleanup): legacy jobs stash the unit type in metadata.
    return job.metadata!['unitType'] as UnitType;
}

/** Tool pile of a TRANSFORM_RECRUIT node: `node.args.transform.sourceId` or the legacy job target. */
function toolPileOf(settler: Entity, node: ChoreoNode, job: ChoreoJobState): number {
    if (node.args) {
        return transformArgsOf(node).sourceId!;
    }
    // TRANSITIONAL (deleted in Cleanup): legacy jobs target the pile.
    if (job.targetId === null) {
        throw new Error(`TRANSFORM_RECRUIT: settler ${settler.id} has no targetId on job`);
    }
    return job.targetId;
}

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
    return (settler, job, node) => {
        const pileEntityId = toolPileOf(settler, node, job);

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

        const targetUnitType = targetUnitTypeOf(node, job);
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
 * Withdraws the carrier's reserved materials from the building's inventory,
 * then emits `recruitment:completed` so UnitTransformer can finalize the transform.
 * Instant (single-tick) executor.
 */
export function createTransformRecruitBuildingExecutor(
    eventBus: EventBus,
    toolSourceResolver: ToolSourceResolver
): ChoreoExecutor {
    return (settler, job, node) => {
        // Reservations are keyed by the carrier (legacy metadata.reservationId is the carrier id too).
        const reservation = toolSourceResolver.withdrawBuildingReservation(settler.id);

        const targetUnitType = targetUnitTypeOf(node, job);
        eventBus.emit('recruitment:completed', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            targetUnitType,
            level: 'info',
        });
        log.debug(
            `TRANSFORM_RECRUIT_BUILDING: settler ${settler.id} consumed materials from building ${reservation.buildingId}, ` +
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
    return (settler, job, node) => {
        const targetUnitType = targetUnitTypeOf(node, job);
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
