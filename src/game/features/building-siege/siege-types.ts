/**
 * Building Siege System types and constants.
 *
 * Extracted from building-siege-system.ts to keep that module under the line limit.
 */

import type { CoreDeps } from '../feature';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { Command, CommandResult } from '../../commands';

// ── Constants ──────────────────────────

/** How often (in ticks) the system scans for new siege opportunities and checks arrivals. */
export const TICK_CHECK_INTERVAL = 10;

/** Max attackers that simultaneously fight a single defender. */
export const MAX_ACTIVE_ATTACKERS = 2;

/** Max total attackers committed to a single siege (fighting + waiting at door). */
export const MAX_SIEGE_ATTACKERS = 4;

/** Chebyshev distance threshold for "unit is at the building door". */
export const DOOR_ARRIVAL_DISTANCE = 2;

/** Radius (Euclidean) to search for enemy garrison buildings around a swordsman. */
export const BUILDING_SEARCH_RADIUS = 18;

/** Radius (Euclidean) for idle swordsman scan around enemy garrison buildings. */
export const IDLE_SCAN_RADIUS = 18;

// ── Types ──────────────────────────

export enum SiegePhase {
    /** Attackers approaching door, no defender ejected yet */
    Approaching = 0,
    /** Defender ejected, combat in progress */
    Fighting = 1,
    /** All defenders dead, attacker entering building */
    Capturing = 2,
}

export interface SiegeState {
    buildingId: number;
    /** Player who is attacking this building */
    attackerPlayer: number;
    phase: SiegePhase;
    /** Swordsman IDs committed to this siege (at door or approaching) */
    attackerIds: number[];
    /** Currently ejected defender entity ID (null if none yet or between defenders) */
    activeDefenderId: number | null;
}

// ── Config ──────────────────────────

export interface BuildingSiegeSystemConfig extends CoreDeps {
    garrisonManager: TowerGarrisonManager;
    combatSystem: CombatSystem;
    visualService: EntityVisualService;
    unitReservation: UnitReservationRegistry;
    settlerTaskSystem: SettlerTaskSystem;
    executeCommand: (cmd: Command) => CommandResult;
}
