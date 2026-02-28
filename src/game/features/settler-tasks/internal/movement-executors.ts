/**
 * Movement choreography executors — Phase 2A + 2B.
 *
 * Implements all ChoreoTaskType movement executors:
 *   - Regular movement (GO_TO_TARGET, GO_TO_TARGET_ROUGHLY, GO_TO_POS, GO_TO_POS_ROUGHLY,
 *     GO_HOME, GO_TO_SOURCE_PILE, GO_TO_DESTINATION_PILE, SEARCH)
 *   - Virtual (interior/invisible) movement (GO_VIRTUAL)
 *
 * Each executor matches the ChoreoExecutorFn signature defined in choreo-types.ts.
 */

import { EntityType, BuildingType, type Entity } from '../../../entity';
import { getBuildingDoorOffset } from '../../../game-data-access';
import { hexDistance, getApproxDirection } from '../../../systems/hex-directions';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult } from '../types';
import type { ChoreoNode, ChoreoContext, ChoreoExecutorFn, ChoreoJobState } from '../choreo-types';

const log = new LogHandler('MovementExecutors');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Arrival threshold for regular (precise) movement tasks. */
const ARRIVAL_DIST = 1;

/** Arrival threshold for "roughly" movement tasks — settler doesn't need to be adjacent. */
const ARRIVAL_DIST_ROUGH = 2;

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
export function moveToPosition(
    settler: Entity,
    targetX: number,
    targetY: number,
    node: ChoreoNode,
    ctx: ChoreoContext,
    arrivalDist: number = ARRIVAL_DIST
): TaskResult {
    const controller = ctx.gameState.movement.getController(settler.id);
    if (!controller) {
        log.warn(`moveToPosition: no movement controller for settler ${settler.id}`);
        return TaskResult.FAILED;
    }

    const dist = hexDistance(settler.x, settler.y, targetX, targetY);

    if (dist <= arrivalDist && controller.state === 'idle') {
        // Apply explicit direction on arrival if specified
        if (node.dir !== -1) {
            controller.setDirection(node.dir);
        }
        return TaskResult.DONE;
    }

    if (controller.state === 'idle') {
        const moved = ctx.gameState.movement.moveUnit(settler.id, targetX, targetY);
        if (!moved) {
            log.debug(`moveToPosition: moveUnit failed for settler ${settler.id} -> (${targetX}, ${targetY})`);
            return TaskResult.FAILED;
        }
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
function resolveAssignedBuildingId(settler: Entity, ctx: ChoreoContext): number {
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

/**
 * GO_TO_TARGET — move to the target entity's position (from job.targetId).
 * If the target is a building, navigate to its door tile.
 * DONE when hexDistance ≤ 1 and controller idle.
 */
export const executeGoToTarget: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (job.targetId === null) {
        log.debug(`executeGoToTarget: settler ${settler.id} has no targetId`);
        return TaskResult.FAILED;
    }

    const target = ctx.gameState.getEntityOrThrow(job.targetId, 'GO_TO_TARGET target');

    if (target.type === EntityType.Building) {
        const door = getBuildingDoorOffset(target.race, target.subType as BuildingType);
        if (door) {
            return moveToPosition(settler, target.x + door.dx, target.y + door.dy, node, ctx, ARRIVAL_DIST);
        }
    }

    return moveToPosition(settler, target.x, target.y, node, ctx, ARRIVAL_DIST);
};

/**
 * GO_TO_TARGET_ROUGHLY — same as GO_TO_TARGET but with a larger arrival threshold (≤ 2).
 */
export const executeGoToTargetRoughly: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (job.targetId === null) {
        log.debug(`executeGoToTargetRoughly: settler ${settler.id} has no targetId`);
        return TaskResult.FAILED;
    }

    const target = ctx.gameState.getEntityOrThrow(job.targetId, 'GO_TO_TARGET_ROUGHLY target');

    if (target.type === EntityType.Building) {
        const door = getBuildingDoorOffset(target.race, target.subType as BuildingType);
        if (door) {
            return moveToPosition(settler, target.x + door.dx, target.y + door.dy, node, ctx, ARRIVAL_DIST_ROUGH);
        }
    }

    return moveToPosition(settler, target.x, target.y, node, ctx, ARRIVAL_DIST_ROUGH);
};

/**
 * GO_TO_POS — move to a building-relative position resolved from the node's (x, y).
 *
 * On first tick (progress === 0): resolves the world position via
 * ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork)
 * and caches it in job.targetPos.
 * Subsequent ticks reuse the cached position.
 */
export const executeGoToPos: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        job.targetPos = ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork);
    }

    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST);
};

/**
 * GO_TO_POS_ROUGHLY — same as GO_TO_POS but with a larger arrival threshold (≤ 2).
 */
export const executeGoToPosRoughly: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        job.targetPos = ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork);
    }

    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST_ROUGH);
};

/**
 * GO_HOME — move to the settler's home building door.
 *
 * Resolves the home building via ctx.getWorkerHomeBuilding(settler.id),
 * then navigates to its door offset (or building position if door offset is zero).
 */
export const executeGoHome: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    const homeId = ctx.getWorkerHomeBuilding(settler.id);
    if (homeId === null) {
        log.debug(`executeGoHome: settler ${settler.id} has no home building`);
        return TaskResult.FAILED;
    }

    const building = ctx.gameState.getEntityOrThrow(homeId, 'GO_HOME home building');
    const door = getBuildingDoorOffset(building.race, building.subType as BuildingType);
    const targetX = door ? building.x + door.dx : building.x;
    const targetY = door ? building.y + door.dy : building.y;

    return moveToPosition(settler, targetX, targetY, node, ctx, ARRIVAL_DIST);
};

/**
 * GO_TO_SOURCE_PILE — move to the source (input) pile of the settler's assigned building.
 *
 * The source pile position is resolved via ctx.buildingPositionResolver.getSourcePilePosition
 * using node.entity as the material identifier.
 * Caches position in job.targetPos on first call.
 */
export const executeGoToSourcePile: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        const pos = ctx.buildingPositionResolver.getSourcePilePosition(buildingId, node.entity);
        if (!pos) {
            log.debug(`executeGoToSourcePile: no source pile for building ${buildingId}, material '${node.entity}'`);
            return TaskResult.FAILED;
        }
        job.targetPos = pos;
    }

    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST);
};

/**
 * GO_TO_DESTINATION_PILE — move to the destination (output) pile of the settler's assigned building.
 *
 * Resolved via ctx.buildingPositionResolver.getDestinationPilePosition using node.entity as
 * the material identifier. Caches position in job.targetPos on first call.
 */
export const executeGoToDestinationPile: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        const pos = ctx.buildingPositionResolver.getDestinationPilePosition(buildingId, node.entity);
        if (!pos) {
            log.debug(
                `executeGoToDestinationPile: no destination pile for building ${buildingId}, material '${node.entity}'`
            );
            return TaskResult.FAILED;
        }
        job.targetPos = pos;
    }

    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST);
};

/** Try entity handler search. Returns null when entityHandler is absent. */
function searchViaEntityHandler(settler: Entity, job: ChoreoJobState, ctx: ChoreoContext): TaskResult | null {
    if (!ctx.entityHandler) return null;

    let result: { entityId: number; x: number; y: number } | null;
    try {
        result = ctx.entityHandler.findTarget(settler.x, settler.y, settler.id);
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`SEARCH findTarget failed for settler ${settler.id}`, err);
        return TaskResult.FAILED;
    }

    if (result) {
        job.targetId = result.entityId;
        job.targetPos = { x: result.x, y: result.y };
        log.debug(`executeSearch: settler ${settler.id} found entity ${result.entityId}`);
        return TaskResult.DONE;
    }

    if (ctx.entityHandler.shouldWaitForWork) return TaskResult.CONTINUE;
    log.debug(`executeSearch: settler ${settler.id} found no entity target`);
    return TaskResult.FAILED;
}

/** Try position handler search. Returns null when positionHandler is absent. */
function searchViaPositionHandler(settler: Entity, job: ChoreoJobState, ctx: ChoreoContext): TaskResult | null {
    if (!ctx.positionHandler) return null;

    let pos: { x: number; y: number } | null;
    try {
        pos = ctx.positionHandler.findPosition(settler.x, settler.y, settler.id);
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`SEARCH findPosition failed for settler ${settler.id}`, err);
        return TaskResult.FAILED;
    }

    if (pos) {
        job.targetPos = { x: pos.x, y: pos.y };
        log.debug(`executeSearch: settler ${settler.id} found position (${pos.x}, ${pos.y})`);
        return TaskResult.DONE;
    }

    if (ctx.positionHandler.shouldWaitForWork) return TaskResult.CONTINUE;
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
export const executeSearch: ChoreoExecutorFn = (settler, job, _node, _dt, ctx) => {
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
export const executeGoVirtual: ChoreoExecutorFn = (settler, job, node, _dt, ctx) => {
    const buildingId = resolveAssignedBuildingId(settler, ctx);
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
