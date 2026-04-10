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

import { type Entity, clearCarrying } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import {
    tickDuration,
    type ChoreoJobState,
    type ChoreoNode,
    type InventoryExecutorFn,
    type InventoryExecutorContext,
    type InventoryContext,
} from '../choreo-types';
const log = createLogger('InventoryExecutors');

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
    if (!entity) {
        return null;
    }

    const key = entity.startsWith(GOOD_PREFIX) ? entity.slice(GOOD_PREFIX.length) : entity;

    // EMaterialType is a string enum — values ARE the string keys.
    const value = (EMaterialType as Record<string, unknown>)[key];
    if (typeof value === 'string') {
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
function requireHomeBuilding(settler: Entity, ctx: InventoryContext): number {
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
// Duration helpers
// ─────────────────────────────────────────────────────────────

import { framesToSeconds } from '../choreo-types';

/**
 * Default animation cycle for inventory nodes with duration=0 (one pickup/dropoff animation).
 * In the original S4, duration=0 means "play one full animation cycle", not "instant".
 * Carrier pickup/dropoff animations are typically 4-5 frames at 100ms each.
 */
const DEFAULT_INVENTORY_CYCLE_FRAMES = 5; // 0.5 seconds at CHOREO_FPS

/** Compute effective duration in seconds for inventory nodes. */
function resolveInventoryDuration(node: ChoreoNode): number {
    if (node.duration === 0) {
        return framesToSeconds(DEFAULT_INVENTORY_CYCLE_FRAMES);
    }
    if (node.duration <= 0) {
        return 0;
    } // duration=-1 or negative → instant
    return framesToSeconds(node.duration);
}

// ─────────────────────────────────────────────────────────────
// Regular inventory executors
// ─────────────────────────────────────────────────────────────

/**
 * GET_GOOD — Withdraw one unit of material from the building's input inventory and give it to the settler.
 *
 * Used when a worker needs to pick up an input material before performing a task
 * (e.g., a baker fetching flour from the input pile before baking bread).
 *
 * The pickup animation plays first for the full duration (duration=0 → one
 * full animation cycle). The actual inventory withdrawal happens when the
 * animation completes, so the goods visually appear in the settler's hands
 * at the end of the bend-down motion.
 *
 * Carrier transport uses TRANSPORT_PICKUP instead.
 */
export const executeGetGood: InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
): TaskResult => {
    if (!job.workStarted) {
        job.workStarted = true;
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));

    if (result === TaskResult.DONE) {
        const material = requireMaterial(node, settler.id);
        const buildingId = requireHomeBuilding(settler, ctx);

        const withdrawn = ctx.materialTransfer.pickUp(settler.id, buildingId, material, 1, false);
        if (withdrawn === 0) {
            log.warn(
                `GET_GOOD: settler ${settler.id} — building ${buildingId} has no ` + `${material} in input inventory`
            );
            return TaskResult.FAILED;
        }

        job.carryingGood = material;

        log.debug(`GET_GOOD: settler ${settler.id} withdrew ${material} from building ${buildingId}`);
    }

    return result;
};

/**
 * PUT_GOOD — Deposit carried material into the building's output inventory.
 *
 * Used when a worker has finished producing and needs to place the result into
 * the output pile so carriers can transport it.
 *
 * The dropoff animation plays first for the full duration (duration=0 → one
 * full animation cycle). The actual inventory deposit happens when the
 * animation completes, so the goods visually leave the settler's hands at
 * the end of the bend-down motion.
 *
 * Carrier transport uses TRANSPORT_DELIVER instead.
 */
/** Deposit carried material into the building's output inventory. */
function depositWorkerGood(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    ctx: InventoryExecutorContext
): void {
    const buildingId = requireHomeBuilding(settler, ctx);
    const explicitMaterial = parseMaterial(node.entity);

    if (explicitMaterial !== null) {
        // Worker production: the explicit material from the node (e.g. BOARD) may differ from
        // what the settler is carrying (e.g. LOG). This is a production transformation, not a
        // material transfer — deposit the node's output material directly.
        const deposited = ctx.inventoryManager.depositOutput(buildingId, explicitMaterial, 1);
        if (deposited === 0) {
            log.warn(
                `PUT_GOOD: settler ${settler.id} — building ${buildingId} output full for ` +
                    `${explicitMaterial}, material lost`
            );
        } else {
            log.debug(`PUT_GOOD: settler ${settler.id} deposited ${explicitMaterial} ` + `to building ${buildingId}`);
        }
        clearCarrying(settler);
    } else {
        // No explicit material (GOOD_NO_GOOD) — use the building's production config to determine output.
        // This handles multi-step XML choreographies (e.g. ToolSmith) where GET_GOOD_VIRTUAL consumes
        // inputs and WORK_VIRTUAL is a pure timer; the correct output comes from BUILDING_PRODUCTIONS.
        const produced = ctx.inventoryManager.produceOutput(buildingId);
        if (!produced) {
            log.warn(
                `PUT_GOOD: settler ${settler.id} — building ${buildingId} output full (produceOutput), material lost`
            );
        } else {
            log.debug(`PUT_GOOD: settler ${settler.id} produced output at building ${buildingId}`);
        }
        clearCarrying(settler);
    }

    job.carryingGood = null;
}

export const executePutGood: InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
): TaskResult => {
    if (!job.workStarted) {
        job.workStarted = true;
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));

    if (result === TaskResult.DONE) {
        depositWorkerGood(settler, job, node, ctx);
    }

    return result;
};

/**
 * RESOURCE_GATHERING — Collect a ground resource (post-work) and give it to the settler.
 *
 * Called after a work action completes (e.g., woodcutter finishes chopping) to
 * represent picking up the resource that was just produced. No inventory withdrawal
 * occurs — the resource is assumed to have appeared on the ground as the work result.
 */
export const executeResourceGathering: InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: InventoryExecutorContext
): TaskResult => {
    // No entity means no material to collect (e.g. geologist prospecting — work is already done).
    if (!node.entity) {
        return TaskResult.DONE;
    }

    const material = requireMaterial(node, settler.id);

    ctx.materialTransfer.produce(settler.id, material, 1);
    job.carryingGood = material;

    log.debug(`RESOURCE_GATHERING: settler ${settler.id} gathered ${material}`);
    return TaskResult.DONE;
};

/**
 * LOAD_GOOD — Load a material onto the settler in a transport/carrier context.
 *
 * Semantically distinct from GET_GOOD: used when the settler is acting as a
 * loader rather than a consumer (e.g., loading material onto a donkey or barge).
 * Withdraws from input inventory and marks the settler as carrying.
 */
export const executeLoadGood: InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: InventoryExecutorContext
): TaskResult => {
    const material = requireMaterial(node, settler.id);
    const buildingId = requireHomeBuilding(settler, ctx);

    const withdrawn = ctx.materialTransfer.pickUp(settler.id, buildingId, material, 1, false);
    if (withdrawn === 0) {
        log.warn(`LOAD_GOOD: settler ${settler.id} — building ${buildingId} has no ${material} in input inventory`);
        return TaskResult.FAILED;
    }

    job.carryingGood = material;

    log.debug(`LOAD_GOOD: settler ${settler.id} loaded ${material} from building ${buildingId}`);
    return TaskResult.DONE;
};
