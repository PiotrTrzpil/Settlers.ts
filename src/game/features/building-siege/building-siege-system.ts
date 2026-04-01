/**
 * Building Siege System — manages defender ejection and building capture.
 *
 * Simplified design: attackers are NOT tracked or reserved. They are free units
 * whose combat is handled entirely by CombatSystem. The siege system only:
 * 1. Ejects defenders one at a time when enemy swordsmen reach the door
 * 2. Dispatches an attacker to enter when the garrison is empty (capture)
 * 3. Changes ownership when the capturing unit enters
 *
 * This means the player can freely move attackers away (normal move commands),
 * and the combat system naturally assigns targets between attackers, defenders,
 * and any field enemies.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import { isGarrisonBuildingType } from '../tower-garrison';
import { dispatchUnitToGarrison } from '../tower-garrison/internal/garrison-dispatch';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { Command, CommandExecutor } from '../../commands';
import {
    type BuildingSiegeSystemConfig,
    type SiegeState,
    SiegePhase,
    TICK_CHECK_INTERVAL,
    DOOR_ARRIVAL_DISTANCE,
    BUILDING_SEARCH_RADIUS,
} from './siege-types';
import { isSwordsman, findNearbyEnemyGarrison, findSwordsmanAtDoor, hasEnemyAtDoor } from './siege-helpers';

export { SiegePhase, type SiegeState, type BuildingSiegeSystemConfig } from './siege-types';

const log = createLogger('BuildingSiegeSystem');

export class BuildingSiegeSystem implements TickSystem {
    private readonly sieges = new Map<number, SiegeState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly garrisonManager: TowerGarrisonManager;
    private readonly combatSystem: CombatSystem;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly executeCommand: CommandExecutor;

    private tickCounter = 0;

    constructor(cfg: BuildingSiegeSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.garrisonManager = cfg.garrisonManager;
        this.combatSystem = cfg.combatSystem;
        this.unitReservation = cfg.unitReservation;
        this.settlerTaskSystem = cfg.settlerTaskSystem;
        this.executeCommand = cfg.executeCommand;
    }

    // ── Public API ──────────────────────────

    getSiege(buildingId: number): Readonly<SiegeState> | undefined {
        return this.sieges.get(buildingId);
    }

    /** Called when a unit stops moving — check if it should trigger a siege. */
    onMovementStopped(entityId: number): void {
        try {
            const unit = this.gameState.getEntityOrThrow(entityId, 'siege:onMovementStopped');
            if (unit.type !== EntityType.Unit || !isSwordsman(unit.subType as UnitType)) {
                return;
            }
            if (this.unitReservation.isReserved(entityId)) {
                return;
            }
            this.tryStartSiege(unit);
        } catch (e) {
            log.error(`Error in onMovementStopped for entity ${entityId}`, e);
        }
    }

    /** Called when a unit is defeated — advance siege if it was the defender. */
    onUnitDefeated(entityId: number, defeatedBy: number): void {
        try {
            for (const [buildingId, siege] of this.sieges) {
                if (siege.activeDefenderId === entityId) {
                    siege.activeDefenderId = null;
                    this.unitReservation.release(entityId);
                    this.advanceSiege(buildingId, siege);
                    return;
                }
            }
        } catch (e) {
            log.error(`Error in onUnitDefeated for entity ${entityId}`, e);
        }

        // The winner may now be idle near an enemy tower
        this.checkSiegeOpportunity(defeatedBy);
    }

    /** Check if a unit should start a siege (e.g. after winning combat). */
    checkSiegeOpportunity(entityId: number): void {
        try {
            const unit = this.gameState.getEntity(entityId);
            if (!unit || unit.type !== EntityType.Unit || !isSwordsman(unit.subType as UnitType)) {
                return;
            }
            if (this.unitReservation.isReserved(entityId) || this.combatSystem.isInCombat(entityId)) {
                return;
            }
            this.tryStartSiege(unit);
        } catch (e) {
            log.error(`Error in checkSiegeOpportunity for entity ${entityId}`, e);
        }
    }

    /** Called when a unit enters a garrison — finalize capture if applicable. */
    onGarrisonUnitEntered(buildingId: number): void {
        const siege = this.sieges.get(buildingId);
        if (!siege || siege.phase !== SiegePhase.Capturing) {
            return;
        }
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            this.sieges.delete(buildingId);
            return;
        }
        this.completeCapture(buildingId, siege, building);
    }

    /** Cancel siege when the building is destroyed. */
    cancelSiege(buildingId: number): void {
        const siege = this.sieges.get(buildingId);
        if (!siege) {
            return;
        }
        if (siege.activeDefenderId !== null) {
            this.unitReservation.release(siege.activeDefenderId);
        }
        this.sieges.delete(buildingId);
        log.debug(`Siege on building ${buildingId} cancelled`);
    }

    /** Clean up if a siege-related entity is removed. */
    onEntityRemoved(entityId: number): void {
        for (const [buildingId, siege] of this.sieges) {
            if (siege.activeDefenderId === entityId) {
                siege.activeDefenderId = null;
                this.advanceSiege(buildingId, siege);
                return;
            }
            if (siege.capturingUnitId === entityId) {
                this.sieges.delete(buildingId);
                log.debug(`Siege on ${buildingId} cancelled — capturing unit removed`);
                return;
            }
        }
    }

    // ── TickSystem ──────────────────────────

    tick(_dt: number): void {
        this.tickCounter++;
        if (this.tickCounter < TICK_CHECK_INTERVAL) {
            return;
        }
        this.tickCounter = 0;

        for (const [buildingId, siege] of sortedEntries(this.sieges)) {
            try {
                this.tickSiege(buildingId, siege);
            } catch (e) {
                log.error(`Error in siege tick for building ${buildingId}`, e);
            }
        }

        // Periodic scan: idle swordsmen near enemy towers auto-start siege
        this.scanIdleSwordsmen();
    }

    // ── Idle swordsman scan ──────────────────────────

    /** Check idle, unreserved swordsmen for siege opportunities. */
    private scanIdleSwordsmen(): void {
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Unit || entity.hidden) {
                continue;
            }
            if (!isSwordsman(entity.subType as UnitType)) {
                continue;
            }
            if (this.unitReservation.isReserved(entity.id) || this.combatSystem.isInCombat(entity.id)) {
                continue;
            }
            // Only truly idle units (not moving)
            const controller = this.gameState.movement.getController(entity.id);
            if (controller && controller.state !== 'idle') {
                continue;
            }
            this.tryStartSiege(entity);
        }
    }

    // ── Tick validation ──────────────────────────

    private tickSiege(buildingId: number, siege: SiegeState): void {
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            this.sieges.delete(buildingId);
            return;
        }

        switch (siege.phase) {
            case SiegePhase.Fighting:
                // Validate defender still exists
                if (siege.activeDefenderId !== null && !this.gameState.getEntity(siege.activeDefenderId)) {
                    siege.activeDefenderId = null;
                    this.advanceSiege(buildingId, siege);
                    return;
                }
                // Cancel siege if all attackers left the door area
                if (!hasEnemyAtDoor(building, this.gameState)) {
                    if (siege.activeDefenderId !== null) {
                        this.unitReservation.release(siege.activeDefenderId);
                    }
                    this.sieges.delete(buildingId);
                    log.debug(`Siege on ${buildingId} cancelled — no attackers at door`);
                }
                break;

            case SiegePhase.Capturing:
                if (siege.capturingUnitId !== null && !this.gameState.getEntity(siege.capturingUnitId)) {
                    this.sieges.delete(buildingId);
                    log.debug(`Siege on ${buildingId} cancelled — capturing unit lost`);
                }
                break;
        }
    }

    // ── Siege initiation ──────────────────────────

    private tryStartSiege(unit: Entity): void {
        // Don't eject defenders while there are visible enemy units nearby —
        // let the combat system handle field enemies first.
        if (this.combatSystem.hasNearbyThreats(unit.id)) {
            return;
        }

        const target = findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS, this.gameState);
        if (!target) {
            return;
        }

        if (this.sieges.has(target.id)) {
            return;
        }

        const door = getBuildingDoorPos(target.x, target.y, target.race, target.subType as BuildingType);
        const doorDist = Math.max(Math.abs(unit.x - door.x), Math.abs(unit.y - door.y));

        if (doorDist > DOOR_ARRIVAL_DISTANCE) {
            // Not at door yet — redirect (only if not already in combat)
            if (!this.combatSystem.isInCombat(unit.id)) {
                const approachTile = this.garrisonManager.getApproachTile(target);
                this.settlerTaskSystem.assignMoveTask(unit.id, approachTile.x, approachTile.y);
            }
            return;
        }

        // At door — start siege
        this.startSiege(target);
    }

    private startSiege(building: Entity): void {
        const siege: SiegeState = {
            buildingId: building.id,
            phase: SiegePhase.Fighting,
            activeDefenderId: null,
            capturingUnitId: null,
        };
        this.sieges.set(building.id, siege);

        this.eventBus.emit('siege:started', {
            buildingId: building.id,
            level: 'info',
        });

        log.debug(`Siege started on building ${building.id}`);
        this.advanceSiege(building.id, siege);
    }

    // ── Siege advancement ──────────────────────────

    private advanceSiege(buildingId: number, siege: SiegeState): void {
        const garrison = this.garrisonManager.getGarrison(buildingId);
        if (!garrison) {
            this.sieges.delete(buildingId);
            return;
        }

        const garrisonedIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];

        if (garrisonedIds.length === 0) {
            this.beginCapture(buildingId, siege);
            return;
        }

        // Eject next defender — combat system will handle the fighting
        const nextDefenderId = garrisonedIds[0]!;
        this.garrisonManager.ejectUnit(nextDefenderId, buildingId);

        // Reserve defender so it stays at the door (fights adjacent enemies but doesn't pursue)
        if (!this.unitReservation.isReserved(nextDefenderId)) {
            this.unitReservation.reserve(nextDefenderId, {
                purpose: 'siege-defender',
                onForcedRelease: () => {},
            });
        }

        siege.activeDefenderId = nextDefenderId;
        siege.phase = SiegePhase.Fighting;

        this.eventBus.emit('siege:defenderEjected', {
            buildingId,
            unitId: nextDefenderId,
            level: 'info',
        });

        log.debug(`Defender ${nextDefenderId} ejected from building ${buildingId}`);
    }

    // ── Capture ──────────────────────────

    private beginCapture(buildingId: number, siege: SiegeState): void {
        siege.phase = SiegePhase.Capturing;

        const building = this.gameState.getEntityOrThrow(buildingId, 'beginCapture');
        if (!isGarrisonBuildingType(building.subType as BuildingType)) {
            log.error(`beginCapture: ${building.subType} has no garrison capacity`);
            this.sieges.delete(buildingId);
            return;
        }

        // Find any available swordsman at the door
        const capturer = findSwordsmanAtDoor(building, this.gameState, id => this.unitReservation.isReserved(id));
        if (!capturer) {
            log.debug(`beginCapture: no swordsman at door for building ${buildingId}`);
            this.sieges.delete(buildingId);
            return;
        }

        siege.capturingUnitId = capturer.id;

        // Release from combat so the dispatch can assign a choreo job
        this.combatSystem.releaseFromCombat(capturer.id);

        const dispatched = dispatchUnitToGarrison(capturer.id, buildingId, {
            gameState: this.gameState,
            unitReservation: this.unitReservation,
            settlerTaskSystem: this.settlerTaskSystem,
        });

        if (!dispatched) {
            log.warn(`beginCapture: dispatch failed for unit ${capturer.id}`);
            this.sieges.delete(buildingId);
        }
    }

    private completeCapture(buildingId: number, siege: SiegeState, building: Entity): void {
        const oldPlayer = building.player;

        // Determine new owner from the unit that entered
        const capturer = siege.capturingUnitId !== null ? this.gameState.getEntity(siege.capturingUnitId) : null;
        const newPlayer = capturer?.player ?? oldPlayer;
        if (newPlayer === oldPlayer) {
            this.sieges.delete(buildingId);
            return;
        }

        this.executeCommand({
            type: 'capture_building',
            buildingId,
            newPlayer,
        } as Command);

        this.eventBus.emit('siege:buildingCaptured', {
            buildingId,
            oldPlayer,
            newPlayer,
            level: 'info',
        });

        log.debug(`Building ${buildingId} captured by player ${newPlayer} (was player ${oldPlayer})`);
        this.sieges.delete(buildingId);
    }
}
