/**
 * Tower Assault System — Dark Tribe direct tower destruction.
 *
 * Dark Tribe units cannot siege towers (eject-and-capture). Instead, their
 * swordsmen surround the tower and attack the structure directly, dealing
 * damage over time. When a tower's health reaches 0 it is destroyed outright.
 *
 * Attackers are NOT reserved — they freely engage nearby enemies via the
 * normal combat system. Only idle swordsmen adjacent to the building deal
 * structural damage each tick. This creates fluid behavior: fight enemies
 * when they appear, resume hitting the building when idle.
 *
 * Uses the general-purpose BuildingHealthTracker for HP management.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { Entity, Tile } from '../../entity';
import { UnitType, BuildingType, tileKey } from '../../entity';
import { isDarkTribe } from '../../core/race';
import { getCombatStats } from '../combat/combat-state';
import { hexDistanceTo } from '../../systems/hex-directions';
import { isIdleSwordsman, findNearbyEnemyGarrison, getBuildingPerimeterTiles } from './siege-helpers';
import { BUILDING_SEARCH_RADIUS } from './siege-types';
import { BuildingHealthTracker, getBuildingMaxHealth } from '../../systems/building-health';
import type { CombatSystem } from '../combat/combat-system';
import type { SettlerTaskSystem } from '../settler-tasks';
import type { TowerGarrisonManager } from '../tower-garrison/tower-garrison-manager';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { CommandExecutor } from '../../commands';
import { createLogger } from '@/utilities/logger';
import { sortedEntries } from '@/utilities/collections';

const log = createLogger('TowerAssaultSystem');

/** How often (in ticks) the system scans for new assault opportunities. */
const SCAN_INTERVAL = 10;

/** Per-building assault state (health lives in BuildingHealthTracker). */
interface AssaultState {
    readonly buildingId: number;
}

export interface TowerAssaultSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    combatSystem: CombatSystem;
    unitReservation: UnitReservationRegistry;
    settlerTaskSystem: SettlerTaskSystem;
    garrisonManager: TowerGarrisonManager;
    executeCommand: CommandExecutor;
}

export class TowerAssaultSystem implements TickSystem {
    private readonly assaults = new Map<number, AssaultState>();
    readonly healthTracker = new BuildingHealthTracker();

    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly combatSystem: CombatSystem;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly garrisonManager: TowerGarrisonManager;
    private readonly executeCommand: CommandExecutor;

    private tickCounter = 0;

    constructor(cfg: TowerAssaultSystemConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.combatSystem = cfg.combatSystem;
        this.unitReservation = cfg.unitReservation;
        this.settlerTaskSystem = cfg.settlerTaskSystem;
        this.garrisonManager = cfg.garrisonManager;
        this.executeCommand = cfg.executeCommand;

        this.healthTracker.onDestroyed = (buildingId: number) => {
            this.destroyBuilding(buildingId);
        };
    }

    // ── Public API ──────────────────────────

    getAssault(buildingId: number): Readonly<AssaultState> | undefined {
        return this.assaults.get(buildingId);
    }

    /**
     * Check if a Dark Tribe swordsman should assault a nearby tower.
     * Moves idle units toward the building perimeter. Does NOT reserve them —
     * the combat system can freely pull them into fights en route.
     */
    tryStartAssault(unit: Entity): boolean {
        if (!isDarkTribe(unit.race)) {
            return false;
        }
        const target = this.findAssaultTarget(unit);
        if (!target) {
            return false;
        }

        this.ensureAssault(target);

        if (!this.isAdjacentToBuilding(unit, target)) {
            if (!this.combatSystem.isInCombat(unit.id)) {
                const tile = this.findNearestPerimeterTile(unit, target);
                if (tile) {
                    this.settlerTaskSystem.assignMoveTask(unit.id, tile);
                }
            }
        }
        return true;
    }

    /** Cancel assault when the building is destroyed or removed externally. */
    cancelAssault(buildingId: number): void {
        this.assaults.delete(buildingId);
        this.healthTracker.removeBuilding(buildingId);
    }

    // ── TickSystem ──────────────────────────

    tick(dt: number): void {
        this.tickCounter++;

        for (const [buildingId] of sortedEntries(this.assaults)) {
            this.tickAssault(buildingId, dt);
        }

        if (this.tickCounter >= SCAN_INTERVAL) {
            this.tickCounter = 0;
            this.scanDarkTribeSwordsmen();
        }
    }

    // ── Tick logic ──────────────────────────

    private tickAssault(buildingId: number, dt: number): void {
        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            this.cancelAssault(buildingId);
            return;
        }

        // Find idle dark tribe swordsmen adjacent to the building — only they deal damage
        const attackers = this.findIdleAttackersAtPerimeter(building);

        if (attackers.length === 0) {
            return;
        }

        let totalDamage = 0;
        for (const attacker of attackers) {
            const stats = getCombatStats(attacker.subType as UnitType);
            totalDamage += (stats.attackPower * dt) / stats.attackCooldown;
        }

        this.healthTracker.applyDamage(buildingId, totalDamage);
    }

    /** Find dark tribe swordsmen at the building perimeter that are idle (not fighting, not moving). */
    private findIdleAttackersAtPerimeter(building: Entity): Entity[] {
        const perimeter = getBuildingPerimeterTiles(building, this.gameState);
        const attackers: Entity[] = [];

        for (const tile of perimeter) {
            const occupantId = this.gameState.unitOccupancy.get(tileKey(tile));
            if (occupantId === undefined) {
                continue;
            }
            const unit = this.gameState.getEntity(occupantId);
            if (!unit || unit.player === building.player || !isDarkTribe(unit.race)) {
                continue;
            }
            if (!isIdleSwordsman(unit, this.unitReservation, this.combatSystem, this.gameState)) {
                continue;
            }
            attackers.push(unit);
        }
        return attackers;
    }

    private destroyBuilding(buildingId: number): void {
        log.info(`Tower ${buildingId} destroyed by Dark Tribe assault`);

        const building = this.gameState.getEntityOrThrow(buildingId, 'towerAssault:destroyBuilding');
        this.assaults.delete(buildingId);

        // Kill garrisoned units — they die with the building
        const garrison = this.garrisonManager.getGarrison(buildingId);
        if (garrison) {
            const garrisonedIds = [...garrison.swordsmanSlots.unitIds, ...garrison.bowmanSlots.unitIds];
            for (const unitId of garrisonedIds) {
                this.garrisonManager.ejectUnit(unitId, buildingId);
                this.eventBus.emit('combat:unitDefeated', { unitId, defeatedBy: -1, level: 'info' });
                this.executeCommand({ type: 'remove_entity', entityId: unitId });
            }
        }

        this.eventBus.emit('building:removed', {
            buildingId,
            buildingType: building.subType as BuildingType,
        });
        this.executeCommand({ type: 'remove_entity', entityId: buildingId });
    }

    // ── Building perimeter ──────────────────────────

    /** Check if a unit is on a tile adjacent to the building's footprint. */
    private isAdjacentToBuilding(unit: Tile, building: Entity): boolean {
        const perimeter = getBuildingPerimeterTiles(building, this.gameState);
        return perimeter.some(t => t.x === unit.x && t.y === unit.y);
    }

    /** Find the closest walkable perimeter tile to a unit. */
    private findNearestPerimeterTile(unit: Entity, building: Entity): Tile | undefined {
        const perimeter = getBuildingPerimeterTiles(building, this.gameState);
        let best: Tile | undefined;
        let bestDist = Infinity;
        for (const tile of perimeter) {
            const dist = hexDistanceTo(unit, tile);
            if (dist < bestDist) {
                bestDist = dist;
                best = tile;
            }
        }
        return best;
    }

    // ── Target finding ──────────────────────────

    private findAssaultTarget(unit: Entity): Entity | undefined {
        return findNearbyEnemyGarrison(unit, BUILDING_SEARCH_RADIUS, this.gameState);
    }

    private ensureAssault(building: Entity): void {
        if (this.assaults.has(building.id)) {
            return;
        }
        const maxHealth = getBuildingMaxHealth(building.subType as BuildingType);
        if (maxHealth === undefined) {
            return;
        }
        this.healthTracker.initBuilding(building.id, building.subType as BuildingType);
        this.assaults.set(building.id, { buildingId: building.id });
        this.eventBus.emit('siege:started', { buildingId: building.id, level: 'info' });
        log.debug(`Tower assault started on building ${building.id}`);
    }

    private scanDarkTribeSwordsmen(): void {
        for (const entity of this.gameState.entities) {
            if (!isDarkTribe(entity.race)) {
                continue;
            }
            if (!isIdleSwordsman(entity, this.unitReservation, this.combatSystem, this.gameState)) {
                continue;
            }
            this.tryStartAssault(entity);
        }
    }
}
