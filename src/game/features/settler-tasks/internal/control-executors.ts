/**
 * Wait and control flow choreography node executors.
 *
 * Implements ChoreoTaskType nodes: WAIT, WAIT_VIRTUAL, CHECKIN,
 * CHANGE_JOB, CHANGE_JOB_COME_TO_WORK, and military stubs.
 */

import type { Entity } from '../../../entity';
import { EntityType, UnitType, EXTENDED_OFFSETS, getUnitTypeAtLevel } from '../../../entity';
import type { GameState } from '../../../game-state';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult } from '../types';
import { framesToSeconds, type ChoreoJobState, type ChoreoNode, type ChoreoContext } from '../choreo-types';

const log = new LogHandler('ControlExecutors');

// ─────────────────────────────────────────────────────────────
// Wait executors
// ─────────────────────────────────────────────────────────────

/**
 * Timed wait — settler stands visible for `node.duration` frames.
 *
 * If `node.duration` is -1 or 0 the wait is instant and DONE is returned
 * immediately without consuming a tick.
 */
export function executeWait(
    _settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    _ctx: ChoreoContext
): TaskResult {
    if (node.duration <= 0) {
        return TaskResult.DONE;
    }

    const durationSeconds = framesToSeconds(node.duration);
    job.progress += dt / durationSeconds;

    if (job.progress >= 1) {
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}

/**
 * Virtual wait — same timer logic as WAIT but the settler is invisible.
 *
 * Marks `job.visible = false` so the rendering layer hides the settler
 * for the duration of this node.
 */
export function executeWaitVirtual(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
): TaskResult {
    job.visible = false;
    return executeWait(settler, job, node, dt, ctx);
}

// ─────────────────────────────────────────────────────────────
// Control executors
// ─────────────────────────────────────────────────────────────

/**
 * Return the settler to an idle/checked-in state inside its home building.
 *
 * Hides the settler (they are "inside" the building) and signals the state
 * machine to transition to IDLE on the next tick by completing this node.
 * The actual IDLE transition is handled by the state machine above this layer.
 */
export function executeCheckin(
    _settler: Entity,
    job: ChoreoJobState,
    _node: ChoreoNode,
    _dt: number,
    _ctx: ChoreoContext
): TaskResult {
    job.visible = false;
    return TaskResult.DONE;
}

/**
 * Switch to a different job ID mid-execution.
 *
 * Reads the new job ID from `node.entity`, resets the job state to node 0,
 * and updates `job.jobId`. The state machine will pick up the new job definition
 * on the next tick — the actual job lookup happens there, not here.
 */
export function executeChangeJob(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    _ctx: ChoreoContext
): TaskResult {
    const newJobId = node.entity;
    if (!newJobId) {
        throw new Error(
            `Settler ${settler.id}: CHANGE_JOB node has no target job ID (node.entity is empty). ` +
                `Current job: '${job.jobId}', node index: ${job.nodeIndex}.`
        );
    }

    job.jobId = newJobId;
    job.nodeIndex = 0;
    job.progress = 0;
    job.workStarted = false;

    return TaskResult.DONE;
}

/**
 * Switch to a different job ID, intending for the new job to handle movement to
 * the workplace. Functionally identical to CHANGE_JOB — the movement is handled
 * by the first nodes of the new job definition.
 */
export function executeChangeJobComeToWork(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
): TaskResult {
    return executeChangeJob(settler, job, node, dt, ctx);
}

// ─────────────────────────────────────────────────────────────
// Military executors
// ─────────────────────────────────────────────────────────────

/**
 * Find a spawn position near (x, y) that is not occupied by another entity.
 * Tries all EXTENDED_OFFSETS neighbours first; falls back to the barracks position
 * if every adjacent tile is occupied.
 */
function findSpawnPosition(x: number, y: number, gameState: GameState): { x: number; y: number } {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!gameState.getEntityAt(nx, ny)) {
            return { x: nx, y: ny };
        }
    }
    // Fallback — all tiles occupied, spawn at barracks position
    log.warn(`findSpawnPosition: all tiles near (${x}, ${y}) occupied, using barracks position`);
    return { x, y };
}

/**
 * Convert a carrier into a trained soldier at the barracks.
 *
 * Reads the pending training state from BarracksTrainingManager, spawns a new soldier
 * entity with the correct type and level, then removes the carrier from the world.
 * Emits 'unit:spawned' and 'barracks:trainingCompleted' events for downstream systems.
 */
export function executeChangeTypeAtBarracks(
    settler: Entity,
    _job: ChoreoJobState,
    _node: ChoreoNode,
    _dt: number,
    ctx: ChoreoContext
): TaskResult {
    const training = ctx.barracksTrainingManager?.getTrainingForCarrier(settler.id);
    if (!training) {
        log.warn(`CHANGE_TYPE_AT_BARRACKS: no training state for carrier ${settler.id}, skipping`);
        return TaskResult.DONE;
    }

    const { buildingId, recipe } = training;
    const barracks = ctx.gameState.getEntityOrThrow(buildingId, 'barracks for type change');
    const unitType = getUnitTypeAtLevel(recipe.unitType, recipe.level);

    // Find a valid spawn position near the barracks
    const spawnPos = findSpawnPosition(barracks.x, barracks.y, ctx.gameState);

    // Spawn the soldier
    const soldierEntity = ctx.gameState.addEntity(EntityType.Unit, unitType, spawnPos.x, spawnPos.y, settler.player);
    soldierEntity.race = settler.race;
    soldierEntity.level = recipe.level;

    // Emit unit:spawned event
    ctx.eventBus.emit('unit:spawned', {
        entityId: soldierEntity.id,
        unitType,
        x: spawnPos.x,
        y: spawnPos.y,
        player: settler.player,
    });

    const soldierId = soldierEntity.id;

    // Remove the carrier entity. CarrierManager cleanup happens via entity:removed event.
    ctx.gameState.removeEntity(settler.id);

    // Notify manager to clear training state and emit completion event
    ctx.barracksTrainingManager!.completeTraining(buildingId);

    // Emit training completed event
    ctx.eventBus.emit('barracks:trainingCompleted', {
        buildingId,
        unitType: recipe.unitType,
        level: recipe.level,
        soldierId,
    });

    log.debug(
        `CHANGE_TYPE_AT_BARRACKS: carrier ${settler.id} converted to soldier ${soldierId} ` +
            `(${UnitType[unitType]} L${recipe.level}) at barracks ${buildingId}`
    );

    return TaskResult.DONE;
}

/**
 * Healer work — restore health to a target entity.
 *
 * Duration-based: advances job.progress over node.duration frames (default 2 s).
 * The actual HP mutation will be applied by the health/combat system when it exists;
 * this executor only signals "healer is busy healing" for the correct duration.
 */
export function executeHealEntity(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ChoreoContext
): TaskResult {
    if (job.targetId === null) {
        log.debug(`executeHealEntity: settler ${settler.id} has no target`);
        return TaskResult.FAILED;
    }

    // Use nullable getEntity — the target may have been destroyed mid-heal.
    const target = ctx.gameState.getEntity(job.targetId);
    if (!target) {
        log.debug(`executeHealEntity: target ${job.targetId} no longer exists, settler ${settler.id} aborts`);
        return TaskResult.FAILED;
    }

    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 2.0;
    job.progress += dt / duration;

    if (job.progress >= 1) {
        log.warn(
            `executeHealEntity: settler ${settler.id} finished healing target ${job.targetId} — HP mutation not implemented, heal skipped`
        );
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}

/**
 * Combat response — react to being attacked.
 *
 * Duration-based wait that represents a defensive/reaction animation.
 * Defaults to 0.5 s when node.duration is not set.
 * The actual fight-back or retreat logic will be added by the combat system.
 */
export function executeAttackReaction(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    _ctx: ChoreoContext
): TaskResult {
    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 0.5;
    job.progress += dt / duration;

    if (job.progress >= 1) {
        log.warn(
            `executeAttackReaction: settler ${settler.id} completed reaction — combat logic not implemented, reaction skipped`
        );
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}
