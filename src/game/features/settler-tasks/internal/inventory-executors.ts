/**
 * Inventory-related choreography node executors.
 *
 * Implements all ChoreoTaskType inventory executors:
 *   GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD
 *   and their VIRTUAL counterparts (settler is hidden during execution).
 *
 * All executors are instant (return DONE in one tick) — the movement and
 * animation nodes that precede them are responsible for any timing.
 */

import { type Entity, setCarrying, clearCarrying } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult } from '../types';
import type { ChoreoJobState, ChoreoNode, ChoreoContext, ChoreoExecutorFn } from '../choreo-types';

const log = new LogHandler('InventoryExecutors');

// ─────────────────────────────────────────────────────────────
// Material parsing
// ─────────────────────────────────────────────────────────────

/** XML entity strings use a GOOD_ prefix, e.g. "GOOD_WATER" → EMaterialType.WATER. */
const GOOD_PREFIX = 'GOOD_';

/**
 * Parse a GOOD_* string from jobInfo.xml into an EMaterialType enum value.
 * Returns null when the string is empty or does not match any known material.
 */
export function parseMaterial(entity: string): EMaterialType | null {
    if (!entity) return null;

    const key = entity.startsWith(GOOD_PREFIX) ? entity.slice(GOOD_PREFIX.length) : entity;

    // EMaterialType keys are UPPER_CASE identifiers — check for a direct name match.
    const value = (EMaterialType as Record<string, unknown>)[key];
    if (typeof value === 'number') {
        return value as EMaterialType;
    }

    return null;
}

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the home building ID for a settler, throwing with context on failure.
 * All inventory executors require a valid home building.
 */
function requireHomeBuilding(settler: Entity, ctx: ChoreoContext): number {
    const buildingId = ctx.getWorkerHomeBuilding(settler.id);
    if (buildingId == null) {
        throw new Error(
            `InventoryExecutors: settler ${settler.id} has no assigned home building. ` +
                `Ensure occupancy is registered before scheduling inventory tasks.`
        );
    }
    return buildingId;
}

/**
 * Parse the material from a node's entity field, throwing with context on failure.
 */
function requireMaterial(node: ChoreoNode, settlerId: number): EMaterialType {
    const material = parseMaterial(node.entity);
    if (material == null) {
        throw new Error(
            `InventoryExecutors: settler ${settlerId} — cannot parse material from node entity '${node.entity}'. ` +
                `Expected a GOOD_* string matching an EMaterialType key.`
        );
    }
    return material;
}

// ─────────────────────────────────────────────────────────────
// Regular inventory executors
// ─────────────────────────────────────────────────────────────

/**
 * GET_GOOD — Withdraw one unit of material from the building's input inventory and give it to the settler.
 *
 * Used when a worker needs to pick up an input material before performing a task
 * (e.g., a baker fetching flour from the input pile before baking bread).
 */
export const executeGetGood: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: ChoreoContext
): TaskResult => {
    const material = requireMaterial(node, settler.id);
    const buildingId = requireHomeBuilding(settler, ctx);

    const withdrawn = ctx.inventoryManager.withdrawInput(buildingId, material, 1);
    if (withdrawn === 0) {
        log.warn(
            `GET_GOOD: settler ${settler.id} — building ${buildingId} has no ${EMaterialType[material]} in input inventory`
        );
        return TaskResult.FAILED;
    }

    setCarrying(settler, material, 1);
    job.carryingGood = material;

    log.debug(`GET_GOOD: settler ${settler.id} withdrew ${EMaterialType[material]} from building ${buildingId}`);
    return TaskResult.DONE;
};

/**
 * PUT_GOOD — Deposit carried material into the building's output inventory.
 *
 * Used when a worker has finished producing and needs to place the result into
 * the output pile so carriers can transport it.
 */
export const executePutGood: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: ChoreoContext
): TaskResult => {
    // Prefer the node's explicit material (handles transformations like LOG→BOARD);
    // fall back to job carrying state when node has no entity.
    const material = parseMaterial(node.entity) ?? job.carryingGood ?? requireMaterial(node, settler.id);
    const buildingId = requireHomeBuilding(settler, ctx);

    const deposited = ctx.inventoryManager.depositOutput(buildingId, material, 1);
    if (deposited === 0) {
        log.warn(
            `PUT_GOOD: settler ${settler.id} — building ${buildingId} output full for ${EMaterialType[material]}, material lost`
        );
    } else {
        log.debug(`PUT_GOOD: settler ${settler.id} deposited ${EMaterialType[material]} to building ${buildingId}`);
    }

    clearCarrying(settler);
    job.carryingGood = null;
    return TaskResult.DONE;
};

/**
 * RESOURCE_GATHERING — Collect a ground resource (post-work) and give it to the settler.
 *
 * Called after a work action completes (e.g., woodcutter finishes chopping) to
 * represent picking up the resource that was just produced. No inventory withdrawal
 * occurs — the resource is assumed to have appeared on the ground as the work result.
 */
export const executeResourceGathering: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    _ctx: ChoreoContext
): TaskResult => {
    const material = requireMaterial(node, settler.id);

    setCarrying(settler, material, 1);
    job.carryingGood = material;

    log.debug(`RESOURCE_GATHERING: settler ${settler.id} gathered ${EMaterialType[material]}`);
    return TaskResult.DONE;
};

/**
 * LOAD_GOOD — Load a material onto the settler in a transport/carrier context.
 *
 * Semantically distinct from GET_GOOD: used when the settler is acting as a
 * loader rather than a consumer (e.g., loading material onto a donkey or barge).
 * Withdraws from input inventory and marks the settler as carrying.
 */
export const executeLoadGood: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: ChoreoContext
): TaskResult => {
    const material = requireMaterial(node, settler.id);
    const buildingId = requireHomeBuilding(settler, ctx);

    const withdrawn = ctx.inventoryManager.withdrawInput(buildingId, material, 1);
    if (withdrawn === 0) {
        log.warn(
            `LOAD_GOOD: settler ${settler.id} — building ${buildingId} has no ${EMaterialType[material]} in input inventory`
        );
        return TaskResult.FAILED;
    }

    setCarrying(settler, material, 1);
    job.carryingGood = material;

    log.debug(`LOAD_GOOD: settler ${settler.id} loaded ${EMaterialType[material]} from building ${buildingId}`);
    return TaskResult.DONE;
};

// ─────────────────────────────────────────────────────────────
// Virtual inventory executors (settler is hidden)
// ─────────────────────────────────────────────────────────────

/**
 * GET_GOOD_VIRTUAL — Same as GET_GOOD but the settler is not visible during execution.
 *
 * Used when the original game hides the settler inside the building for the
 * pickup animation (the settler appears to reach in and take a resource).
 */
export const executeGetGoodVirtual: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
): TaskResult => {
    job.visible = false;
    return executeGetGood(settler, job, node, dt, ctx);
};

/**
 * PUT_GOOD_VIRTUAL — Same as PUT_GOOD but the settler is not visible during execution.
 *
 * Used when the deposit happens "inside" the building and the settler should
 * be hidden from the player's view.
 */
export const executePutGoodVirtual: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
): TaskResult => {
    job.visible = false;
    return executePutGood(settler, job, node, dt, ctx);
};

/**
 * RESOURCE_GATHERING_VIRTUAL — Same as RESOURCE_GATHERING but the settler is hidden.
 *
 * Used when the resource is picked up "off-screen" or inside a building (e.g.,
 * a miller collecting flour from the mill's internal hopper).
 */
export const executeResourceGatheringVirtual: ChoreoExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    _ctx: ChoreoContext
): TaskResult => {
    job.visible = false;
    return executeResourceGathering(settler, job, node, dt, _ctx);
};
