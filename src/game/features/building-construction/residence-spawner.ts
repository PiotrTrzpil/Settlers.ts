/**
 * ResidenceSpawnerSystem — spawns carriers from residences at fixed intervals.
 *
 * When a residence completes, carriers are queued and spawn one at a time
 * at the building's door tile. Any unit blocking the door is pushed aside.
 *
 * Set `immediateMode = true` (test/debug) to spawn all carriers at once in register().
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingSpawnConfig } from './types';
import { BuildingType } from '../../buildings/types';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { getUnitLevel } from '../../core/unit-types';

interface PendingSpawn {
    buildingEntityId: number;
    config: BuildingSpawnConfig;
    remaining: number;
    timer: number;
}

export interface ResidenceSpawnerConfig {
    gameState: GameState;
    eventBus: EventBus;
}

export class ResidenceSpawnerSystem implements TickSystem {
    private readonly pending: PendingSpawn[] = [];
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;

    /** When true, register() spawns all carriers immediately instead of queuing. */
    immediateMode = false;

    constructor(cfg: ResidenceSpawnerConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
    }

    /** Register a completed residence for carrier spawning */
    register(buildingEntityId: number, config: BuildingSpawnConfig): void {
        if (this.immediateMode) {
            for (let i = 0; i < config.count; i++) {
                this.spawnOne(buildingEntityId, config);
            }
        } else {
            this.pending.push({
                buildingEntityId,
                config,
                remaining: config.count,
                timer: config.spawnInterval!,
            });
        }
    }

    tick(dt: number): void {
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const entry = this.pending[i]!;
            entry.timer -= dt;
            if (entry.timer > 0) {
                continue;
            }

            // Reset timer for next spawn
            entry.timer += entry.config.spawnInterval!;

            this.spawnOne(entry.buildingEntityId, entry.config);
            entry.remaining--;
            if (entry.remaining <= 0) {
                this.pending.splice(i, 1);
            }
        }
    }

    /** Spawn a single carrier at the building's door tile, pushing any occupant aside. */
    private spawnOne(buildingEntityId: number, config: BuildingSpawnConfig): void {
        const building = this.gameState.getEntityOrThrow(buildingEntityId, 'residence building for carrier spawn');

        const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);

        // Push any unit blocking the door
        this.gameState.movement.pushUnitAt(door.x, door.y);

        // Spawn directly at the door. The building owns this tile in tileOccupancy,
        // so we use occupancy:false to avoid overwriting it. The movement controller
        // created by entity:created tracks the unit in unitPositions instead.
        const entity = this.gameState.addUnit(config.unitType, door.x, door.y, building.player, {
            occupancy: false,
        });
        entity.level = getUnitLevel(config.unitType);

        this.eventBus.emit('unit:spawned', {
            unitId: entity.id,
            unitType: config.unitType,
            x: door.x,
            y: door.y,
            player: building.player,
        });
    }

    onEntityRemoved(entityId: number): void {
        const idx = this.pending.findIndex(p => p.buildingEntityId === entityId);
        if (idx !== -1) {
            this.pending.splice(idx, 1);
        }
    }

    /** Number of pending spawn entries (for testing) */
    get pendingCount(): number {
        return this.pending.length;
    }
}
