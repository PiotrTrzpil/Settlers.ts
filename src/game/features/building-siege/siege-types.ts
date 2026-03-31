/**
 * Building Siege System types and constants.
 *
 * Extracted from building-siege-system.ts to keep that module under the line limit.
 */

import type { CoreDeps } from '../feature';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { Command, CommandResult } from '../../commands';

// ── Constants ──────────────────────────

/** How often (in ticks) the system validates active siege states. */
export const TICK_CHECK_INTERVAL = 10;

/** Chebyshev distance threshold for "unit is at the building door". */
export const DOOR_ARRIVAL_DISTANCE = 2;

/** Radius (Euclidean) to search for enemy garrison buildings around a swordsman. */
export const BUILDING_SEARCH_RADIUS = 25;

// ── Types ──────────────────────────

export enum SiegePhase {
    /** Defender ejected, combat happening (handled by CombatSystem) */
    Fighting = 0,
    /** All defenders dead, attacker entering building */
    Capturing = 1,
}

/**
 * Per-building siege state. Tracks only the defender and capture —
 * attackers are free units managed by the CombatSystem.
 */
export interface SiegeState {
    buildingId: number;
    phase: SiegePhase;
    /** Currently ejected defender entity ID (reserved to stay at door) */
    activeDefenderId: number | null;
    /** Unit dispatched to enter the building during Capturing phase */
    capturingUnitId: number | null;
}

// ── Config ──────────────────────────

export interface BuildingSiegeSystemConfig extends CoreDeps {
    garrisonManager: TowerGarrisonManager;
    combatSystem: CombatSystem;
    unitReservation: UnitReservationRegistry;
    settlerTaskSystem: SettlerTaskSystem;
    executeCommand: (cmd: Command) => CommandResult;
}
