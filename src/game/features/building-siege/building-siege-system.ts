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
import { EntityType, UnitType, BuildingType, type Entity, type Tile, tileKey } from '../../entity';
import { isDarkTribe } from '../../core/race';
import { hexDistanceTo } from '../../systems/hex-directions';
import { dispatchUnitToGarrison } from '../tower-garrison/internal/garrison-dispatch';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { sortedEntries } from '@/utilities/collections';
import { createLogger } from '@/utilities/logger';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { CombatSystem } from '../combat/combat-system';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { TowerAssaultSystem } from './tower-assault-system';
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
    findDoorAdjacentTiles,
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

    /** Tower assault system for Dark Tribe direct-destruction attacks. Set after construction. */
    private towerAssaultSystem: TowerAssaultSystem | null = null;

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

    /** Wire the tower assault system so Dark Tribe units are routed to it instead of sieging. */
    setTowerAssaultSystem(system: TowerAssaultSystem): void {
        this.towerAssaultSystem = system;
    }

    // ── Public API ──────────────────────────

    getSiege(buildingId: number): Readonly<SiegeState> | undefined {
        return this.sieges.get(buildingId);
    }

    /**
     * Returns true if an enemy garrison door is strictly closer than `enemyDist`
     * to the given unit. Used by the combat system's engagement filter to let
     * swordsmen prefer a nearby door over a farther enemy unit.
     */
    hasDoorCloserThan(entityId: number, enemyDist: number): boolean {
        const unit = this.gameState.getEntity(entityId);
        if (!unit || !isSwordsman(unit.subType as UnitType)) {
            return false;
        }
        if (this.unitReservation.isReserved(entityId)) {
            return false;
        }
        const target = findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS, this.gameState);
        if (!target) {
            return false;
        }
        const door = getBuildingDoorPos(target, target.race, target.subType as BuildingType);
        return hexDistanceTo(unit, door) < enemyDist;
    }

    /** Remove a siege, release all participants, and notify tower combat to stop throwing stones. */
    private removeSiege(buildingId: number): void {
        const siege = this.sieges.get(buildingId);
        if (siege) {
            if (siege.activeDefenderId !== null) {
                this.releaseSiegeUnit(siege.activeDefenderId);
            }
            for (const id of siege.doorAttackerIds) {
                this.releaseSiegeUnit(id);
            }
        }
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

    /** Called when a unit is defeated — advance siege or reassign targets. */
    onUnitDefeated(entityId: number, defeatedBy: number): void {
        try {
            for (const [buildingId, siege] of this.sieges) {
                // Defender killed → eject next
                if (siege.activeDefenderId === entityId) {
                    siege.activeDefenderId = null;
                    this.unitReservation.release(entityId);
                    for (const id of siege.doorAttackerIds) {
                        this.releaseSiegeUnit(id);
                    }
                    siege.doorAttackerIds = [];
                    this.advanceSiege(buildingId, siege);
                    return;
                }
                // Door attacker killed → reassign defender's target
                const idx = siege.doorAttackerIds.indexOf(entityId);
                if (idx !== -1) {
                    siege.doorAttackerIds.splice(idx, 1);
                    if (siege.activeDefenderId !== null && siege.doorAttackerIds.length > 0) {
                        this.combatSystem.lockTarget(
                            siege.activeDefenderId,
                            siege.doorAttackerIds[0]!,
                            'siege-defender'
                        );
                    }
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
        if (!this.sieges.has(buildingId)) {
            return;
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
            this.removeSiege(buildingId);
            log.debug(`Siege on ${buildingId} cancelled — no attackers at door`);
            return;
        }
        // Enforce door combat invariants
        if (siege.activeDefenderId !== null) {
            this.enforceSiegeInvariants(building, siege);
        }
    }

    // ── Door combat invariants ──────────────────────────

    /**
     * Enforce siege positioning invariant: door attacker slots are filled
     * with enemy swordsmen on adjacent tiles. New arrivals are assigned
     * targets immediately — no per-tick target forcing needed because
     * reserved units never self-retarget (combat system skips them).
     */
    private enforceSiegeInvariants(building: Entity, siege: SiegeState): void {
        const adjacentTiles = findDoorAdjacentTiles(building, this.gameState);
        this.fillDoorAttackerSlots(siege, building, adjacentTiles);
    }

    /**
     * Find enemy swordsmen standing on door-adjacent tiles and assign them
     * as door attackers. Reserves them and sets busy so they don't move.
     */
    private fillDoorAttackerSlots(siege: SiegeState, building: Entity, adjacentTiles: Tile[]): void {
        // Remove stale entries (unit gone or no longer on an adjacent tile)
        siege.doorAttackerIds = siege.doorAttackerIds.filter(id => {
            const unit = this.gameState.getEntity(id);
            if (!unit) {
                return false;
            }
            return adjacentTiles.some(t => t.x === unit.x && t.y === unit.y);
        });

        if (siege.doorAttackerIds.length >= MAX_DOOR_ATTACKERS) {
            return;
        }

        // Scan adjacent tiles for enemy swordsmen to fill open slots
        for (const tile of adjacentTiles) {
            if (siege.doorAttackerIds.length >= MAX_DOOR_ATTACKERS) {
                break;
            }
            const occupantId = this.gameState.unitOccupancy.get(tileKey(tile));
            if (occupantId === undefined || siege.doorAttackerIds.includes(occupantId)) {
                continue;
            }
            const unit = this.gameState.getEntity(occupantId);
            if (!unit || unit.type !== EntityType.Unit || unit.hidden) {
                continue;
            }
            if (unit.player === building.player || !isSwordsman(unit.subType as UnitType)) {
                continue;
            }
            // Assign as door attacker: reserve, busy, and lock combat targets
            siege.doorAttackerIds.push(occupantId);
            this.setBusy(occupantId, true);
            if (!this.unitReservation.isReserved(occupantId)) {
                this.unitReservation.reserve(occupantId, {
                    purpose: 'siege-door-attacker',
                    onForcedRelease: () => {},
                });
            }
            this.combatSystem.lockTarget(occupantId, siege.activeDefenderId!, 'siege-door-attacker');

            // If defender has no lock yet, point it at this attacker
            if (!this.combatSystem.isLocked(siege.activeDefenderId!)) {
                this.combatSystem.lockTarget(siege.activeDefenderId!, occupantId, 'siege-defender');
            }

            log.debug(`Attacker ${occupantId} assigned to door at building ${siege.buildingId}`);
        }
    }

    // ── Siege initiation ──────────────────────────

    private tryStartSiege(unit: Entity): void {
        // Dark Tribe cannot siege — they assault towers directly (destroy instead of capture)
        if (isDarkTribe(unit.race)) {
            this.towerAssaultSystem?.tryStartAssault(unit);
            return;
        }

        const target = findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS, this.gameState);
        if (!target) {
            return;
        }

        if (this.sieges.has(target.id)) {
            return;
        }

        const door = getBuildingDoorPos(target, target.race, target.subType as BuildingType);
        const doorDist = hexDistanceTo(unit, door);

        // If field enemies are nearby, only proceed if the door is strictly closer
        const hasThreats = this.combatSystem.hasNearbyThreats(unit.id);
        if (hasThreats) {
            const nearestEnemy = this.combatSystem.findNearestEnemy(unit);
            if (nearestEnemy && hexDistanceTo(unit, nearestEnemy) <= doorDist) {
                return;
            }
        }

        // Attackers must stand adjacent to the door (distance 1), not on it
        if (doorDist === 0 || doorDist > DOOR_ARRIVAL_DISTANCE) {
            if (!this.combatSystem.isInCombat(unit.id)) {
                const tile = this.garrisonManager.getApproachTile(target);
                this.settlerTaskSystem.assignMoveTask(unit.id, tile);
                if (hasThreats) {
                    // Mark passive so the combat system won't divert to farther enemies en route
                    this.combatSystem.setPassive(unit.id);
                }
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
        this.setBusy(nextDefenderId, true);
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

    // ── Helpers ──────────────────────────

    /** Set or clear the movement controller's busy flag to prevent/allow bumping. */
    private setBusy(entityId: number, busy: boolean): void {
        const controller = this.gameState.movement.getController(entityId);
        if (controller) {
            controller.busy = busy;
        }
    }

    /** Release a siege participant: clear busy, unlock, release from combat and reservation. */
    private releaseSiegeUnit(id: number): void {
        this.setBusy(id, false);
        this.combatSystem.unlockTarget(id);
        if (this.combatSystem.isInCombat(id)) {
            this.combatSystem.releaseFromCombat(id);
        }
        if (this.unitReservation.isReserved(id)) {
            this.unitReservation.release(id);
        }
    }
}
