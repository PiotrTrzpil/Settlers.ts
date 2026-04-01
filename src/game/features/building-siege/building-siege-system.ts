/**
 * Building Siege System — manages defender ejection at garrison buildings.
 *
 * Simplified design: attackers are NOT tracked or reserved. They are free units
 * whose combat is handled entirely by CombatSystem. The siege system only:
 * 1. Ejects defenders one at a time when enemy swordsmen reach the door
 * 2. When the garrison is empty, dispatches the closest attacker via garrisoning code
 *
 * Ownership change is handled by the garrison feature — when an enemy unit enters
 * a garrison building, it detects the player mismatch and changes ownership.
 *
 * This means the player can freely move attackers away (normal move commands),
 * and the combat system naturally assigns targets between attackers, defenders,
 * and any field enemies.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import { dispatchUnitToGarrison } from '../tower-garrison/internal/garrison-dispatch';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import {
    type BuildingSiegeSystemConfig,
    type SiegeState,
    type DoorDefenderNotifier,
    TICK_CHECK_INTERVAL,
    DOOR_ARRIVAL_DISTANCE,
    BUILDING_SEARCH_RADIUS,
    MAX_DOOR_ATTACKERS,
} from './siege-types';
import {
    isSwordsman,
    findNearbyEnemyGarrison,
    findSwordsmanAtDoor,
    hasEnemyAtDoor,
    findUnitsAttacking,
} from './siege-helpers';

export { type SiegeState, type BuildingSiegeSystemConfig } from './siege-types';

const log = createLogger('BuildingSiegeSystem');

export class BuildingSiegeSystem implements TickSystem {
    private readonly sieges = new Map<number, SiegeState>();
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly garrisonManager: TowerGarrisonManager;
    private readonly combatSystem: CombatSystem;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly doorDefenderNotifier: DoorDefenderNotifier;

    private tickCounter = 0;

    constructor(cfg: BuildingSiegeSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.garrisonManager = cfg.garrisonManager;
        this.combatSystem = cfg.combatSystem;
        this.unitReservation = cfg.unitReservation;
        this.settlerTaskSystem = cfg.settlerTaskSystem;
        this.doorDefenderNotifier = cfg.doorDefenderNotifier;
    }

    // ── Public API ──────────────────────────

    getSiege(buildingId: number): Readonly<SiegeState> | undefined {
        return this.sieges.get(buildingId);
    }

    /** Remove a siege and notify the tower combat system to stop throwing stones. */
    private removeSiege(buildingId: number): void {
        this.sieges.delete(buildingId);
        this.doorDefenderNotifier.clearDoorDefender(buildingId);
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

    /** Cancel siege when the building is destroyed. */
    cancelSiege(buildingId: number): void {
        const siege = this.sieges.get(buildingId);
        if (!siege) {
            return;
        }
        if (siege.activeDefenderId !== null) {
            this.unitReservation.release(siege.activeDefenderId);
        }
        this.removeSiege(buildingId);
        log.debug(`Siege on building ${buildingId} cancelled`);
    }

    /** Clean up if a siege-related entity is removed. */
    onEntityRemoved(entityId: number): void {
        for (const [buildingId, siege] of this.sieges) {
            if (siege.activeDefenderId === entityId) {
                siege.activeDefenderId = null;
                siege.doorAttackerIds = [];
                this.advanceSiege(buildingId, siege);
                return;
            }
            // Remove dead attacker from door slots
            const idx = siege.doorAttackerIds.indexOf(entityId);
            if (idx !== -1) {
                siege.doorAttackerIds.splice(idx, 1);
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
            this.removeSiege(buildingId);
            return;
        }

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
            this.removeSiege(buildingId);
            log.debug(`Siege on ${buildingId} cancelled — no attackers at door`);
            return;
        }
        // Enforce max door attacker limit
        if (siege.activeDefenderId !== null) {
            this.enforceDoorAttackerLimit(siege);
        }
    }

    // ── Door attacker enforcement ──────────────────────────

    /**
     * Enforce MAX_DOOR_ATTACKERS: only the first N enemies actively fighting the
     * door defender are allowed to continue. Excess units are released from combat
     * so they stand by until a slot opens.
     */
    private enforceDoorAttackerLimit(siege: SiegeState): void {
        const defenderId = siege.activeDefenderId!;
        const allFighting = findUnitsAttacking(defenderId, this.gameState, this.combatSystem);

        // Keep existing tracked attackers that are still fighting, then fill remaining slots
        const stillValid = siege.doorAttackerIds.filter(id => allFighting.includes(id));
        for (const id of allFighting) {
            if (stillValid.length >= MAX_DOOR_ATTACKERS) {
                break;
            }
            if (!stillValid.includes(id)) {
                stillValid.push(id);
            }
        }
        siege.doorAttackerIds = stillValid;

        // Release any excess fighters not in the allowed list
        for (const id of allFighting) {
            if (!siege.doorAttackerIds.includes(id)) {
                this.combatSystem.releaseFromCombat(id);
                log.debug(`Released excess attacker ${id} from door combat at building ${siege.buildingId}`);
            }
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

        // Attackers must stand adjacent to the door (distance 1), not on it
        if (doorDist === 0 || doorDist > DOOR_ARRIVAL_DISTANCE) {
            if (!this.combatSystem.isInCombat(unit.id)) {
                const tile = this.garrisonManager.getApproachTile(target);
                this.settlerTaskSystem.assignMoveTask(unit.id, tile.x, tile.y);
            }
            return;
        }

        // Adjacent to door — start siege
        this.startSiege(target);
    }

    private startSiege(building: Entity): void {
        const siege: SiegeState = {
            buildingId: building.id,
            activeDefenderId: null,
            doorAttackerIds: [],
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
            this.removeSiege(buildingId);
            return;
        }

        const garrisonedIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];

        if (garrisonedIds.length === 0) {
            this.dispatchCapturer(buildingId);
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
        this.doorDefenderNotifier.setDoorDefender(buildingId, nextDefenderId);

        this.eventBus.emit('siege:defenderEjected', {
            buildingId,
            unitId: nextDefenderId,
            level: 'info',
        });

        log.debug(`Defender ${nextDefenderId} ejected from building ${buildingId}`);
    }

    // ── Post-siege capture dispatch ──────────────────────────

    /**
     * All defenders dead — dispatch the closest attacker to enter the building
     * via garrisoning code, then remove the siege. Ownership change is handled
     * by the garrison feature when it detects an enemy unit entering.
     */
    private dispatchCapturer(buildingId: number): void {
        const building = this.gameState.getEntityOrThrow(buildingId, 'dispatchCapturer');
        const capturer = findSwordsmanAtDoor(building, this.gameState, id => this.unitReservation.isReserved(id));
        if (!capturer) {
            log.debug(`dispatchCapturer: no swordsman at door for building ${buildingId}`);
            this.removeSiege(buildingId);
            return;
        }

        // Release from combat so the dispatch can assign a choreo job
        this.combatSystem.releaseFromCombat(capturer.id);

        // Siege is done — garrisoning code handles the rest
        this.removeSiege(buildingId);

        dispatchUnitToGarrison(capturer.id, buildingId, {
            gameState: this.gameState,
            unitReservation: this.unitReservation,
            settlerTaskSystem: this.settlerTaskSystem,
        });
    }
}
