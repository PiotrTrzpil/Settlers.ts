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

/** Combat stats per military unit type */
const COMBAT_STATS: Partial<Record<UnitType, CombatStats>> = {
    [UnitType.Swordsman]: { maxHealth: 100, attackPower: 15, attackCooldown: 1.5 },
    [UnitType.Bowman]: { maxHealth: 80, attackPower: 12, attackCooldown: 2.0 },
    [UnitType.SquadLeader]: { maxHealth: 120, attackPower: 18, attackCooldown: 1.5 },
    [UnitType.Medic]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.Healer]: { maxHealth: 60, attackPower: 5, attackCooldown: 2.0 },
    [UnitType.Angel]: { maxHealth: 150, attackPower: 20, attackCooldown: 1.2 },
};

/** Default stats for military units not explicitly configured */
const DEFAULT_COMBAT_STATS: CombatStats = { maxHealth: 80, attackPower: 10, attackCooldown: 2.0 };

/** Get combat stats for a unit type. Returns default stats for unconfigured military types. */
export function getCombatStats(unitType: UnitType): CombatStats {
    return COMBAT_STATS[unitType] ?? DEFAULT_COMBAT_STATS;
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
