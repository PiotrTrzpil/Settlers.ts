/**
 * Auto-Garrison System
 *
 * Scans all garrison buildings every 30 ticks. For each completely-empty tower
 * (0 garrisoned AND 0 en-route), finds the nearest idle military unit belonging
 * to the same player and dispatches a garrison_units command.
 *
 * Preference: Swordsman (any level) over Bowman. Within a role, picks the
 * closest unit by Chebyshev distance to the tower door tile.
 *
 * The garrison_units command calls manager.markEnRoute() immediately on
 * acceptance, so the next iteration of the scan will see needsAutoGarrison()
 * == false — preventing double-dispatch within the same scan.
 */

import type { TickSystem } from '@/game/core/tick-system';
import type { GameState } from '@/game/game-state';
import { EntityType, BuildingType } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { Command, CommandResult } from '@/game/commands';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { createLogger } from '@/utilities/logger';
import type { TowerGarrisonManager } from './tower-garrison-manager';
import { getGarrisonRole, isGarrisonBuildingType } from './internal/garrison-capacity';

const log = createLogger('AutoGarrison');

/** Number of ticks between auto-garrison scans. */
const SCAN_INTERVAL_TICKS = 30;

export interface AutoGarrisonSystemConfig {
    manager: TowerGarrisonManager;
    unitReservation: UnitReservationRegistry;
    executeCommand: (cmd: Command) => CommandResult;
    gameState: GameState;
}

export class AutoGarrisonSystem implements TickSystem {
    private readonly manager: TowerGarrisonManager;
    private readonly unitReservation: UnitReservationRegistry;
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private readonly gameState: GameState;

    private tickAccumulator = 0;

    constructor(config: AutoGarrisonSystemConfig) {
        this.manager = config.manager;
        this.unitReservation = config.unitReservation;
        this.executeCommand = config.executeCommand;
        this.gameState = config.gameState;
    }

    // =========================================================================
    // TickSystem
    // =========================================================================

    tick(_dt: number): void {
        this.tickAccumulator++;
        if (this.tickAccumulator < SCAN_INTERVAL_TICKS) return;
        this.tickAccumulator = 0;

        try {
            this.runScan();
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.error('Auto-garrison scan failed', err);
        }
    }

    // =========================================================================
    // Scan logic
    // =========================================================================

    private runScan(): void {
        // Collect garrison building IDs and sort for determinism.
        const buildingIds = this.collectGarrisonBuildingIds();
        buildingIds.sort((a, b) => a - b);

        for (const buildingId of buildingIds) {
            try {
                this.scanBuilding(buildingId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Auto-garrison scan failed for building ${buildingId}`, err);
            }
        }
    }

    private collectGarrisonBuildingIds(): number[] {
        const ids: number[] = [];
        for (const entity of this.gameState.entityIndex.ofType(EntityType.Building)) {
            if (isGarrisonBuildingType(entity.subType as BuildingType)) {
                ids.push(entity.id);
            }
        }
        return ids;
    }

    private scanBuilding(buildingId: number): void {
        if (!this.manager.needsAutoGarrison(buildingId)) return;

        const building = this.gameState.getEntityOrThrow(buildingId, 'AutoGarrisonSystem.scanBuilding');
        const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);

        const candidateId = this.findNearestIdleSoldier(building.player, door.x, door.y);
        if (candidateId === null) return;

        this.executeCommand({
            type: 'garrison_units',
            buildingId,
            unitIds: [candidateId],
        });

        log.debug(`Auto-garrison: dispatched unit ${candidateId} to tower ${buildingId}`);
    }

    /**
     * Find the nearest idle garrison-eligible unit for the given player.
     * Prefers Swordsman-role units; falls back to Bowman-role if none found.
     * "Idle" means not reserved in UnitReservationRegistry.
     * Distance metric: Chebyshev distance to the tower door.
     */
    private findNearestIdleSoldier(player: number, doorX: number, doorY: number): number | null {
        let bestSwordsmanId: number | null = null;
        let bestSwordsmanDist = Infinity;
        let bestBowmanId: number | null = null;
        let bestBowmanDist = Infinity;

        for (const entity of this.gameState.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
            const unitType = entity.subType as UnitType;
            const role = getGarrisonRole(unitType);
            if (role === undefined) continue;
            if (this.unitReservation.isReserved(entity.id)) continue;

            const dist = Math.max(Math.abs(entity.x - doorX), Math.abs(entity.y - doorY));

            if (role === 'swordsman') {
                if (dist < bestSwordsmanDist) {
                    bestSwordsmanDist = dist;
                    bestSwordsmanId = entity.id;
                }
            } else {
                if (dist < bestBowmanDist) {
                    bestBowmanDist = dist;
                    bestBowmanId = entity.id;
                }
            }
        }

        return bestSwordsmanId ?? bestBowmanId;
    }
}
