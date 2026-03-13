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
import { EntityType, isUnitTypeMilitary, UnitType } from '../../entity';
import { hexDistance, getApproxDirection } from '../../systems/hex-directions';
import { CombatState, CombatStatus, createCombatState, getCombatStats } from './combat-state';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';
import type { Command, CommandResult } from '../../commands';
import type { Persistable } from '@/game/persistence';
import type { SerializedCombatUnit } from '@/game/state/game-state-persistence';

const log = createLogger('CombatSystem');

/** Detection range: how far a unit scans for enemies (in hex tiles) */
const DETECTION_RANGE = 12;

/** Fight range: hex distance at which a unit can attack (1 = adjacent) */
const FIGHT_RANGE = 1;

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
}

export class CombatSystem implements TickSystem, Persistable<SerializedCombatUnit[]> {
    readonly persistKey = 'combat' as const;

    private readonly states = new Map<number, CombatState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly visualService: EntityVisualService;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    /** Accumulated time for periodic enemy scanning */
    private scanTimer = 0;

    /** Per-unit timers for pursuit re-pathing */
    private pursuitTimers = new Map<number, number>();

    constructor(cfg: CombatSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.visualService = cfg.visualService;
        this.executeCommand = cfg.executeCommand;
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
     * Release a unit from combat, returning it to idle.
     * Called when the player issues an explicit command (move/attack override).
     * The unit will not re-engage until the next idle scan.
     */
    releaseFromCombat(entityId: number): void {
        const state = this.states.get(entityId);
        if (!state) {
            return;
        }
        const wasFighting = state.status === CombatStatus.Fighting;
        state.status = CombatStatus.Idle;
        state.targetId = null;
        state.attackTimer = 0;
        this.pursuitTimers.delete(entityId);
        if (wasFighting) {
            this.applyIdleAnimation(entityId);
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
                const entity = this.gameState.getEntity(state.entityId);
                if (!entity) {
                    this.states.delete(id);
                    continue;
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
                }
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error in combat tick for entity ${state.entityId}`, err);
            }
        }
    }

    // ── State handlers ────────────────────────────────────────────────────

    private handleIdle(state: CombatState, entity: Entity): void {
        const target = this.findNearestEnemy(entity);
        if (!target) {
            return;
        }

        state.targetId = target.id;
        state.status = CombatStatus.Pursuing;
        this.pursuitTimers.set(state.entityId, PURSUIT_REPATH_INTERVAL); // path immediately
        this.applyWalkAnimation(entity, target);
        log.debug(`Unit ${state.entityId} detected enemy ${target.id}, pursuing`);
    }

    private handlePursuing(state: CombatState, entity: Entity, _dt: number): void {
        // Validate target still exists and is alive
        const target = this.validateTarget(state, entity);
        if (!target) {
            return;
        }

        // Keep animation direction in sync with movement controller
        const controller = this.gameState.movement.getController(state.entityId);
        if (controller) {
            const vs = this.visualService.getState(entity.id);
            if (vs?.animation && vs.animation.direction !== controller.direction) {
                this.visualService.setDirection(entity.id, controller.direction);
            }
        }

        const dist = hexDistance(entity.x, entity.y, target.x, target.y);

        // Close enough to fight
        if (dist <= FIGHT_RANGE) {
            state.status = CombatStatus.Fighting;
            state.attackTimer = 0;

            // Stop moving — we're in range
            if (controller && controller.state !== 'idle') {
                controller.clearPath();
            }

            // Play fight animation facing the target
            this.applyFightAnimation(entity, target);

            log.debug(`Unit ${state.entityId} engaging enemy ${target.id}`);
            return;
        }

        // Re-path periodically toward the (possibly moving) target
        const elapsed = this.pursuitTimers.get(state.entityId) ?? 0;
        if (elapsed >= PURSUIT_REPATH_INTERVAL) {
            this.pursuitTimers.set(state.entityId, 0);
            this.gameState.movement.moveUnit(state.entityId, target.x, target.y);
            this.applyWalkAnimation(entity, target);
        }
    }

    private handleFighting(state: CombatState, entity: Entity, dt: number): void {
        const target = this.validateTarget(state, entity);
        if (!target) {
            return;
        }

        // Check if target moved out of range
        const dist = hexDistance(entity.x, entity.y, target.x, target.y);
        if (dist > FIGHT_RANGE) {
            // Target moved away — re-pursue
            state.status = CombatStatus.Pursuing;
            this.pursuitTimers.set(state.entityId, PURSUIT_REPATH_INTERVAL);
            return;
        }

        // Keep facing the target (target may shift position while adjacent)
        const direction = getApproxDirection(entity.x, entity.y, target.x, target.y);
        const vs = this.visualService.getState(entity.id);
        if (vs?.animation && vs.animation.direction !== direction) {
            this.visualService.setDirection(entity.id, direction);
        }

        // Apply damage on cooldown
        const stats = getCombatStats(state.unitType);
        state.attackTimer += dt;
        if (state.attackTimer >= stats.attackCooldown) {
            state.attackTimer -= stats.attackCooldown;
            this.applyDamage(state, target, stats.attackPower);
        }
    }

    // ── Damage & death ────────────────────────────────────────────────────

    /**
     * Apply damage to a combat target from an external source (e.g., garrisoned bowman).
     * Handles health decrement, event emission, and death if health reaches zero.
     */
    applyExternalDamage(attackerId: number, targetId: number, damage: number): void {
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

    private applyDamage(attacker: CombatState, targetEntity: Entity, damage: number): void {
        const targetState = this.states.get(targetEntity.id);
        if (!targetState) {
            return;
        }

        targetState.health -= damage;

        this.eventBus.emit('combat:unitAttacked', {
            unitId: attacker.entityId,
            targetId: targetEntity.id,
            damage,
            remainingHealth: Math.max(0, targetState.health),
        });

        if (targetState.health <= 0) {
            this.killUnit(targetState, attacker.entityId);
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
                const wasFighting = other.status === CombatStatus.Fighting;
                other.targetId = null;
                other.status = CombatStatus.Idle;
                other.attackTimer = 0;
                this.pursuitTimers.delete(other.entityId);

                // Stop movement if unit was pursuing the dead target
                const controller = this.gameState.movement.getController(other.entityId);
                if (controller && controller.state !== 'idle') {
                    controller.clearPath();
                }

                // Restore idle animation if unit was fighting
                if (wasFighting) {
                    this.applyIdleAnimation(other.entityId);
                }
            }
        }

        // Remove entity from game (triggers entity:removed → unregister)
        this.executeCommand({ type: 'remove_entity', entityId: state.entityId });
    }

    // ── Target finding ────────────────────────────────────────────────────

    private findNearestEnemy(entity: Entity): Entity | null {
        const nearby = this.gameState.getEntitiesInRadius(entity.x, entity.y, DETECTION_RANGE);

        let bestTarget: Entity | null = null;
        let bestDist = Infinity;

        for (const candidate of nearby) {
            if (candidate.type !== EntityType.Unit) {
                continue;
            }
            if (candidate.player === entity.player) {
                continue;
            }
            if (!isUnitTypeMilitary(candidate.subType as UnitType)) {
                continue;
            }

            // Only target units that are registered and alive
            const candidateState = this.states.get(candidate.id);
            if (!candidateState || candidateState.health <= 0) {
                continue;
            }

            const dist = hexDistance(entity.x, entity.y, candidate.x, candidate.y);
            if (dist < bestDist) {
                bestDist = dist;
                bestTarget = candidate;
            }
        }

        return bestTarget;
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

    /** Reset to idle and restore idle animation if unit was fighting. */
    private transitionToIdle(state: CombatState, _entity?: Entity): void {
        const wasFighting = state.status === CombatStatus.Fighting;
        state.status = CombatStatus.Idle;
        state.attackTimer = 0;
        if (wasFighting) {
            this.applyIdleAnimation(state.entityId);
        }
    }

    // ── Animation helpers ─────────────────────────────────────────────────

    /** Play walk animation facing the target (used during pursuit). */
    private applyWalkAnimation(entity: Entity, target: Entity): void {
        const direction = getApproxDirection(entity.x, entity.y, target.x, target.y);
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entity.id, {
            sequence: xmlKey(prefix, 'WALK'),
            loop: true,
            stopped: false,
        });
        this.visualService.setDirection(entity.id, direction);
    }

    /** Play fight animation and face the target. */
    private applyFightAnimation(entity: Entity, target: Entity): void {
        const direction = getApproxDirection(entity.x, entity.y, target.x, target.y);
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entity.id, {
            sequence: xmlKey(prefix, 'FIGHT'),
            loop: true,
            stopped: false,
        });
        this.visualService.setDirection(entity.id, direction);
    }

    /** Restore idle animation (stopped on frame 0 of walk). */
    private applyIdleAnimation(entityId: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity) {
            return;
        }
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entityId, {
            sequence: xmlKey(prefix, 'WALK'),
            loop: false,
            stopped: true,
        });
    }

    // ── Persistable ───────────────────────────────────────────────

    serialize(): SerializedCombatUnit[] {
        const result: SerializedCombatUnit[] = [];
        for (const [entityId, state] of this.states) {
            result.push({
                entityId,
                health: state.health,
                maxHealth: state.maxHealth,
            });
        }
        return result;
    }

    deserialize(data: SerializedCombatUnit[]): void {
        for (const s of data) {
            const state = this.states.get(s.entityId);
            if (!state) {
                continue;
            }
            state.health = s.health;
            state.maxHealth = s.maxHealth;
        }
    }
}
