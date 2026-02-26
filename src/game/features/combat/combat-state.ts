/**
 * Combat state types and unit combat configuration.
 */

import { UnitType } from '../../unit-types';

/** Combat behavior state for a military unit */
export enum CombatStatus {
    /** No enemy detected, standing idle */
    Idle = 0,
    /** Moving toward a detected enemy */
    Pursuing = 1,
    /** Adjacent to enemy, actively fighting */
    Fighting = 2,
}

/** Per-unit combat state tracked by CombatSystem */
export interface CombatState {
    entityId: number;
    player: number;
    unitType: UnitType;
    health: number;
    maxHealth: number;
    status: CombatStatus;
    /** Entity ID of the current combat target (enemy unit) */
    targetId: number | null;
    /** Time accumulated since last attack (seconds) */
    attackTimer: number;
}

/** Static combat stats for each military unit type */
export interface CombatStats {
    maxHealth: number;
    attackPower: number;
    /** Seconds between attacks */
    attackCooldown: number;
}

/** Base combat stats per military unit type (level 1) */
const COMBAT_STATS: Partial<Record<UnitType, CombatStats>> = {
    [UnitType.Swordsman]: { maxHealth: 100, attackPower: 15, attackCooldown: 1.5 },
    [UnitType.Bowman]: { maxHealth: 80, attackPower: 12, attackCooldown: 2.0 },
    [UnitType.SquadLeader]: { maxHealth: 120, attackPower: 18, attackCooldown: 1.5 },
    [UnitType.Medic]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.Healer]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.Angel]: { maxHealth: 150, attackPower: 20, attackCooldown: 1.2 },
};

/** Level multipliers for combat stats: [L1, L2, L3] */
const LEVEL_MULTIPLIERS: readonly [number, number, number] = [1.0, 1.5, 2.0];

/** Default stats for military units not explicitly configured */
const DEFAULT_COMBAT_STATS: CombatStats = { maxHealth: 80, attackPower: 10, attackCooldown: 2.0 };

/** Get combat stats for a unit type at a given level (1-3). */
export function getCombatStats(unitType: UnitType, level: number = 1): CombatStats {
    const base = COMBAT_STATS[unitType] ?? DEFAULT_COMBAT_STATS;
    const mult = LEVEL_MULTIPLIERS[Math.min(level, 3) - 1] ?? 1;
    if (mult === 1) return base;
    return {
        maxHealth: Math.round(base.maxHealth * mult),
        attackPower: Math.round(base.attackPower * mult),
        attackCooldown: base.attackCooldown,
    };
}

/** Create initial combat state for a newly registered military unit */
export function createCombatState(
    entityId: number,
    player: number,
    unitType: UnitType,
    level: number = 1
): CombatState {
    const stats = getCombatStats(unitType, level);
    return {
        entityId,
        player,
        unitType,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        status: CombatStatus.Idle,
        targetId: null,
        attackTimer: 0,
    };
}
