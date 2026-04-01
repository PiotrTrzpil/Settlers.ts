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
import { EntityType, isUnitTypeMilitary, UnitType, tileKey, EXTENDED_OFFSETS } from '../../entity';
import { hexDistanceTo, findNearestByHexDistance } from '../../systems/hex-directions';
import { CombatState, CombatStatus, createCombatState, getCombatStats, isRangedUnitType } from './combat-state';
import { CombatVisuals } from './combat-animations';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';
import type { Command, CommandResult } from '../../commands';

const log = createLogger('CombatSystem');

/** Detection range: how far a unit scans for enemies (in hex tiles) */
const DETECTION_RANGE = 17;

/** Melee fight range: hex distance at which a unit can melee attack (1 = adjacent) */
const FIGHT_RANGE = 1;

/** Distance threshold: ranged units shoot when enemy is farther than this, melee when closer. */
const RANGED_MELEE_THRESHOLD = 2;

/** Maximum range at which ranged units can shoot. */
const SHOOT_RANGE = 8;

/**
 * How often idle units scan for enemies (seconds).
 * Scanning every tick is wasteful; a periodic sweep suffices.
 */
const SCAN_INTERVAL = 0.5;

/**
 * How often pursuing units re-check if they need to re-path (seconds).
 * Avoids spamming moveUnit every tick while chasing.
 */
const PURSUIT_REPATH_INTERVAL = 1.0;

export interface CombatSystemConfig extends CoreDeps {
    visualService: EntityVisualService;
    executeCommand: (cmd: Command) => CommandResult;
    isUnitReserved: (entityId: number) => boolean;
}

export class CombatSystem implements TickSystem {
    private readonly states = new Map<number, CombatState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly visuals: CombatVisuals;
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private readonly isUnitReserved: (entityId: number) => boolean;

    /** Accumulated time for periodic enemy scanning */
    private scanTimer = 0;

    /** Per-unit timers for pursuit re-pathing */
    private pursuitTimers = new Map<number, number>();

    /** Units marching to a player-commanded destination — skip combat until they stop. */
    private readonly passiveUnits = new Set<number>();

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
     * Returns true if there are visible, non-reserved enemy military units
     * near the given entity. Used by the siege system to defer siege start
     * while field enemies are present.
     */
    hasNearbyThreats(entityId: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity) {
            return false;
        }
        const nearby = this.gameState.getEntitiesInRadius(entity.x, entity.y, DETECTION_RANGE);
        for (const candidate of nearby) {
            if (candidate.type !== EntityType.Unit || candidate.hidden) {
                continue;
            }
            if (candidate.player === entity.player) {
                continue;
            }
            if (!isUnitTypeMilitary(candidate.subType as UnitType)) {
                continue;
            }
            if (this.isUnitReserved(candidate.id)) {
                continue;
            }
            return true;
        }
        return false;
    }

    /**
     * Release a unit from combat, returning it to idle.
     * Called when the player issues an explicit command (move/attack override).
     * The unit will not re-engage until the next idle scan.
     */
    releaseFromCombat(entityId: number): void {
        const state = this.states.get(entityId);
        if (!state) {
            return;
        }
        const wasEngaged = state.status === CombatStatus.Fighting || state.status === CombatStatus.Shooting;
        state.status = CombatStatus.Idle;
        state.targetId = null;
        state.attackTimer = 0;
        this.pursuitTimers.delete(entityId);
        if (wasEngaged) {
            this.visuals.applyIdleAnimation(entityId);
        }
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
        const entity = this.gameState.getEntity(state.entityId);
        if (!entity) {
            this.states.delete(id);
            this.passiveUnits.delete(id);
            return;
        }

        // Passive units march without engaging — clear when they stop
        if (this.passiveUnits.has(id)) {
            const controller = this.gameState.movement.getController(id);
            if (!controller || controller.state === 'idle') {
                this.passiveUnits.delete(id);
            } else {
                return;
            }
        }

        switch (state.status) {
            case CombatStatus.Idle:
                if (shouldScan) {
                    this.handleIdle(state, entity);
                }
                break;
            case CombatStatus.Pursuing:
                this.handlePursuing(state, entity, dt);
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
        const target = this.findNearestEnemy(entity);
        if (!target) {
            return;
        }

        const dist = hexDistanceTo(entity, target);
        const ranged = isRangedUnitType(state.unitType);

        // Adjacent enemy — engage melee immediately (all units)
        if (dist <= FIGHT_RANGE) {
            state.targetId = target.id;
            state.status = CombatStatus.Fighting;
            state.attackTimer = 0;
            this.visuals.applyFightAnimation(entity, target);
            log.debug(`Unit ${state.entityId} engaging adjacent enemy ${target.id}`);
            return;
        }

        // Ranged units within melee threshold — close in for melee
        if (ranged && dist <= RANGED_MELEE_THRESHOLD) {
            state.targetId = target.id;
            this.transitionToPursue(state, entity, target);
            log.debug(`Unit ${state.entityId} closing to melee range on enemy ${target.id}`);
            return;
        }

        // Ranged units within shoot range — start shooting
        if (ranged && dist <= SHOOT_RANGE) {
            state.targetId = target.id;
            state.status = CombatStatus.Shooting;
            state.attackTimer = 0;
            this.visuals.applyShootAnimation(entity, target);
            log.debug(`Unit ${state.entityId} shooting at enemy ${target.id} from distance ${dist}`);
            return;
        }

        // Reserved units (e.g. siege defenders) don't pursue distant enemies
        if (this.isUnitReserved(state.entityId)) {
            return;
        }

        state.targetId = target.id;
        this.transitionToPursue(state, entity, target);
        log.debug(`Unit ${state.entityId} detected enemy ${target.id}, pursuing`);
    }

    private handlePursuing(state: CombatState, entity: Entity, _dt: number): void {
        const target = this.validateTarget(state, entity);
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

        // Re-path periodically toward the (possibly moving) target.
        const elapsed = this.pursuitTimers.get(state.entityId)!;
        if (elapsed >= PURSUIT_REPATH_INTERVAL) {
            this.pursuitTimers.set(state.entityId, 0);
            const dest = this.resolveOutsideBuilding(target.x, target.y);
            this.gameState.movement.moveUnit(state.entityId, dest.x, dest.y);
            this.visuals.applyWalkAnimation(entity, target);
        }
    }

    /** Stop movement and transition to a combat engagement status (Fighting or Shooting). */
    private stopAndEngage(
        state: CombatState,
        entity: Entity,
        target: Entity,
        status: CombatStatus.Fighting | CombatStatus.Shooting
    ): void {
        state.status = status;
        state.attackTimer = 0;

        const controller = this.gameState.movement.getController(state.entityId);
        if (controller && controller.state !== 'idle') {
            controller.clearPath();
        }

        if (status === CombatStatus.Shooting) {
            this.visuals.applyShootAnimation(entity, target);
        } else {
            this.visuals.applyFightAnimation(entity, target);
        }

        log.debug(
            `Unit ${state.entityId} engaging enemy ${target.id} (${status === CombatStatus.Shooting ? 'ranged' : 'melee'})`
        );
    }

    private handleFighting(state: CombatState, entity: Entity, dt: number): void {
        const target = this.validateTarget(state, entity);
        if (!target) {
            return;
        }

        // Check if target moved out of melee range
        const dist = hexDistanceTo(entity, target);
        if (dist > FIGHT_RANGE) {
            if (this.isUnitReserved(state.entityId)) {
                this.transitionToIdle(state, entity);
            } else if (isRangedUnitType(state.unitType) && dist > RANGED_MELEE_THRESHOLD && dist <= SHOOT_RANGE) {
                // Ranged unit: target moved away but still in shoot range — switch to shooting
                state.status = CombatStatus.Shooting;
                state.attackTimer = 0;
                this.visuals.applyShootAnimation(entity, target);
            } else {
                this.transitionToPursue(state, entity, target);
            }
            return;
        }

        this.visuals.updateFacingDirection(entity, target);
        this.tickDamage(state, target, dt);
    }

    private handleShooting(state: CombatState, entity: Entity, dt: number): void {
        const target = this.validateTarget(state, entity);
        if (!target) {
            return;
        }

        const dist = hexDistanceTo(entity, target);

        // Enemy closed in — switch to melee
        if (dist <= RANGED_MELEE_THRESHOLD) {
            if (dist <= FIGHT_RANGE) {
                state.status = CombatStatus.Fighting;
                state.attackTimer = 0;
                this.visuals.applyFightAnimation(entity, target);
            } else {
                this.transitionToPursue(state, entity, target);
            }
            return;
        }

        // Enemy moved out of shoot range — pursue or idle
        if (dist > SHOOT_RANGE) {
            if (this.isUnitReserved(state.entityId)) {
                this.transitionToIdle(state, entity);
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

    private applyDamage(attacker: CombatState, targetEntity: Entity, damage: number): void {
        this.inflictDamage(attacker.entityId, targetEntity.id, damage);
    }

    /** Core damage logic: decrement health, emit event, kill if dead. */
    private inflictDamage(attackerId: number, targetId: number, damage: number): void {
        const targetState = this.states.get(targetId);
        if (!targetState) {
            return;
        }

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

        this.eventBus.emit('combat:unitDefeated', {
            unitId: state.entityId,
            defeatedBy: killedBy,
            level: 'info',
        });

        // Clear any combatants targeting the dead unit
        for (const other of this.states.values()) {
            if (other.targetId === state.entityId) {
                const wasEngaged = other.status === CombatStatus.Fighting || other.status === CombatStatus.Shooting;
                other.targetId = null;
                other.status = CombatStatus.Idle;
                other.attackTimer = 0;
                this.pursuitTimers.delete(other.entityId);

                // Stop movement if unit was pursuing the dead target
                const controller = this.gameState.movement.getController(other.entityId);
                if (controller && controller.state !== 'idle') {
                    controller.clearPath();
                }

                // Restore idle animation if unit was fighting or shooting
                if (wasEngaged) {
                    this.visuals.applyIdleAnimation(other.entityId);
                }
            }
        }

        // Remove entity from game (triggers entity:removed → unregister)
        this.executeCommand({ type: 'remove_entity', entityId: state.entityId });
    }

    // ── Target finding ────────────────────────────────────────────────────

    private findNearestEnemy(entity: Entity): Entity | null {
        const nearby = this.gameState.getEntitiesInRadius(entity.x, entity.y, DETECTION_RANGE);
        const enemies = nearby.filter(c => {
            if (c.type !== EntityType.Unit || c.hidden) {
                return false;
            }
            if (c.player === entity.player) {
                return false;
            }
            if (!isUnitTypeMilitary(c.subType as UnitType)) {
                return false;
            }
            const state = this.states.get(c.id);
            return state !== undefined && state.health > 0;
        });
        return findNearestByHexDistance(entity, enemies);
    }

    /**
     * Validate that the current target still exists and is alive.
     * If invalid, reset unit to idle and return null.
     * @param entity The attacking entity (used to restore idle animation when leaving fight)
     */
    private validateTarget(state: CombatState, entity?: Entity): Entity | null {
        if (state.targetId === null) {
            this.transitionToIdle(state, entity);
            return null;
        }

        const target = this.gameState.getEntity(state.targetId);
        if (!target) {
            state.targetId = null;
            this.transitionToIdle(state, entity);
            return null;
        }

        const targetState = this.states.get(state.targetId);
        if (!targetState || targetState.health <= 0) {
            state.targetId = null;
            this.transitionToIdle(state, entity);
            return null;
        }

        return target;
    }

    /** Reset to idle and restore idle animation if unit was fighting or shooting. */
    private transitionToIdle(state: CombatState, _entity?: Entity): void {
        const wasEngaged = state.status === CombatStatus.Fighting || state.status === CombatStatus.Shooting;
        state.status = CombatStatus.Idle;
        state.attackTimer = 0;
        if (wasEngaged) {
            this.visuals.applyIdleAnimation(state.entityId);
        }
    }

    /** Switch to pursuing a target — sets status, starts pursuit timer, plays walk animation. */
    private transitionToPursue(state: CombatState, entity: Entity, target: Entity): void {
        state.status = CombatStatus.Pursuing;
        this.pursuitTimers.set(state.entityId, PURSUIT_REPATH_INTERVAL);
        this.visuals.applyWalkAnimation(entity, target);
    }

    /** Apply damage on cooldown. Shared by handleFighting and handleShooting. */
    private tickDamage(state: CombatState, target: Entity, dt: number): void {
        const stats = getCombatStats(state.unitType);
        state.attackTimer += dt;
        if (state.attackTimer >= stats.attackCooldown) {
            state.attackTimer -= stats.attackCooldown;
            this.applyDamage(state, target, stats.attackPower);
        }
    }

    // ── Position helpers ──────────────────────────────────────────────────

    /** If (x,y) is inside a building footprint, find the nearest tile outside. */
    private resolveOutsideBuilding(x: number, y: number): { x: number; y: number } {
        if (!this.gameState.buildingOccupancy.has(tileKey(x, y))) {
            return { x, y };
        }
        for (const [dx, dy] of EXTENDED_OFFSETS) {
            const nx = x + dx;
            const ny = y + dy;
            if (!this.gameState.buildingOccupancy.has(tileKey(nx, ny))) {
                return { x: nx, y: ny };
            }
        }
        return { x, y };
    }
}
