/**
 * Tower Combat System — garrisoned bowmen scan for enemies and deal ranged damage.
 *
 * Each scan interval:
 * 1. Iterate all towers with garrisoned bowmen
 * 2. Find nearest enemy within TOWER_ATTACK_RANGE of the building
 * 3. Each bowman independently fires on cooldown using getCombatStats()
 * 4. Damage applied via CombatSystem.applyExternalDamage()
 */

import type { TickSystem } from '../../../core/tick-system';
import type { TowerGarrisonManager } from '../tower-garrison-manager';
import type { CombatSystem } from '../../combat/combat-system';
import type { GameState } from '../../../game-state';
import type { EventBus } from '../../../event-bus';
import type { Entity } from '../../../entity';
import { EntityType, UnitType } from '../../../entity';
import { hexDistance } from '../../../systems/hex-directions';
import { getCombatStats } from '../../combat/combat-state';

import { createLogger } from '@/utilities/logger';

const log = createLogger('TowerCombatSystem');

/** Range in hex tiles at which garrisoned bowmen can fire. */
export const TOWER_ATTACK_RANGE = 8;

/** How often garrisoned bowmen scan for targets (seconds). */
export const TOWER_SCAN_INTERVAL = 0.5;

export interface TowerCombatSystemConfig {
    garrisonManager: TowerGarrisonManager;
    combatSystem: CombatSystem;
    gameState: GameState;
    eventBus: EventBus;
}

/**
 * Exported map of bowman ID to current target ID.
 * Read by the render pass to determine bowman facing direction.
 */
export const towerBowmanTargets: Map<number, number> = new Map();

export class TowerCombatSystem implements TickSystem {
    private readonly garrisonManager: TowerGarrisonManager;
    private readonly combatSystem: CombatSystem;
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;

    /** Accumulated time for periodic scanning. */
    private scanTimer = 0;

    /** Per-bowman attack cooldown timers, keyed by unit ID. */
    private readonly attackTimers = new Map<number, number>();

    constructor(config: TowerCombatSystemConfig) {
        this.garrisonManager = config.garrisonManager;
        this.combatSystem = config.combatSystem;
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
    }

    tick(dt: number): void {
        try {
            this.scanTimer += dt;
            const shouldScan = this.scanTimer >= TOWER_SCAN_INTERVAL;
            if (shouldScan) {
                this.scanTimer = 0;
            }

            // Advance all bowman attack timers
            for (const [id, t] of this.attackTimers) {
                this.attackTimers.set(id, t + dt);
            }

            if (!shouldScan) {
                return;
            }

            // Clear stale targets — rebuilt each scan
            towerBowmanTargets.clear();

            this.processAllTowers();
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.error('Unhandled error in tower combat tick', err);
        }
    }

    onEntityRemoved(entityId: number): void {
        this.attackTimers.delete(entityId);
        towerBowmanTargets.delete(entityId);
    }

    private processAllTowers(): void {
        // Iterate all buildings that have garrisons
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) {
                continue;
            }

            const garrison = this.garrisonManager.getGarrison(entity.id);
            if (!garrison) {
                continue;
            }
            if (garrison.bowmanSlots.unitIds.length === 0) {
                continue;
            }

            this.processTower(entity, garrison.bowmanSlots.unitIds);
        }
    }

    private processTower(building: Entity, bowmanIds: readonly number[]): void {
        const nearby = this.gameState.getEntitiesInRadius(building.x, building.y, TOWER_ATTACK_RANGE);

        // Find valid enemy targets
        const enemies: Entity[] = [];
        for (const candidate of nearby) {
            if (candidate.type !== EntityType.Unit) {
                continue;
            }
            if (candidate.player === building.player) {
                continue;
            }

            const combatState = this.combatSystem.getState(candidate.id);
            if (!combatState || combatState.health <= 0) {
                continue;
            }

            enemies.push(candidate);
        }

        if (enemies.length === 0) {
            return;
        }

        // Each bowman independently picks nearest target and fires
        for (const bowmanId of bowmanIds) {
            this.processBowman(bowmanId, building, enemies);
        }
    }

    private processBowman(bowmanId: number, building: Entity, enemies: Entity[]): void {
        const target = this.findNearestEnemy(building, enemies);

        towerBowmanTargets.set(bowmanId, target.id);

        // Get bowman's unit type for stats
        const bowmanEntity = this.gameState.getEntity(bowmanId);
        if (!bowmanEntity) {
            this.attackTimers.delete(bowmanId);
            return;
        }

        const stats = getCombatStats(bowmanEntity.subType as UnitType);

        // Initialize timer if needed
        if (!this.attackTimers.has(bowmanId)) {
            this.attackTimers.set(bowmanId, 0);
        }

        // OK: has() check above guarantees entry exists
        const elapsed = this.attackTimers.get(bowmanId)!;
        if (elapsed >= stats.attackCooldown) {
            this.attackTimers.set(bowmanId, elapsed - stats.attackCooldown);

            this.combatSystem.applyExternalDamage(bowmanId, target.id, stats.attackPower);

            this.eventBus.emit('garrison:bowmanFired', {
                buildingId: building.id,
                unitId: bowmanId,
                unitType: bowmanEntity.subType as UnitType,
                targetId: target.id,
                damage: stats.attackPower,
            });

            log.debug(`Bowman ${bowmanId} in tower ${building.id} fired at ${target.id} for ${stats.attackPower} dmg`);
        }
    }

    /**
     * Pick nearest enemy by hexDistance from building. Ties broken by entity ID (lowest wins).
     * Caller guarantees enemies is non-empty.
     */
    private findNearestEnemy(building: Entity, enemies: Entity[]): Entity {
        let best = enemies[0]!;
        let bestDist = hexDistance(building.x, building.y, best.x, best.y);

        for (let i = 1; i < enemies.length; i++) {
            const candidate = enemies[i]!;
            const dist = hexDistance(building.x, building.y, candidate.x, candidate.y);
            if (dist < bestDist || (dist === bestDist && candidate.id < best.id)) {
                best = candidate;
                bestDist = dist;
            }
        }

        return best;
    }
}
