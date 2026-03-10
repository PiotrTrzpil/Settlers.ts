/**
 * Building Siege System — per-tick siege lifecycle for garrison buildings.
 *
 * Manages the full siege lifecycle:
 * 1. Swordsmen arrive at enemy garrison building door → siege begins
 * 2. Defenders are ejected one at a time from the garrison
 * 3. Up to 2 attackers engage each defender via CombatSystem
 * 4. When defender dies, next is ejected (or building captured if empty)
 * 5. Capture: ownership changes, garrison re-initialized for new owner
 *
 * State is keyed per-building (one siege per building). The system does NOT
 * modify CombatSystem internals — it force-assigns combat states by calling
 * releaseFromCombat + direct state mutation.
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { Command, CommandResult } from '../../commands';
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import type { Race } from '../../core/race';
import { getBaseUnitType } from '../../core/unit-types';
import { CombatStatus } from '../combat/combat-state';
import { isGarrisonBuildingType } from '../tower-garrison/internal/garrison-capacity';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';

const log = createLogger('BuildingSiegeSystem');

// ── Constants ──────────────────────────

/** How often (in ticks) the system scans for new siege opportunities and checks arrivals. */
const TICK_CHECK_INTERVAL = 10;

/** Max attackers that simultaneously fight a single defender. */
const MAX_ACTIVE_ATTACKERS = 2;

/** Max total attackers committed to a single siege (fighting + waiting at door). */
const MAX_SIEGE_ATTACKERS = 4;

/** Chebyshev distance threshold for "unit is at the building door". */
const DOOR_ARRIVAL_DISTANCE = 2;

/** Radius (Euclidean) to search for enemy garrison buildings around a swordsman. */
const BUILDING_SEARCH_RADIUS = 18;

/** Radius (Euclidean) for idle swordsman scan around enemy garrison buildings. */
const IDLE_SCAN_RADIUS = 18;

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

// ── System ──────────────────────────

export class BuildingSiegeSystem implements TickSystem {
    private readonly sieges = new Map<number, SiegeState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly garrisonManager: TowerGarrisonManager;
    private readonly combatSystem: CombatSystem;
    private readonly visualService: EntityVisualService;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    private tickCounter = 0;

    constructor(cfg: BuildingSiegeSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.garrisonManager = cfg.garrisonManager;
        this.combatSystem = cfg.combatSystem;
        this.visualService = cfg.visualService;
        this.unitReservation = cfg.unitReservation;
        this.settlerTaskSystem = cfg.settlerTaskSystem;
        this.executeCommand = cfg.executeCommand;
    }

    // ── Public API (called by feature wiring) ──────────────────────────

    /** Get the active siege state for a building, if any. */
    getSiege(buildingId: number): Readonly<SiegeState> | undefined {
        return this.sieges.get(buildingId);
    }

    /**
     * Called when a unit stops moving. If the unit is a swordsman near an
     * enemy garrison building door, begin or join a siege.
     */
    onMovementStopped(entityId: number): void {
        try {
            const unit = this.gameState.getEntity(entityId);
            if (!unit) return;
            if (unit.type !== EntityType.Unit) return;
            if (!this.isSwordsman(unit.subType as UnitType)) return;
            // Skip units already committed to another task (e.g., en-route to friendly garrison)
            // but allow units in a siege (they're reserved by us)
            if (this.unitReservation.isReserved(entityId) && !this.isInAnySiege(entityId)) return;

            this.tryBeginOrJoinSiege(entityId, unit);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.error(`Error in onMovementStopped for entity ${entityId}`, err);
        }
    }

    /**
     * Called when a unit is defeated in combat. If it's the active defender
     * of a siege, eject the next defender or transition to capture. If it's
     * an attacker, remove from the siege.
     */
    onUnitDefeated(entityId: number, _defeatedBy: number): void {
        try {
            // Check if the defeated unit is an active defender
            for (const [buildingId, siege] of this.sieges) {
                if (siege.activeDefenderId === entityId) {
                    siege.activeDefenderId = null;
                    this.advanceSiege(buildingId, siege);
                    return;
                }
            }

            // Check if the defeated unit is an attacker
            this.removeAttacker(entityId);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.error(`Error in onUnitDefeated for entity ${entityId}`, err);
        }
    }

    /**
     * Cancel an active siege on the given building. Called when the building
     * is destroyed or removed.
     */
    cancelSiege(buildingId: number): void {
        const siege = this.sieges.get(buildingId);
        if (!siege) return;

        // Release attackers from combat and reservations so they return to idle
        for (const attackerId of siege.attackerIds) {
            this.combatSystem.releaseFromCombat(attackerId);
            this.unitReservation.release(attackerId);
        }

        this.sieges.delete(buildingId);
        log.debug(`Siege on building ${buildingId} cancelled`);
    }

    /**
     * Called when any entity is removed. Cleans up attacker references
     * from active siege states.
     */
    onEntityRemoved(entityId: number): void {
        this.removeAttacker(entityId);
    }

    // ── TickSystem ──────────────────────────

    tick(_dt: number): void {
        this.tickCounter++;
        if (this.tickCounter < TICK_CHECK_INTERVAL) return;
        this.tickCounter = 0;

        // Process existing sieges
        for (const [buildingId, siege] of sortedEntries(this.sieges)) {
            try {
                this.tickSiege(buildingId, siege);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Error in siege tick for building ${buildingId}`, err);
            }
        }

        // Scan idle swordsmen near enemy garrison buildings
        this.scanIdleSwordsmen();
    }

    // Note: onEntityRemoved from TickSystem interface is covered by the public
    // onEntityRemoved method above (called by the feature's cleanupRegistry).

    // ── Tick logic ──────────────────────────

    private tickSiege(buildingId: number, siege: SiegeState): void {
        // Validate building still exists
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            this.sieges.delete(buildingId);
            return;
        }

        // Verify attacker count (onEntityRemoved handles cleanup; this is a safety fallback)
        if (siege.attackerIds.length === 0) {
            this.sieges.delete(buildingId);
            log.debug(`Siege on building ${buildingId} ended — no attackers remain`);
            return;
        }

        switch (siege.phase) {
        case SiegePhase.Approaching:
            // Check if any attacker has arrived at the door
            if (this.hasAttackerAtDoor(siege, building)) {
                this.advanceSiege(buildingId, siege);
            }
            break;
        case SiegePhase.Fighting:
            // Validate active defender still exists
            if (siege.activeDefenderId !== null) {
                const defender = this.gameState.getEntity(siege.activeDefenderId);
                if (!defender) {
                    siege.activeDefenderId = null;
                    this.advanceSiege(buildingId, siege);
                }
            }
            break;
        case SiegePhase.Capturing:
            // Capture is handled immediately in advanceSiege — this is a transient state
            break;
        }
    }

    // ── Siege initiation ──────────────────────────

    private tryBeginOrJoinSiege(unitId: number, unit: { x: number; y: number; player: number }): void {
        const target = this.findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS);
        if (!target) return;

        // Create or join siege state first (tracks this attacker, prevents over-commitment)
        const siege = this.getOrCreateSiege(unitId, target, unit.player);
        if (!siege) return; // already at max attackers

        const door = getBuildingDoorPos(
            target.x, target.y, target.race, target.subType as BuildingType
        );
        const doorDist = Math.max(Math.abs(unit.x - door.x), Math.abs(unit.y - door.y));

        if (doorDist > DOOR_ARRIVAL_DISTANCE) {
            // Not at door yet — redirect swordsman to a walkable tile near the door
            siege.phase = SiegePhase.Approaching;
            const approachTile = this.garrisonManager.getApproachTile(target);
            this.redirectToDoor(unitId, approachTile);
            return;
        }

        // At door — advance the siege (eject defender or capture)
        this.advanceSiege(target.id, siege);
    }

    /** Find the closest enemy garrison building (by door distance) within the given radius. */
    private findNearbyEnemyGarrison(
        unit: { x: number; y: number; player: number },
        radius: number,
    ): Entity | undefined {
        const nearby = this.gameState.getEntitiesInRadius(unit.x, unit.y, radius);
        let best: Entity | undefined;
        let bestDist = Infinity;

        for (const candidate of nearby) {
            if (candidate.type !== EntityType.Building) continue;
            if (candidate.player === unit.player) continue;
            if (!isGarrisonBuildingType(candidate.subType as BuildingType)) continue;

            // Measure distance to the door, not the building center
            const door = getBuildingDoorPos(
                candidate.x, candidate.y, candidate.race, candidate.subType as BuildingType
            );
            const dx = door.x - unit.x;
            const dy = door.y - unit.y;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = candidate;
            }
        }
        return best;
    }

    /** Assign a move task directly (bypasses command handler reservation check). */
    private redirectToDoor(unitId: number, door: { x: number; y: number }): void {
        this.settlerTaskSystem.assignMoveTask(unitId, door.x, door.y);
    }

    /**
     * Get an existing siege for the building, or create one. Adds the unit to
     * attackerIds if not already present. Returns null if the siege is at max
     * attacker capacity and the unit is not already part of it.
     */
    private getOrCreateSiege(unitId: number, building: Entity, attackerPlayer: number): SiegeState | null {
        const existing = this.sieges.get(building.id);
        if (existing) {
            if (existing.attackerIds.includes(unitId)) return existing;
            if (existing.attackerIds.length >= MAX_SIEGE_ATTACKERS) return null;
            existing.attackerIds.push(unitId);
            this.reserveAttacker(unitId);
            log.debug(`Swordsman ${unitId} joined siege on building ${building.id}`);
            // If already fighting, re-assign combat to include new attacker
            if (existing.phase === SiegePhase.Fighting && existing.activeDefenderId !== null) {
                this.assignAttackersToCombat(existing);
            }
            return existing;
        }

        const siege: SiegeState = {
            buildingId: building.id,
            attackerPlayer,
            phase: SiegePhase.Approaching,
            attackerIds: [unitId],
            activeDefenderId: null,
        };
        this.sieges.set(building.id, siege);
        this.reserveAttacker(unitId);

        this.eventBus.emit('siege:started', {
            buildingId: building.id,
            attackerPlayer,
        });

        log.debug(`Siege started on building ${building.id} by player ${attackerPlayer}`);
        return siege;
    }

    private reserveAttacker(unitId: number): void {
        if (this.unitReservation.isReserved(unitId)) return;
        this.unitReservation.reserve(unitId, {
            purpose: 'siege-attacker',
            onForcedRelease: id => {
                log.debug(`Siege attacker ${id} removed externally, reservation auto-released`);
            },
        });
    }

    // ── Siege advancement ──────────────────────────

    /**
     * Advance the siege to the next phase. Called when:
     * - An attacker arrives at the door (Approaching → Fighting or Capturing)
     * - A defender dies (Fighting → eject next or Capturing)
     */
    private advanceSiege(buildingId: number, siege: SiegeState): void {
        const garrison = this.garrisonManager.getGarrison(buildingId);
        if (!garrison) {
            // Building is no longer a garrison building — cancel
            this.sieges.delete(buildingId);
            return;
        }

        const garrisonedIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];

        if (garrisonedIds.length === 0) {
            // No defenders remain — capture
            this.captureBuilding(buildingId, siege);
            return;
        }

        // Eject the next defender
        const nextDefenderId = garrisonedIds[0]!;
        this.garrisonManager.ejectUnit(nextDefenderId, buildingId);

        siege.activeDefenderId = nextDefenderId;
        siege.phase = SiegePhase.Fighting;

        this.eventBus.emit('siege:defenderEjected', {
            buildingId,
            defenderId: nextDefenderId,
        });

        log.debug(`Defender ${nextDefenderId} ejected from building ${buildingId}`);

        // Assign attackers to fight the ejected defender
        this.assignAttackersToCombat(siege);
    }

    // ── Combat assignment ──────────────────────────

    /**
     * Force-assign up to MAX_ACTIVE_ATTACKERS to fight the active defender.
     * Releases them from any current combat first, then directly sets their
     * CombatState to Fighting with targetId = defender.
     */
    private assignAttackersToCombat(siege: SiegeState): void {
        if (siege.activeDefenderId === null) return;

        const defenderId = siege.activeDefenderId;
        const defenderState = this.combatSystem.getState(defenderId);

        // Ensure defender is registered in combat system (it was just ejected from garrison)
        // The defender should already be registered from entity creation; if not, it's a bug
        // but we handle gracefully in tick systems
        if (!defenderState) {
            log.error(`Defender ${defenderId} not registered in combat system during siege on ${siege.buildingId}`);
            return;
        }

        // Set defender to fight the first attacker
        const firstAttackerId = siege.attackerIds[0];
        if (firstAttackerId === undefined) return;

        defenderState.status = CombatStatus.Fighting;
        defenderState.targetId = firstAttackerId;
        defenderState.attackTimer = 0;

        // Assign up to MAX_ACTIVE_ATTACKERS
        const activeCount = Math.min(siege.attackerIds.length, MAX_ACTIVE_ATTACKERS);
        for (let i = 0; i < activeCount; i++) {
            const attackerId = siege.attackerIds[i]!;
            this.combatSystem.releaseFromCombat(attackerId);

            const attackerState = this.combatSystem.getState(attackerId);
            if (!attackerState) {
                log.error(`Attacker ${attackerId} not registered in combat system during siege on ${siege.buildingId}`);
                continue;
            }

            attackerState.status = CombatStatus.Fighting;
            attackerState.targetId = defenderId;
            attackerState.attackTimer = 0;
        }
    }

    // ── Capture ──────────────────────────

    private captureBuilding(buildingId: number, siege: SiegeState): void {
        siege.phase = SiegePhase.Capturing;

        const building = this.gameState.getEntityOrThrow(buildingId, 'BuildingSiegeSystem.captureBuilding');
        const oldPlayer = building.player;
        const newPlayer = siege.attackerPlayer;

        // Release all attackers from combat and reservations
        for (const attackerId of siege.attackerIds) {
            this.combatSystem.releaseFromCombat(attackerId);
            this.unitReservation.release(attackerId);
        }

        // Execute capture command (changes ownership via gameState.changeEntityOwner)
        this.executeCommand({
            type: 'capture_building',
            buildingId,
            newPlayer,
        } as Command);

        // Re-initialize garrison for new owner
        const buildingType = building.subType as BuildingType;
        this.garrisonManager.removeTower(buildingId);
        this.garrisonManager.initTower(buildingId, buildingType);

        // Garrison the first attacker into the captured building.
        // Reserve → assign as worker → dispatch via WORKER_DISPATCH.
        // The unit is at the door, so the choreo completes near-instantly
        // and settler-location:entered triggers garrison finalization.
        const capturingUnitId = siege.attackerIds[0];
        if (capturingUnitId !== undefined) {
            const capturingUnit = this.gameState.getEntity(capturingUnitId);
            if (capturingUnit) {
                this.unitReservation.reserve(capturingUnitId, {
                    purpose: 'garrison-en-route',
                    onForcedRelease: () => {},
                });
                this.settlerTaskSystem.assignWorkerToBuilding(
                    capturingUnitId, buildingId
                );
                const job = choreo('WORKER_DISPATCH')
                    .goToDoorAndEnter(buildingId)
                    .build();
                this.settlerTaskSystem.assignJob(
                    capturingUnitId, job, job.targetPos!
                );
            }
        }

        this.eventBus.emit('siege:buildingCaptured', {
            buildingId,
            oldPlayer,
            newPlayer,
        });

        log.debug(`Building ${buildingId} captured by player ${newPlayer} (was player ${oldPlayer})`);

        // Clean up siege state
        this.sieges.delete(buildingId);
    }

    // ── Helpers ──────────────────────────

    /** Check if any attacker is within door arrival distance of the building. */
    private hasAttackerAtDoor(
        siege: SiegeState,
        building: { x: number; y: number; race: Race; subType: number }
    ): boolean {
        const door = getBuildingDoorPos(
            building.x, building.y, building.race, building.subType as BuildingType
        );

        for (const attackerId of siege.attackerIds) {
            const attacker = this.gameState.getEntity(attackerId);
            if (!attacker) continue;
            const dist = Math.max(Math.abs(attacker.x - door.x), Math.abs(attacker.y - door.y));
            if (dist <= DOOR_ARRIVAL_DISTANCE) return true;
        }
        return false;
    }

    /** Remove an attacker from any siege they're part of. Cancels siege if no attackers remain. */
    private removeAttacker(entityId: number): void {
        for (const [buildingId, siege] of this.sieges) {
            const idx = siege.attackerIds.indexOf(entityId);
            if (idx === -1) continue;

            siege.attackerIds.splice(idx, 1);
            this.unitReservation.release(entityId);

            if (siege.attackerIds.length === 0) {
                this.sieges.delete(buildingId);
                log.debug(`Siege on building ${buildingId} cancelled — last attacker ${entityId} removed`);
                return;
            }

            // If we lost an active attacker during fighting, re-assign combat
            if (siege.phase === SiegePhase.Fighting && siege.activeDefenderId !== null) {
                this.assignAttackersToCombat(siege);
            }
            return;
        }
    }

    /** Returns true if the given UnitType is a swordsman (any level). */
    private isSwordsman(unitType: UnitType): boolean {
        return getBaseUnitType(unitType) === UnitType.Swordsman1;
    }

    /** Returns true if the unit is already part of any active siege. */
    private isInAnySiege(unitId: number): boolean {
        for (const siege of this.sieges.values()) {
            if (siege.attackerIds.includes(unitId)) return true;
        }
        return false;
    }

    // ── Idle swordsman scan ──────────────────────────

    /**
     * Scan enemy garrison buildings for nearby idle swordsmen that should
     * auto-attack. Covers cases where swordsmen become idle without
     * triggering unit:movementStopped (e.g., after winning a combat).
     */
    private scanIdleSwordsmen(): void {
        const buildings = this.gameState.entityIndex.idsOfType(EntityType.Building);

        for (const buildingId of buildings) {
            const building = this.gameState.getEntity(buildingId);
            if (!building) continue;
            if (!isGarrisonBuildingType(building.subType as BuildingType)) continue;
            this.scanNearbyIdleSwordsmen(building);
        }
    }

    private scanNearbyIdleSwordsmen(building: Entity): void {
        const nearby = this.gameState.getEntitiesInRadius(building.x, building.y, IDLE_SCAN_RADIUS);
        for (const unit of nearby) {
            if (!this.isIdleEnemySwordsman(unit, building.player)) continue;

            try {
                this.tryBeginOrJoinSiege(unit.id, unit);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Error in idle scan for swordsman ${unit.id}`, err);
            }
        }
    }

    private isIdleEnemySwordsman(unit: Entity, buildingPlayer: number): boolean {
        return (
            unit.type === EntityType.Unit &&
            unit.player !== buildingPlayer &&
            this.isSwordsman(unit.subType as UnitType) &&
            !this.combatSystem.isInCombat(unit.id) &&
            !this.isInAnySiege(unit.id) &&
            !this.unitReservation.isReserved(unit.id)
        );
    }
}
