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

import { EntityType, BuildingType, tileKey, type Entity } from '../../../entity';
import { getBuildingDoorPos } from '../../../data/game-data-access';
import { hexDistance } from '../../../systems/hex-directions';
import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import type { ChoreoNode, MovementExecutorFn, ChoreoJobState, MovementContext } from '../choreo-types';
import { ChoreoTaskType } from '../choreo-types';
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

/**
 * Scan forward from the current node to find the material entity string on
 * the next matching inventory node (GET_GOOD, PUT_GOOD, etc.).
 * Used by pile movement executors to resolve the correct pile position.
 */
function findMaterialInAdjacentNode(job: ChoreoJobState, taskType: ChoreoTaskType): string | undefined {
    for (let i = job.nodeIndex + 1; i < job.nodes.length; i++) {
        const n = job.nodes[i]!;
        if (n.task === taskType && n.entity) return n.entity;
        // Also check virtual variants
        if (taskType === ChoreoTaskType.GET_GOOD && n.task === ChoreoTaskType.GET_GOOD_VIRTUAL && n.entity) {
            return n.entity;
        }
        if (taskType === ChoreoTaskType.PUT_GOOD && n.task === ChoreoTaskType.PUT_GOOD_VIRTUAL && n.entity) {
            return n.entity;
        }
    }
    return undefined;
}

// ─────────────────────────────────────────────────────────────
// Phase 2A — Regular movement executors
// ─────────────────────────────────────────────────────────────

/** GO_TO_TARGET / GO_TO_TARGET_ROUGHLY — move to entity or position target. */
function makeGoToTarget(arrivalDist: number): MovementExecutorFn {
    return (settler, job, node, _dt, ctx) => {
        // Consume waypoint for multi-destination jobs
        if (job.waypoints) {
            let wpIndex = 0;
            for (let i = 0; i < job.nodeIndex; i++) {
                if (job.nodes[i]!.task === ChoreoTaskType.GO_TO_TARGET) wpIndex++;
            }
            const wp = job.waypoints[wpIndex]!;
            job.targetPos = { x: wp.x, y: wp.y };
            job.targetId = wp.entityId ?? null;
        }

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
 * GO_TO_SOURCE_PILE — move to a source pile position for pickup (regular workers only).
 *
 * Resolves from the pile registry using the material from the next GET_GOOD node.
 * Carrier transport uses TRANSPORT_GO_TO_SOURCE instead.
 */
export const executeGoToSourcePile: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const material = findMaterialInAdjacentNode(job, ChoreoTaskType.GET_GOOD)!;
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        job.targetPos = ctx.buildingPositionResolver.getSourcePilePosition(buildingId, material)!;
    }
    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST, job);
};

/**
 * GO_TO_DESTINATION_PILE — move to a destination pile position for delivery (regular workers only).
 *
 * Resolves from the pile registry using the settler's carried material.
 * Carrier transport uses TRANSPORT_GO_TO_DEST instead.
 */
export const executeGoToDestinationPile: MovementExecutorFn = (settler, job, node, _dt, ctx) => {
    if (!job.targetPos) {
        const material = findMaterialInAdjacentNode(job, ChoreoTaskType.PUT_GOOD)!;
        const buildingId = resolveAssignedBuildingId(settler, ctx);
        job.targetPos = ctx.buildingPositionResolver.getDestinationPilePosition(buildingId, material)!;
    }
    return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST, job);
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
        // If the resolved position is inside a building footprint, it's unreachable via pathfinding.
        // Skip movement entirely — the exact sub-position around the work target is cosmetic.
        if (ctx.gameState.buildingOccupancy.has(tileKey(job.targetPos.x, job.targetPos.y))) {
            return TaskResult.DONE;
        }
        return moveToPosition(settler, job.targetPos.x, job.targetPos.y, node, ctx, ARRIVAL_DIST, job);
    }

    // No target entity — interior/building teleport (original behavior)
    // Visibility is handled by prepareNodeTick via the location manager (enterBuilding removes
    // the movement controller and clears tile occupancy). We just teleport the position.
    const pos = ctx.buildingPositionResolver.resolvePosition(buildingId, node.x, node.y, node.useWork);
    job.visible = false;

    settler.x = pos.x;
    settler.y = pos.y;

    // Sync the movement controller position so the renderer shows the settler at the
    // teleported position (not interpolating from a stale controller position).
    // Visible GO_VIRTUAL nodes (e.g. sawmill worker) need this so the worker appears
    // at the correct building-interior position rather than stuck at the door.
    const controller = ctx.gameState.movement.getController(settler.id);
    if (controller) {
        controller.syncPosition(pos.x, pos.y);
    }

    log.debug(`executeGoVirtual: settler ${settler.id} moved to (${pos.x}, ${pos.y}) inside building ${buildingId}`);
    return TaskResult.DONE;
};
