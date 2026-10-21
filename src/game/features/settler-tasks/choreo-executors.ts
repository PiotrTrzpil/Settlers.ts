/**
 * Core choreography executor registration — the domain-free part of the job runtime.
 *
 * settler-tasks registers only the executors that know nothing about a specific domain:
 * movement (GO_TO_*, GO_HOME, GO_VIRTUAL, SEARCH), work timing + work-handler callbacks
 * (WORK*, PLANT, PRODUCE_VIRTUAL) and control flow (WAIT*, CHECKIN, CHANGE_JOB*).
 *
 * Domain executors are registered on the same kernel ChoreoSystem by their owning features:
 * goods (material-transfer), construction (DIG_TILE/BUILD_STEP), recruit (TRANSFORM_*),
 * logistics (TRANSPORT_*), combat (HEAL_ENTITY/ATTACK_REACTION), settler-location (ENTER_BUILDING).
 */

import { ChoreoTaskType, type ChoreoSystem } from '../../systems/choreo';
import type { GameState } from '../../game-state';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { TriggerSystem } from '../building-overlays';
import type { MovementContext, WorkContext, BuildingPositionResolver } from './choreo-types';

// Movement
import {
    executeGoToTarget,
    executeGoToTargetRoughly,
    executeGoToPos,
    executeGoToPosRoughly,
    executeGoHome,
    executeGoToSourcePile,
    executeGoToDestinationPile,
    executeSearch,
    executeGoVirtual,
} from './internal/movement-executors';

// Work
import {
    executeWork,
    executeWorkOnEntity,
    executeWorkVirtual,
    executeWorkOnEntityVirtual,
    executeProduceVirtual,
} from './internal/work-executors';

// Control
import { executeWait, executeCheckin, executeChangeJob } from './internal/control-executors';

/** Stable services captured by the core executors. */
export interface CoreExecutorDeps {
    gameState: GameState;
    buildingPositionResolver: BuildingPositionResolver;
    triggerSystem: TriggerSystem;
    handlerErrorLogger: ThrottledLogger;
}

function registerMovementExecutors(choreoSystem: ChoreoSystem, movCtx: MovementContext): void {
    const movementExecutors = [
        [ChoreoTaskType.GO_TO_TARGET, executeGoToTarget],
        [ChoreoTaskType.GO_TO_TARGET_ROUGHLY, executeGoToTargetRoughly],
        [ChoreoTaskType.GO_TO_POS, executeGoToPos],
        [ChoreoTaskType.GO_TO_POS_ROUGHLY, executeGoToPosRoughly],
        [ChoreoTaskType.GO_TO_SOURCE_PILE, executeGoToSourcePile],
        [ChoreoTaskType.GO_TO_DESTINATION_PILE, executeGoToDestinationPile],
        [ChoreoTaskType.GO_HOME, executeGoHome],
        [ChoreoTaskType.GO_VIRTUAL, executeGoVirtual],
        [ChoreoTaskType.SEARCH, executeSearch],
    ] as const;
    for (const [taskType, fn] of movementExecutors) {
        choreoSystem.register(taskType, (s, j, n, dt, scope) => fn(s, j, n, dt, movCtx, scope));
    }
}

function registerWorkExecutors(choreoSystem: ChoreoSystem, workCtx: WorkContext): void {
    const workExecutors = [
        [ChoreoTaskType.WORK, executeWork],
        [ChoreoTaskType.WORK_ON_ENTITY, executeWorkOnEntity],
        [ChoreoTaskType.WORK_VIRTUAL, executeWorkVirtual],
        [ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL, executeWorkOnEntityVirtual],
        [ChoreoTaskType.PRODUCE_VIRTUAL, executeProduceVirtual],
        [ChoreoTaskType.PLANT, executeWork],
    ] as const;
    for (const [taskType, fn] of workExecutors) {
        choreoSystem.register(taskType, (s, j, n, dt, scope) => fn(s, j, n, dt, workCtx, scope));
    }
}

function registerControlExecutors(choreoSystem: ChoreoSystem): void {
    choreoSystem.register(ChoreoTaskType.WAIT, executeWait);
    choreoSystem.register(ChoreoTaskType.WAIT_VIRTUAL, (s, j, n, dt) => {
        j.visible = false;
        return executeWait(s, j, n, dt);
    });
    choreoSystem.register(ChoreoTaskType.CHECKIN, executeCheckin);
    choreoSystem.register(ChoreoTaskType.CHANGE_JOB, executeChangeJob);
    choreoSystem.register(ChoreoTaskType.CHANGE_JOB_COME_TO_WORK, executeChangeJob);
}

/**
 * Register all core (domain-free) choreography executors on the kernel ChoreoSystem.
 * Executors are closures over immutable service contexts; per-unit state arrives via
 * the ChoreoExecutionScope argument.
 */
export function registerCoreExecutors(choreoSystem: ChoreoSystem, deps: CoreExecutorDeps): void {
    const movCtx: MovementContext = {
        gameState: deps.gameState,
        buildingPositionResolver: deps.buildingPositionResolver,
        handlerErrorLogger: deps.handlerErrorLogger,
    };
    const workCtx: WorkContext = {
        gameState: deps.gameState,
        triggerSystem: deps.triggerSystem,
        handlerErrorLogger: deps.handlerErrorLogger,
    };

    registerMovementExecutors(choreoSystem, movCtx);
    registerWorkExecutors(choreoSystem, workCtx);
    registerControlExecutors(choreoSystem);
}
