/**
 * Combat system — scans for nearby enemies, pursues, and applies damage.
 *
 * Each tick:
 * 1. Idle military units scan for nearby enemies within detection range
 * 2. If enemy found → pursue (move toward enemy)
 * 3. If adjacent to target → enter fighting state
 * 4. Fighting units deal periodic damage based on attack cooldown
 * 5. Dead units are removed from the game
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { Entity } from '../../entity';
import { isUnitTypeMilitary, UnitType } from '../../entity';
import {
    resolveOutsideBuilding,
    findNearestEnemy as findNearestEnemyHelper,
    hasNearbyThreats as hasNearbyThreatsHelper,
    FIGHT_RANGE,
    RANGED_MELEE_THRESHOLD,
    SHOOT_RANGE,
} from './combat-helpers';
import { hexDistanceTo } from '../../systems/hex-directions';
import { CombatState, CombatStatus, createCombatState, getCombatStats, isRangedUnitType } from './combat-state';
import { CombatVisuals } from './combat-animations';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';
import type { CommandExecutor } from '../../commands';

const log = createLogger('CombatSystem');

/**
 * How often idle units scan for enemies (seconds).
 * Scanning every tick is wasteful; a periodic sweep suffices.
 */
const SCAN_INTERVAL = 0.5;

/**
 * How often pursuing units re-check if they need to re-path (seconds).
 * Avoids spamming moveUnit every tick while chasing.
 */
const PURSUIT_REPATH_INTERVAL = 0.5;

/**
 * Distance threshold: if a new enemy is THIS much closer than the current
 * target, switch targets during pursuit. Prevents ping-ponging between
 * equidistant enemies while still reacting to much closer threats.
 */
const RETARGET_ADVANTAGE = 3;

export interface CombatSystemConfig extends CoreDeps {
    visualService: EntityVisualService;
    executeCommand: CommandExecutor;
    isUnitReserved: (entityId: number) => boolean;
}

export class CombatSystem implements TickSystem {
    private readonly states = new Map<number, CombatState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly visuals: CombatVisuals;
    private readonly executeCommand: CommandExecutor;
    private readonly isUnitReserved: (entityId: number) => boolean;

    /** Accumulated time for periodic enemy scanning */
    private scanTimer = 0;

    /** Per-unit timers for pursuit re-pathing */
    private pursuitTimers = new Map<number, number>();

    /** Units marching to a player-commanded destination — skip combat until they stop. */
    private readonly passiveUnits = new Set<number>();

    /**
     * Optional filter: called before an idle unit engages an enemy.
     * Receives (entityId, hexDistToNearestEnemy). Return true to skip engagement
     * (e.g., siege system claims the unit because a building door is closer).
     */
    private engagementFilter: ((entityId: number, enemyDist: number) => boolean) | null = null;

    /** Units whose combat target is externally managed. Locked units skip all retargeting. */
    private readonly lockedTargets = new Map<number, { targetId: number; reason: string }>();

    constructor(cfg: CombatSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.visuals = new CombatVisuals(cfg.visualService, cfg.gameState);
        this.executeCommand = cfg.executeCommand;
        this.isUnitReserved = cfg.isUnitReserved;
    }

    // ── Registration ──────────────────────────────────────────────────────

    register(entityId: number, player: number, unitType: UnitType): void {
        if (this.states.has(entityId)) {
            return;
        }
        this.states.set(entityId, createCombatState(entityId, player, unitType));
    }

    unregister(entityId: number): void {
        this.states.delete(entityId);
        this.lockedTargets.delete(entityId);
        this.pursuitTimers.delete(entityId);
        this.passiveUnits.delete(entityId);
    }

    getState(entityId: number): CombatState | undefined {
        return this.states.get(entityId);
    }

    get unitCount(): number {
        return this.states.size;
    }

    /** True if the entity is actively fighting or pursuing an enemy. */
    isInCombat(entityId: number): boolean {
        const state = this.states.get(entityId);
        return state !== undefined && state.status !== CombatStatus.Idle;
    }

    /**
     * Mark a unit as passive — it will march to its destination without
     * engaging enemies. Auto-clears when the unit stops moving.
     */
    setPassive(entityId: number): void {
        this.passiveUnits.add(entityId);
    }

    /**
     * Register a filter that can prevent idle units from engaging enemies.
     * The siege system uses this to claim swordsmen when a building door
     * is closer than the nearest enemy unit.
     */
    setEngagementFilter(filter: (entityId: number, enemyDist: number) => boolean): void {
        this.engagementFilter = filter;
    }

    /** True if there are visible enemy military units nearby (excludes reserved/locked). */
    hasNearbyThreats(entityId: number): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'hasNearbyThreats');
        return hasNearbyThreatsHelper(
            entity,
            this.gameState,
            id => this.isUnitReserved(id) || this.lockedTargets.has(id)
        );
    }

    /**
     * Lock a unit's combat target. The unit enters Fighting and will not
     * retarget or pursue — damage ticks automatically. When the target dies,
     * the lock is auto-cleared by killUnit. Multiple units can lock the same target.
     */
    lockTarget(unitId: number, targetId: number, reason: string): void {
        const state = this.states.get(unitId);
        if (!state) {
            return;
        }
        this.lockedTargets.set(unitId, { targetId, reason });
        state.targetId = targetId;
        state.status = CombatStatus.Fighting;
        state.attackTimer = 0;
        this.pursuitTimers.delete(unitId);

        const entity = this.gameState.getEntityOrThrow(unitId, 'lockTarget');
        const target = this.gameState.getEntityOrThrow(targetId, 'lockTarget');
        const controller = this.gameState.movement.getController(unitId);
        if (controller && controller.state !== 'idle') {
            controller.clearPath();
        }
        this.visuals.engageFight(entity, target);
    }

    /** Remove a target lock. The unit transitions to idle. */
    unlockTarget(unitId: number): void {
        this.lockedTargets.delete(unitId);
    }

    isLocked(unitId: number): boolean {
        return this.lockedTargets.has(unitId);
    }

    getLock(unitId: number): { targetId: number; reason: string } | undefined {
        return this.lockedTargets.get(unitId);
    }

    /**
     * Release a unit from combat, returning it to idle. Also clears any lock.
     */
    releaseFromCombat(entityId: number): void {
        this.lockedTargets.delete(entityId);
        const state = this.states.get(entityId)!;
        state.targetId = null;
        this.pursuitTimers.delete(entityId);
        this.transitionToIdle(state);
    }

    // ── Tick ──────────────────────────────────────────────────────────────

    tick(dt: number): void {
        this.scanTimer += dt;
        const shouldScan = this.scanTimer >= SCAN_INTERVAL;
        if (shouldScan) {
            this.scanTimer = 0;
        }

        // Accumulate pursuit timers
        for (const [id, t] of this.pursuitTimers) {
            this.pursuitTimers.set(id, t + dt);
        }

        for (const [id, state] of sortedEntries(this.states)) {
            try {
                this.tickUnit(id, state, shouldScan, dt);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error in combat tick for entity ${state.entityId}`, err);
            }
        }
    }

    private tickUnit(id: number, state: CombatState, shouldScan: boolean, dt: number): void {
        // Entity may have been killed earlier in this tick's iteration (killUnit → remove_entity
        // → unregister removes from states, but sortedEntries snapshot still has this entry).
        const entity = this.gameState.getEntity(state.entityId);
        if (!entity) {
            this.states.delete(id);
            this.passiveUnits.delete(id);
            return;
        }

        // Passive units march without engaging — clear when they stop
        if (this.passiveUnits.has(id)) {
            const ctrl = this.gameState.movement.getController(id);
            if (!ctrl || ctrl.state === 'idle') {
                this.passiveUnits.delete(id);
            } else {
                return;
            }
        }

        switch (state.status) {
            case CombatStatus.Idle:
                // Only military units actively scan for enemies; specialists are passive targets
                if (shouldScan && isUnitTypeMilitary(state.unitType)) {
                    this.handleIdle(state, entity);
                }
                break;
            case CombatStatus.Pursuing:
                this.handlePursuing(state, entity);
                break;
            case CombatStatus.Fighting:
                this.handleFighting(state, entity, dt);
                break;
            case CombatStatus.Shooting:
                this.handleShooting(state, entity, dt);
                break;
        }
    }

    // ── State handlers ────────────────────────────────────────────────────

    private handleIdle(state: CombatState, entity: Entity): void {
        // Reserved units (siege defenders, door attackers) are externally managed — never self-target
        if (this.isUnitReserved(state.entityId)) {
            return;
        }

        const target = this.findNearestEnemy(entity);
        if (!target) {
            return;
        }

        const dist = hexDistanceTo(entity, target);

        // Allow external systems (e.g. siege) to claim this unit when a closer target exists
        if (this.engagementFilter && this.engagementFilter(state.entityId, dist)) {
            return;
        }

        const ranged = isRangedUnitType(state.unitType);

        // Adjacent enemy — engage melee immediately (all units)
        if (dist <= FIGHT_RANGE) {
            state.targetId = target.id;
            this.stopAndEngage(state, entity, target, CombatStatus.Fighting);
            return;
        }

        // Ranged units within melee threshold — close in for melee
        if (ranged && dist <= RANGED_MELEE_THRESHOLD) {
            state.targetId = target.id;
            this.transitionToPursue(state, entity, target);
            return;
        }

        // Ranged units within shoot range — start shooting
        if (ranged && dist <= SHOOT_RANGE) {
            state.targetId = target.id;
            this.stopAndEngage(state, entity, target, CombatStatus.Shooting);
            return;
        }

        state.targetId = target.id;
        this.transitionToPursue(state, entity, target);
    }

    private handlePursuing(state: CombatState, entity: Entity): void {
        const target = this.validateTarget(state);
        if (!target) {
            return;
        }

        this.visuals.syncDirectionWithController(entity);

        const dist = hexDistanceTo(entity, target);

        // Close enough to fight melee
        if (dist <= FIGHT_RANGE) {
            this.stopAndEngage(state, entity, target, CombatStatus.Fighting);
            return;
        }

        // Ranged units: if within shoot range but beyond melee threshold, stop and shoot
        if (isRangedUnitType(state.unitType) && dist > RANGED_MELEE_THRESHOLD && dist <= SHOOT_RANGE) {
            this.stopAndEngage(state, entity, target, CombatStatus.Shooting);
            return;
        }

        const controller = this.gameState.movement.getController(state.entityId);
        if (!controller) {
            this.transitionToIdle(state);
            return;
        }
        const stuck = controller.state === 'idle';

        // Re-evaluate target and re-path periodically, or immediately when stuck.
        const elapsed = this.pursuitTimers.get(state.entityId)!;
        if (elapsed >= PURSUIT_REPATH_INTERVAL || stuck) {
            this.pursuitTimers.set(state.entityId, 0);

            // Check if a closer enemy appeared — switch targets if significantly closer
            const closer = this.findNearestEnemy(entity);
            if (closer && closer.id !== target.id) {
                const closerDist = hexDistanceTo(entity, closer);
                if (closerDist + RETARGET_ADVANTAGE < dist) {
                    state.targetId = closer.id;
                    this.transitionToPursue(state, entity, closer);
                    return;
                }
            }

            const dest = resolveOutsideBuilding(target.x, target.y, this.gameState.buildingOccupancy);
            this.gameState.movement.moveUnit(state.entityId, dest.x, dest.y);
            this.visuals.applyWalkAnimation(entity, target);
        }
    }

    /** True if the unit has finished its current movement step and is fully on a tile. */
    private isUnitStationary(entityId: number): boolean {
        const controller = this.gameState.movement.getController(entityId);
        return !controller || !controller.isInTransit;
    }

    /**
     * Stop movement and transition to Fighting or Shooting.
     * Only engages if the unit is stationary — if still mid-step, clears the
     * path and returns false. The caller's handler will re-check next tick.
     */
    private stopAndEngage(
        state: CombatState,
        entity: Entity,
        target: Entity,
        status: CombatStatus.Fighting | CombatStatus.Shooting
    ): void {
        // Clear path so no further steps are queued
        const controller = this.gameState.movement.getController(entity.id);
        if (!controller) {
            // Unit lost its controller (e.g. entered a building) — can't engage
            this.transitionToIdle(state);
            return;
        }
        if (controller.state !== 'idle') {
            controller.clearPath();
        }

        if (!this.isUnitStationary(entity.id)) {
            // Still finishing a step — stay in current status, re-check next tick
            return;
        }

        state.status = status;
        state.attackTimer = 0;

        if (status === CombatStatus.Shooting) {
            this.visuals.engageShoot(entity, target);
        } else {
            this.visuals.engageFight(entity, target);
        }

        log.debug(
            `Unit ${state.entityId} engaging enemy ${target.id} (${status === CombatStatus.Shooting ? 'ranged' : 'melee'})`
        );
    }

    private handleFighting(state: CombatState, entity: Entity, dt: number): void {
        const target = this.validateTarget(state);
        if (!target) {
            return;
        }

        // Locked units have externally managed targets — just deal damage, no retargeting
        if (this.lockedTargets.has(state.entityId)) {
            this.visuals.updateFacingDirection(entity, target);
            this.tickDamage(state, target, dt);
            return;
        }

        // Check if target moved out of melee range
        const dist = hexDistanceTo(entity, target);
        if (dist > FIGHT_RANGE) {
            // Before chasing the old target, check if a closer enemy is adjacent
            const closer = this.findNearestEnemy(entity);
            if (closer && closer.id !== target.id && hexDistanceTo(entity, closer) <= FIGHT_RANGE) {
                state.targetId = closer.id;
                this.stopAndEngage(state, entity, closer, CombatStatus.Fighting);
                return;
            }

            if (isRangedUnitType(state.unitType) && dist > RANGED_MELEE_THRESHOLD && dist <= SHOOT_RANGE) {
                this.stopAndEngage(state, entity, target, CombatStatus.Shooting);
            } else {
                this.transitionToPursue(state, entity, target);
            }
            return;
        }

        this.visuals.updateFacingDirection(entity, target);
        this.tickDamage(state, target, dt);
    }

    private handleShooting(state: CombatState, entity: Entity, dt: number): void {
        const target = this.validateTarget(state);
        if (!target) {
            return;
        }

        const dist = hexDistanceTo(entity, target);

        // Enemy closed in — switch to melee
        if (dist <= RANGED_MELEE_THRESHOLD) {
            if (dist <= FIGHT_RANGE) {
                this.stopAndEngage(state, entity, target, CombatStatus.Fighting);
            } else {
                this.transitionToPursue(state, entity, target);
            }
            return;
        }

        // Enemy moved out of shoot range — pursue or idle
        if (dist > SHOOT_RANGE) {
            if (this.isUnitReserved(state.entityId)) {
                this.transitionToIdle(state);
            } else {
                this.transitionToPursue(state, entity, target);
            }
            return;
        }

        this.visuals.updateFacingDirection(entity, target);
        this.tickDamage(state, target, dt);
    }

    // ── Damage & death ────────────────────────────────────────────────────

    /**
     * Apply damage to a combat target from an external source (e.g., garrisoned bowman).
     * Handles health decrement, event emission, and death if health reaches zero.
     */
    applyExternalDamage(attackerId: number, targetId: number, damage: number): void {
        this.inflictDamage(attackerId, targetId, damage);
    }

    /** Core damage logic: decrement health, emit event, kill if dead. */
    private inflictDamage(attackerId: number, targetId: number, damage: number): void {
        const targetState = this.states.get(targetId)!;

        targetState.health -= damage;

        this.eventBus.emit('combat:unitAttacked', {
            unitId: attackerId,
            targetId,
            damage,
            remainingHealth: Math.max(0, targetState.health),
        });

        if (targetState.health <= 0) {
            this.killUnit(targetState, attackerId);
        }
    }

    private killUnit(state: CombatState, killedBy: number): void {
        log.debug(`Unit ${state.entityId} killed by ${killedBy}`);

        // Emit event FIRST — siege system may re-lock surviving units synchronously
        this.eventBus.emit('combat:unitDefeated', {
            unitId: state.entityId,
            defeatedBy: killedBy,
            level: 'info',
        });

        // Auto-clear stale locks pointing to the dead unit (skip units re-locked by event handlers)
        for (const [id, lock] of this.lockedTargets) {
            if (lock.targetId === state.entityId) {
                this.lockedTargets.delete(id);
            }
        }
        this.lockedTargets.delete(state.entityId);

        // Clear non-locked combatants targeting the dead unit (locked ones were re-assigned above)
        for (const other of this.states.values()) {
            if (other.targetId === state.entityId && !this.lockedTargets.has(other.entityId)) {
                other.targetId = null;
                this.pursuitTimers.delete(other.entityId);
                const controller = this.gameState.movement.getController(other.entityId);
                if (controller && controller.state !== 'idle') {
                    controller.clearPath();
                }
                this.transitionToIdle(other);
            }
        }

        // Remove entity from game (triggers entity:removed → unregister)
        this.executeCommand({ type: 'remove_entity', entityId: state.entityId });
    }

    // ── Target finding ────────────────────────────────────────────────────

    findNearestEnemy(entity: Entity): Entity | null {
        return findNearestEnemyHelper(entity, this.gameState, this.states);
    }

    /**
     * Validate that the current target still exists and is alive.
     * If invalid, reset unit to idle and return null.
     */
    private validateTarget(state: CombatState): Entity | null {
        if (state.targetId === null) {
            this.transitionToIdle(state);
            return null;
        }

        const target = this.gameState.getEntity(state.targetId);
        if (!target) {
            state.targetId = null;
            this.transitionToIdle(state);
            return null;
        }

        const targetState = this.states.get(state.targetId);
        if (!targetState || targetState.health <= 0) {
            state.targetId = null;
            this.transitionToIdle(state);
            return null;
        }

        return target;
    }

    /** Reset to idle and restore idle animation if unit was fighting or shooting. */
    private transitionToIdle(state: CombatState): void {
        const wasEngaged = state.status === CombatStatus.Fighting || state.status === CombatStatus.Shooting;
        state.status = CombatStatus.Idle;
        state.attackTimer = 0;
        if (wasEngaged) {
            this.visuals.applyIdleAnimation(state.entityId);
        }
    }

    /** Switch to pursuing a target — issues the initial move and plays walk animation. */
    private transitionToPursue(state: CombatState, entity: Entity, target: Entity): void {
        state.status = CombatStatus.Pursuing;
        this.pursuitTimers.set(state.entityId, 0);
        const dest = resolveOutsideBuilding(target.x, target.y, this.gameState.buildingOccupancy);
        this.gameState.movement.moveUnit(state.entityId, dest.x, dest.y);
        this.visuals.applyWalkAnimation(entity, target);
    }

    /** Apply damage on cooldown. Shared by handleFighting and handleShooting. */
    private tickDamage(state: CombatState, target: Entity, dt: number): void {
        const stats = getCombatStats(state.unitType);
        state.attackTimer += dt;
        if (state.attackTimer >= stats.attackCooldown) {
            state.attackTimer -= stats.attackCooldown;
            this.inflictDamage(state.entityId, target.id, stats.attackPower);
        }
    }
}
