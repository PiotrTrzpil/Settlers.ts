/**
 * Combat state types and unit combat configuration.
 */

import { UnitType, getBaseUnitType, getUnitLevel } from '../../core/unit-types';

/** Combat behavior state for a military unit */
export enum CombatStatus {
    /** No enemy detected, standing idle */
    Idle = 0,
    /** Moving toward a detected enemy */
    Pursuing = 1,
    /** Adjacent to enemy, actively fighting (melee) */
    Fighting = 2,
    /** In range, shooting at enemy (ranged units only) */
    Shooting = 3,
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

/** Base combat stats per military unit type (L1 base type) */
const COMBAT_STATS: Partial<Record<UnitType, CombatStats>> = {
    [UnitType.Swordsman1]: { maxHealth: 100, attackPower: 15, attackCooldown: 1.5 },
    [UnitType.Bowman1]: { maxHealth: 80, attackPower: 12, attackCooldown: 2.0 },
    [UnitType.SquadLeader]: { maxHealth: 120, attackPower: 18, attackCooldown: 1.5 },
    [UnitType.Medic1]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.Healer]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.AxeWarrior1]: { maxHealth: 100, attackPower: 16, attackCooldown: 1.4 },
    [UnitType.BlowgunWarrior1]: { maxHealth: 70, attackPower: 10, attackCooldown: 1.8 },
    [UnitType.BackpackCatapultist1]: { maxHealth: 80, attackPower: 20, attackCooldown: 2.5 },
};

/** Level multipliers for combat stats: [L1, L2, L3] */
const LEVEL_MULTIPLIERS: readonly [number, number, number] = [1.0, 1.5, 2.0];

/** Default stats for military units not explicitly configured */
const DEFAULT_COMBAT_STATS: CombatStats = { maxHealth: 80, attackPower: 10, attackCooldown: 2.0 };

/** Unit types that have ranged attacks (shoot when far, melee when close). */
const RANGED_BASE_TYPES: ReadonlySet<UnitType> = new Set([
    UnitType.Bowman1,
    UnitType.BlowgunWarrior1,
    UnitType.BackpackCatapultist1,
]);

/** Check if a unit type is a ranged attacker (bowman, blowgun warrior, catapultist). */
export function isRangedUnitType(unitType: UnitType): boolean {
    return RANGED_BASE_TYPES.has(getBaseUnitType(unitType));
}

/** Get combat stats for a unit type. Level is derived from the UnitType itself. */
export function getCombatStats(unitType: UnitType): CombatStats {
    const base = COMBAT_STATS[getBaseUnitType(unitType)] ?? DEFAULT_COMBAT_STATS;
    const level = getUnitLevel(unitType);
    const mult = LEVEL_MULTIPLIERS[level - 1]!;
    if (mult === 1) {
        return base;
    }
    return {
        maxHealth: Math.round(base.maxHealth * mult),
        attackPower: Math.round(base.attackPower * mult),
        attackCooldown: base.attackCooldown,
    };
}

/** Create initial combat state for a newly registered military unit */
export function createCombatState(entityId: number, player: number, unitType: UnitType): CombatState {
    const stats = getCombatStats(unitType);
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
