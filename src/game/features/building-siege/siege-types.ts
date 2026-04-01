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

// ── Constants ──────────────────────────

/** How often (in ticks) the system validates active siege states. */
export const TICK_CHECK_INTERVAL = 10;

/** Chebyshev distance threshold for "unit is at the building door" (must be adjacent). */
export const DOOR_ARRIVAL_DISTANCE = 1;

/** Radius (Euclidean) to search for enemy garrison buildings around a swordsman. */
export const BUILDING_SEARCH_RADIUS = 25;

/** Max attackers allowed to fight the door defender simultaneously. */
export const MAX_DOOR_ATTACKERS = 2;

// ── Types ──────────────────────────

/**
 * Per-building siege state. Tracks only the defender ejection and combat —
 * attackers are free units managed by the CombatSystem.
 * When all defenders are dead, the siege dispatches a capturer via garrisoning
 * code and removes itself. Ownership change is detected by garrison:unitEntered.
 */
export interface SiegeState {
    buildingId: number;
    /** Currently ejected defender entity ID (reserved to stay at door) */
    activeDefenderId: number | null;
    /** Enemy unit IDs currently allowed to fight the door defender (max MAX_DOOR_ATTACKERS). */
    doorAttackerIds: number[];
}

// ── Config ──────────────────────────

/** Notifies the tower combat system about active door defenders. */
export interface DoorDefenderNotifier {
    setDoorDefender(buildingId: number, defenderId: number): void;
    clearDoorDefender(buildingId: number): void;
}

export interface BuildingSiegeSystemConfig extends CoreDeps {
    garrisonManager: TowerGarrisonManager;
    combatSystem: CombatSystem;
    unitReservation: UnitReservationRegistry;
    settlerTaskSystem: SettlerTaskSystem;
    doorDefenderNotifier: DoorDefenderNotifier;
}
