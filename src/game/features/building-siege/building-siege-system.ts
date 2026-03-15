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
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import { CombatStatus } from '../combat/combat-state';
import { isGarrisonBuildingType } from '../tower-garrison';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { Command, CommandResult } from '../../commands';
import {
    type BuildingSiegeSystemConfig,
    type SiegeState,
    SiegePhase,
    TICK_CHECK_INTERVAL,
    MAX_ACTIVE_ATTACKERS,
    MAX_SIEGE_ATTACKERS,
    DOOR_ARRIVAL_DISTANCE,
    BUILDING_SEARCH_RADIUS,
    IDLE_SCAN_RADIUS,
} from './siege-types';
import {
    isSwordsman,
    isInAnySiege,
    hasAttackerAtDoor,
    findNearbyEnemyGarrison,
    isIdleEnemySwordsman,
} from './siege-helpers';

export { SiegePhase, type SiegeState, type BuildingSiegeSystemConfig } from './siege-types';

const log = createLogger('BuildingSiegeSystem');

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
            const unit = this.gameState.getEntityOrThrow(entityId, 'unit that stopped moving');
            if (unit.type !== EntityType.Unit) {
                return;
            }
            if (!isSwordsman(unit.subType as UnitType)) {
                return;
            }
            // Skip units already committed to another task (e.g., en-route to friendly garrison)
            // but allow units in a siege (they're reserved by us)
            if (this.unitReservation.isReserved(entityId) && !isInAnySiege(entityId, this.sieges)) {
                return;
            }

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
                    this.unitReservation.release(entityId);
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
        if (!siege) {
            return;
        }

        // Release defender reservation
        if (siege.activeDefenderId !== null) {
            this.unitReservation.release(siege.activeDefenderId);
        }

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
        if (this.tickCounter < TICK_CHECK_INTERVAL) {
            return;
        }
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
                if (hasAttackerAtDoor(siege, building, this.gameState)) {
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
        const target = findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS, this.gameState);
        if (!target) {
            return;
        }

        // Create or join siege state first (tracks this attacker, prevents over-commitment)
        const siege = this.getOrCreateSiege(unitId, target, unit.player);
        if (!siege) {
            return;
        } // already at max attackers

        const door = getBuildingDoorPos(target.x, target.y, target.race, target.subType as BuildingType);
        const doorDist = Math.max(Math.abs(unit.x - door.x), Math.abs(unit.y - door.y));

        if (doorDist > DOOR_ARRIVAL_DISTANCE) {
            // Not at door yet — redirect swordsman to a walkable tile near the door
            siege.phase = SiegePhase.Approaching;
            const approachTile = this.garrisonManager.getApproachTile(target);
            this.redirectToDoor(unitId, approachTile);
            return;
        }

        // At door — only advance if no defender is currently fighting.
        // Defenders are ejected one at a time; the next is ejected when the current one dies.
        if (siege.activeDefenderId === null) {
            this.advanceSiege(target.id, siege);
        }
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
            if (existing.attackerIds.includes(unitId)) {
                return existing;
            }
            if (existing.attackerIds.length >= MAX_SIEGE_ATTACKERS) {
                return null;
            }
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
            level: 'info',
        });

        log.debug(`Siege started on building ${building.id} by player ${attackerPlayer}`);
        return siege;
    }

    private reserveAttacker(unitId: number): void {
        if (this.unitReservation.isReserved(unitId)) {
            return;
        }
        this.unitReservation.reserve(unitId, {
            purpose: 'siege-attacker',
            onForcedRelease: id => {
                log.debug(`Siege attacker ${id} removed externally, reservation auto-released`);
            },
        });
    }

    /** Reserve the ejected defender so it stays at the door and doesn't wander. */
    private reserveDefender(unitId: number): void {
        if (this.unitReservation.isReserved(unitId)) {
            return;
        }
        this.unitReservation.reserve(unitId, {
            purpose: 'siege-defender',
            onForcedRelease: id => {
                log.debug(`Siege defender ${id} removed externally, reservation auto-released`);
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

        // Eject the next defender — they stand at the door and fight.
        const nextDefenderId = garrisonedIds[0]!;
        this.garrisonManager.ejectUnit(nextDefenderId, buildingId);
        this.reserveDefender(nextDefenderId);

        siege.activeDefenderId = nextDefenderId;
        siege.phase = SiegePhase.Fighting;

        this.eventBus.emit('siege:defenderEjected', {
            buildingId,
            unitId: nextDefenderId,
            level: 'info',
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
        if (siege.activeDefenderId === null) {
            return;
        }

        const defenderId = siege.activeDefenderId;
        const defenderState = this.combatSystem.getState(defenderId);

        // Ensure defender is registered in combat system (it was just ejected from garrison)
        // The defender should already be registered from entity creation; if not, it's a bug
        // but we handle gracefully in tick systems
        if (!defenderState) {
            log.error(`Defender ${defenderId} not registered in combat system during siege on ${siege.buildingId}`);
            return;
        }

        // Defender is left Idle — the combat system's idle scan will naturally engage
        // adjacent attackers. The defender is reserved (siege-defender) so it won't pursue.

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
        const buildingType = building.subType as BuildingType;

        // Pre-validate: ensure the building supports garrisons before mutating
        // any state. This is a programming error (siege should only target
        // garrison buildings), but catching it here prevents destroying the
        // old garrison with no replacement.
        if (!isGarrisonBuildingType(buildingType)) {
            log.error(`captureBuilding: ${buildingType} has no garrison capacity, aborting`);
            return;
        }

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

        // Re-initialize garrison for new owner.
        // removeTower ejects all garrisoned units; initTower cannot throw here
        // because we pre-validated the building type above.
        this.garrisonManager.removeTower(buildingId);
        this.garrisonManager.initTower(buildingId, buildingType);

        // Garrison the first attacker — best-effort. An empty captured tower
        // is valid state; units will be dispatched normally later.
        this.tryGarrisonCapturingUnit(buildingId, siege);

        this.eventBus.emit('siege:buildingCaptured', {
            buildingId,
            oldPlayer,
            newPlayer,
            level: 'info',
        });

        log.debug(`Building ${buildingId} captured by player ${newPlayer} (was player ${oldPlayer})`);

        // Clean up siege state
        this.sieges.delete(buildingId);
    }

    /**
     * Best-effort: reserve the first attacker and dispatch it into the newly
     * captured tower. If any step fails, partial state is rolled back so the
     * tower is simply left empty (valid — garrison dispatch will fill it later).
     */
    private tryGarrisonCapturingUnit(buildingId: number, siege: SiegeState): void {
        const capturingUnitId = siege.attackerIds[0];
        if (capturingUnitId === undefined) {
            return;
        }

        const capturingUnit = this.gameState.getEntity(capturingUnitId);
        if (!capturingUnit) {
            return;
        }

        this.unitReservation.reserve(capturingUnitId, {
            purpose: 'garrison-en-route',
            onForcedRelease: () => {},
        });

        try {
            this.settlerTaskSystem.assignWorkerToBuilding(capturingUnitId, buildingId);

            const job = choreo('WORKER_DISPATCH').goToDoorAndEnter(buildingId).build();
            const assigned = this.settlerTaskSystem.assignJob(capturingUnitId, job, job.targetPos!);

            if (!assigned) {
                this.settlerTaskSystem.releaseWorkerAssignment(capturingUnitId);
                this.unitReservation.release(capturingUnitId);
                log.warn(
                    `captureBuilding: movement failed for unit ${capturingUnitId}, tower ${buildingId} left empty`
                );
            }
        } catch (e) {
            // Undo whatever partial state was applied
            this.settlerTaskSystem.releaseWorkerAssignment(capturingUnitId);
            this.unitReservation.release(capturingUnitId);
            log.error(`captureBuilding: failed to garrison unit ${capturingUnitId} into ${buildingId}`, e);
        }
    }

    // ── Helpers ──────────────────────────

    /** Remove an attacker from any siege they're part of. Cancels siege if no attackers remain. */
    private removeAttacker(entityId: number): void {
        for (const [buildingId, siege] of this.sieges) {
            const idx = siege.attackerIds.indexOf(entityId);
            if (idx === -1) {
                continue;
            }

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

    // ── Idle swordsman scan ──────────────────────────

    private scanIdleSwordsmen(): void {
        const buildings = this.gameState.entityIndex.idsOfType(EntityType.Building);

        for (const buildingId of buildings) {
            const building = this.gameState.getEntity(buildingId);
            if (!building) {
                continue;
            }
            if (!isGarrisonBuildingType(building.subType as BuildingType)) {
                continue;
            }
            this.scanNearbyIdleSwordsmen(building);
        }
    }

    private scanNearbyIdleSwordsmen(building: Entity): void {
        const nearby = this.gameState.getEntitiesInRadius(building.x, building.y, IDLE_SCAN_RADIUS);
        for (const unit of nearby) {
            if (
                !isIdleEnemySwordsman(
                    unit,
                    building.player,
                    id => this.combatSystem.isInCombat(id),
                    this.sieges,
                    id => this.unitReservation.isReserved(id)
                )
            ) {
                continue;
            }

            try {
                this.tryBeginOrJoinSiege(unit.id, unit);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Error in idle scan for swordsman ${unit.id}`, err);
            }
        }
    }
}
