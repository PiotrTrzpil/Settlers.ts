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
import { EntityType, UnitType, BuildingType, tileKey, EXTENDED_OFFSETS } from '../../entity';
import { isDarkTribe } from '../../core/race';
import { getCombatStats } from '../combat/combat-state';
import { hexDistanceTo } from '../../systems/hex-directions';
import { isGarrisonBuildingType } from '../tower-garrison/internal/garrison-capacity';
import { isSwordsman } from './siege-helpers';
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
        const perimeter = this.getPerimeterTiles(building);
        const attackers: Entity[] = [];

        for (const tile of perimeter) {
            const occupantId = this.gameState.unitOccupancy.get(tileKey(tile));
            if (occupantId === undefined) {
                continue;
            }
            const unit = this.gameState.getEntity(occupantId);
            if (!unit || unit.type !== EntityType.Unit || unit.hidden) {
                continue;
            }
            if (unit.player === building.player) {
                continue;
            }
            if (!isDarkTribe(unit.race) || !isSwordsman(unit.subType as UnitType)) {
                continue;
            }
            // Only idle units deal structural damage — fighting units are busy with enemies
            if (this.combatSystem.isInCombat(occupantId)) {
                continue;
            }
            const controller = this.gameState.movement.getController(occupantId);
            if (controller && controller.state !== 'idle') {
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
        const perimeter = this.getPerimeterTiles(building);
        return perimeter.some(t => t.x === unit.x && t.y === unit.y);
    }

    /**
     * Get all walkable tiles adjacent to a building's footprint.
     * These are the valid positions for dark tribe attackers.
     */
    private getPerimeterTiles(building: Entity): Tile[] {
        const tiles: Tile[] = [];
        const seen = new Set<string>();
        const bx = building.x;
        const by = building.y;
        const range = 8;
        for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
                const tx = bx + dx;
                const ty = by + dy;
                const key = tileKey({ x: tx, y: ty });
                if (!this.gameState.buildingOccupancy.has(key)) {
                    continue;
                }
                for (const [ox, oy] of EXTENDED_OFFSETS) {
                    const nx = tx + ox;
                    const ny = ty + oy;
                    const nKey = tileKey({ x: nx, y: ny });
                    if (seen.has(nKey) || this.gameState.buildingOccupancy.has(nKey)) {
                        continue;
                    }
                    seen.add(nKey);
                    tiles.push({ x: nx, y: ny });
                }
            }
        }
        return tiles;
    }

    /** Find the closest walkable perimeter tile to a unit. */
    private findNearestPerimeterTile(unit: Entity, building: Entity): Tile | undefined {
        const perimeter = this.getPerimeterTiles(building);
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
        const nearby = this.gameState.getEntitiesInRadius(unit, BUILDING_SEARCH_RADIUS);
        let best: Entity | undefined;
        let bestDist = Infinity;

        for (const candidate of nearby) {
            if (candidate.type !== EntityType.Building || candidate.player === unit.player) {
                continue;
            }
            if (!isGarrisonBuildingType(candidate.subType as BuildingType)) {
                continue;
            }
            const dx = candidate.x - unit.x;
            const dy = candidate.y - unit.y;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = candidate;
            }
        }
        return best;
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
            if (entity.type !== EntityType.Unit || entity.hidden) {
                continue;
            }
            if (!isDarkTribe(entity.race) || !isSwordsman(entity.subType as UnitType)) {
                continue;
            }
            if (this.unitReservation.isReserved(entity.id) || this.combatSystem.isInCombat(entity.id)) {
                continue;
            }
            const controller = this.gameState.movement.getController(entity.id);
            if (controller && controller.state !== 'idle') {
                continue;
            }
            this.tryStartAssault(entity);
        }
    }
}
