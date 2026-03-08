/**
 * Movement choreography executors — Phase 2A + 2B.
 *
 * Implements all ChoreoTaskType movement executors:
 *   - Regular movement (GO_TO_TARGET, GO_TO_TARGET_ROUGHLY, GO_TO_POS, GO_TO_POS_ROUGHLY,
 *     GO_HOME, GO_TO_SOURCE_PILE, GO_TO_DESTINATION_PILE, SEARCH)
 *   - Virtual (interior/invisible) movement (GO_VIRTUAL)
 *
 * Each executor matches the MovementExecutorFn signature defined in choreo-types.ts.
 */

import { EntityType, BuildingType, type Entity } from '../../../entity';
import { getBuildingDoorPos } from '../../../data/game-data-access';
import { hexDistance, getApproxDirection } from '../../../systems/hex-directions';
import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import type { ChoreoNode, MovementExecutorFn, ChoreoJobState, MovementContext } from '../choreo-types';
import { safeCall } from '../safe-call';

const log = createLogger('MovementExecutors');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Arrival threshold for regular (precise) movement tasks. */
const ARRIVAL_DIST = 1;

/** Arrival threshold for "roughly" movement tasks — settler doesn't need to be adjacent. */
const ARRIVAL_DIST_ROUGH = 2;

/** Ticks to wait before retrying pathfinding after a failed attempt. */
const PATH_RETRY_COOLDOWN = 10;

// ─────────────────────────────────────────────────────────────
// Shared movement helper
// ─────────────────────────────────────────────────────────────

/**
 * Core movement helper: issue a movement command if idle, check arrival condition.
 *
 * - Gets the settler's MovementController from ctx.gameState.movement.
 * - Returns DONE when hexDistance ≤ arrivalDist and controller is idle.
 * - Issues moveUnit() when idle and out of range.
 * - Returns CONTINUE while moving.
 * - Returns FAILED if no controller or pathfinding fails.
 *
 * When node.dir !== -1, the controller's direction is set on arrival.
 */
/** Try to issue pathfinding with retry cooldown. Returns true if movement was started. */
function tryIssuePath(
    settler: Entity,
    targetX: number,
    targetY: number,
    ctx: MovementContext,
    job?: ChoreoJobState
): boolean {
    if (job && job.pathRetryCountdown > 0) {
        job.pathRetryCountdown--;
        return false;
    }
    const moved = ctx.gameState.movement.moveUnit(settler.id, targetX, targetY);
    if (!moved) {
        if (job) job.pathRetryCountdown = PATH_RETRY_COOLDOWN;
        log.debug(`moveToPosition: path failed for settler ${settler.id}, retrying in ${PATH_RETRY_COOLDOWN} ticks`);
        return false;
    }
    if (job) job.pathRetryCountdown = 0;
    return true;
}

export function moveToPosition(
    settler: Entity,
    targetX: number,
    targetY: number,
    node: ChoreoNode,
    ctx: MovementContext,
    arrivalDist: number = ARRIVAL_DIST,
    job?: ChoreoJobState
): TaskResult {
    const controller = ctx.gameState.movement.getController(settler.id);
    if (!controller) {
        log.warn(`moveToPosition: no movement controller for settler ${settler.id}`);
        return TaskResult.FAILED;
    }

    if (hexDistance(settler.x, settler.y, targetX, targetY) <= arrivalDist && controller.state === 'idle') {
        if (node.dir !== -1) controller.setDirection(node.dir);
        return TaskResult.DONE;
    }

    if (controller.state === 'idle') {
        tryIssuePath(settler, targetX, targetY, ctx, job);
    }

    return TaskResult.CONTINUE;
}

// ─────────────────────────────────────────────────────────────
// Helper: resolve the assigned-building ID for a settler
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the settler's home/assigned building ID.
 * Uses ctx.getWorkerHomeBuilding for worker settlers.
 * Throws if no building is assigned (contract violation).
 */
function resolveAssignedBuildingId(settler: Entity, ctx: MovementContext): number {
    const buildingId = ctx.getWorkerHomeBuilding(settler.id);
    if (buildingId === null) {
        throw new Error(
            `Settler ${settler.id}: no assigned building found. Choreography requires an assigned building.`
        );
    }
    return buildingId;
}

// ─────────────────────────────────────────────────────────────
// Phase 2A — Regular movement executors
// ─────────────────────────────────────────────────────────────

/** GO_TO_TARGET / GO_TO_TARGET_ROUGHLY — move to entity or position target. */
function makeGoToTarget(arrivalDist: number): MovementExecutorFn {
    return (settler, job, node, _dt, ctx) => {
        if (job.targetId !== null) {
            const target = ctx.gameState.getEntityOrThrow(job.targetId, 'GO_TO_TARGET target');

            if (target.type === EntityType.Building) {
                const door = getBuildingDoorPos(target.x, target.y, target.race, target.subType as BuildingType);
                return moveToPosition(settler, door.x, door.y, node, ctx, arrivalDist, job);
            }

            return moveToPosition(settler, target.x, target.y, node, ctx, arrivalDist, job);
        }

        if (job.targetPos) {
            return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, arrivalDist, job);
        }

        log.debug(`executeGoToTarget: settler ${settler.id} has no target`);
        return TaskResult.FAILED;
    };
}

export const executeGoToTarget = makeGoToTarget(ARRIVAL_DIST);
export const executeGoToTargetRoughly = makeGoToTarget(ARRIVAL_DIST_ROUGH);

/** GO_TO_POS / GO_TO_POS_ROUGHLY — move to building-relative position. */
function makeGoToPos(arrivalDist: number): MovementExecutorFn {
    return (settler, job, node, _dt, ctx) => {
        if (!job.targetPos) {
            const buildingId = resolveAssignedBuildingId(settler, ctx);
            job.targetPos = ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork);
        }

        return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, arrivalDist, job);
    };
}

export const executeGoToPos = makeGoToPos(ARRIVAL_DIST);
export const executeGoToPosRoughly = makeGoToPos(ARRIVAL_DIST_ROUGH);

/**
 * GO_HOME — move to the settler's home building door.
 *
 * Resolves the home building via ctx.getWorkerHomeBuilding(settler.id),
 * then navigates to its door offset (or building position if door offset is zero).
 */
export const executeGoHome: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    const homeId = ctx.getWorkerHomeBuilding(settler.id);
    if (homeId === null) {
        log.debug(`executeGoHome: settler ${settler.id} has no home building`);
        return TaskResult.FAILED;
    }

    const building = ctx.gameState.getEntityOrThrow(homeId, 'GO_HOME home building');
    const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);

    return moveToPosition(settler, door.x, door.y, node, ctx, ARRIVAL_DIST, job);
};

/**
 * GO_TO_SOURCE_PILE — move to a source pile position for pickup.
 *
 * For carrier transport jobs: reads the source position directly from
 * transportData.sourcePos, pre-resolved by TransportJobBuilder.
 * For regular workers: resolves the building-relative (x, y) offset from the XML node,
 * identical to GO_TO_POS.
 */
export const executeGoToSourcePile: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    // Transport jobs: read source directly from transport data
    if (job.transportData) {
        const { sourcePos } = job.transportData;
        return moveToPosition(settler, sourcePos.x, sourcePos.y, node, ctx, ARRIVAL_DIST, job);
    }

    // Regular workers: resolve building-relative offset (same as GO_TO_POS)
    return executeGoToPos(settler, job, node, _dt, ctx);
};

/**
 * GO_TO_DESTINATION_PILE — move to a destination pile position for delivery.
 *
 * For carrier transport jobs: reads the destination position directly from
 * transportData.destPos, making the data flow explicit (no cross-node targetPos coupling).
 * For regular workers: resolves the building-relative (x, y) offset from the XML node,
 * identical to GO_TO_POS.
 */
export const executeGoToDestinationPile: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    // Transport jobs: read destination directly from transport data
    if (job.transportData) {
        const { destPos } = job.transportData;
        return moveToPosition(settler, destPos.x, destPos.y, node, ctx, ARRIVAL_DIST, job);
    }

    // Regular workers: resolve building-relative offset (same as GO_TO_POS)
    return executeGoToPos(settler, job, node, _dt, ctx);
};

/** Try entity handler search. Returns null when entityHandler is absent. */
function searchViaEntityHandler(settler: Entity, job: ChoreoJobState, ctx: MovementContext): TaskResult | null {
    if (!ctx.entityHandler) return null;
    const { entityHandler, handlerErrorLogger } = ctx;

    const result = safeCall(
        () => entityHandler.findTarget(settler.x, settler.y, settler.id, settler.player),
        handlerErrorLogger,
        `SEARCH findTarget failed for settler ${settler.id}`
    );
    if (result === undefined) return TaskResult.FAILED;

    if (result) {
        job.targetId = result.entityId;
        job.targetPos = { x: result.x, y: result.y };
        log.debug(`executeSearch: settler ${settler.id} found entity ${result.entityId}`);
        return TaskResult.DONE;
    }

    if (entityHandler.shouldWaitForWork) return TaskResult.CONTINUE;
    log.debug(`executeSearch: settler ${settler.id} found no entity target`);
    return TaskResult.FAILED;
}

/** Get the search center for a position handler — work area center or settler position. */
function getPositionSearchCenter(settler: Entity, ctx: MovementContext): { x: number; y: number } {
    if (ctx.positionHandler?.useWorkAreaCenter) {
        const homeId = ctx.getWorkerHomeBuilding(settler.id);
        if (homeId !== null) {
            return ctx.buildingPositionResolver.resolvePosition(homeId, 0, 0, true);
        }
    }
    return settler;
}

/** Try position handler search. Returns null when positionHandler is absent. */
function searchViaPositionHandler(settler: Entity, job: ChoreoJobState, ctx: MovementContext): TaskResult | null {
    if (!ctx.positionHandler) return null;
    const { positionHandler, handlerErrorLogger } = ctx;
    const center = getPositionSearchCenter(settler, ctx);

    const pos = safeCall(
        () => positionHandler.findPosition(center.x, center.y, settler.id),
        handlerErrorLogger,
        `SEARCH findPosition failed for settler ${settler.id}`
    );
    if (pos === undefined) return TaskResult.FAILED;

    if (pos) {
        job.targetPos = { x: pos.x, y: pos.y };
        log.debug(`executeSearch: settler ${settler.id} found position (${pos.x}, ${pos.y})`);
        return TaskResult.DONE;
    }

    if (positionHandler.shouldWaitForWork) return TaskResult.CONTINUE;
    log.debug(`executeSearch: settler ${settler.id} found no position target`);
    return TaskResult.FAILED;
}

/**
 * SEARCH — find a target entity or position via the registered work handler.
 *
 * Tries entityHandler first, then positionHandler.
 * - DONE when a target is found.
 * - CONTINUE when nothing found and shouldWaitForWork is true.
 * - FAILED when nothing found and shouldWaitForWork is false.
 */
export const executeSearch: MovementExecutorFn = (settler, job, _node, _dt, ctx) => {
    const entityResult = searchViaEntityHandler(settler, job, ctx);
    if (entityResult !== null) return entityResult;

    const posResult = searchViaPositionHandler(settler, job, ctx);
    if (posResult !== null) return posResult;

    log.warn(`executeSearch: settler ${settler.id} has no handler in context`);
    return TaskResult.FAILED;
};

// ─────────────────────────────────────────────────────────────
// Phase 2B — Virtual movement executors
// ─────────────────────────────────────────────────────────────

/**
 * GO_VIRTUAL — interior/invisible building movement.
 *
 * The settler is hidden (job.visible = false, settler.hidden = true) and
 * teleported instantly to the resolved building-relative position.
 * No pathfinding is used.
 *
 * If node.dir !== -1, the settler's direction is set to node.dir.
 * Returns DONE immediately after positioning.
 */
export const executeGoVirtual: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    const buildingId = resolveAssignedBuildingId(settler, ctx);

    // When working on a target entity with useWork offsets, resolve positions
    // relative to the target (e.g. woodcutter cutting around a tree) rather than
    // the building work area, so the settler stays near the work site.
    // Walk visibly instead of teleporting so movement between cutting positions
    // looks natural.
    const target = job.targetId !== null && node.useWork ? ctx.gameState.getEntity(job.targetId) : null;
    if (target) {
        if (!job.targetPos) {
            job.targetPos = { x: target.x + node.x, y: target.y + node.y };
        }
        return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST, job);
    }

    // No target entity — interior/building teleport (original behavior)
    const pos = ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork);

    // Hide the settler inside the building
    job.visible = false;
    settler.hidden = true;

    // Teleport to resolved interior position
    settler.x = pos.x;
    settler.y = pos.y;

    // Sync movement controller so it doesn't produce stale visual state
    const controller = ctx.gameState.movement.getController(settler.id);
    if (controller) {
        controller.syncPosition(pos.x, pos.y);

        // Apply explicit direction if specified
        if (node.dir !== -1) {
            controller.setDirection(node.dir);
        } else {
            // Default: face toward the building's center if possible
            const building = ctx.gameState.getEntity(buildingId);
            if (building) {
                const dir = getApproxDirection(pos.x, pos.y, building.x, building.y);
                controller.setDirection(dir);
            }
        }
    }

    log.debug(`executeGoVirtual: settler ${settler.id} moved to (${pos.x}, ${pos.y}) inside building ${buildingId}`);
    return TaskResult.DONE;
};
