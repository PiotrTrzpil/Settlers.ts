/**
 * Building Health Tracker — general-purpose HP tracking for buildings.
 *
 * Tracks health for buildings that can take damage (towers, castles, etc.).
 * Buildings are initialized with max HP based on their type. When health
 * reaches 0, a callback fires to handle destruction.
 *
 * Currently used by the Dark Tribe tower assault system, but designed to
 * support any future mechanic that damages buildings (catapults, etc.).
 */

import { BuildingType } from '../buildings/building-type';

/** Max HP for each building type that can take structural damage. */
const BUILDING_MAX_HEALTH: Partial<Record<BuildingType, number>> = {
    [BuildingType.GuardTowerSmall]: 200,
    [BuildingType.GuardTowerBig]: 400,
    [BuildingType.Castle]: 600,
};

/** Per-building health state. */
export interface BuildingHealthState {
    readonly buildingId: number;
    health: number;
    readonly maxHealth: number;
}

/**
 * Returns the max health for a building type, or undefined if the type
 * does not support structural damage.
 */
export function getBuildingMaxHealth(buildingType: BuildingType): number | undefined {
    return BUILDING_MAX_HEALTH[buildingType];
}

/**
 * Tracks health for damageable buildings. Each building must be explicitly
 * initialized before it can take damage. Destroyed buildings (health <= 0)
 * are reported via the onDestroyed callback and automatically removed.
 */
export class BuildingHealthTracker {
    private readonly states = new Map<number, BuildingHealthState>();

    /** Called when a building's health reaches 0. */
    onDestroyed?: (buildingId: number) => void;

    /** Initialize health tracking for a building. No-op if already tracked. */
    initBuilding(buildingId: number, buildingType: BuildingType): boolean {
        if (this.states.has(buildingId)) {
            return false;
        }
        const maxHealth = BUILDING_MAX_HEALTH[buildingType];
        if (maxHealth === undefined) {
            return false;
        }
        this.states.set(buildingId, { buildingId, health: maxHealth, maxHealth });
        return true;
    }

    /** Remove health tracking for a building. */
    removeBuilding(buildingId: number): void {
        this.states.delete(buildingId);
    }

    /** Get current health state, or undefined if not tracked. */
    getHealth(buildingId: number): Readonly<BuildingHealthState> | undefined {
        return this.states.get(buildingId);
    }

    /**
     * Apply damage to a building. Returns the remaining health.
     * If health reaches 0, fires onDestroyed and removes the state.
     */
    applyDamage(buildingId: number, damage: number): number {
        const state = this.states.get(buildingId);
        if (!state) {
            throw new Error(`BuildingHealthTracker: no health state for building ${buildingId}`);
        }
        state.health -= damage;
        if (state.health <= 0) {
            state.health = 0;
            this.states.delete(buildingId);
            this.onDestroyed?.(buildingId);
        }
        return state.health;
    }

    /** Whether a building is currently being tracked for health. */
    isTracked(buildingId: number): boolean {
        return this.states.has(buildingId);
    }
}
