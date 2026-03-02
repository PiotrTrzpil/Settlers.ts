/**
 * ResidenceSpawnerSystem — spawns carriers from residences at fixed intervals.
 *
 * Instead of spawning all carriers instantly when a residence completes,
 * this system queues them and spawns one at a time per interval tick.
 *
 * Set `immediateMode = true` (test/debug) to spawn all carriers at once in register().
 */

import type { TickSystem } from '../../tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { TerrainData } from '../../terrain';
import type { BuildingSpawnConfig } from './types';
import { EntityType } from '../../entity';
import { ringTiles } from '../../systems/spatial-search';

interface PendingSpawn {
    buildingEntityId: number;
    config: BuildingSpawnConfig;
    remaining: number;
    timer: number;
}

export class ResidenceSpawnerSystem implements TickSystem {
    private readonly pending: PendingSpawn[] = [];

    /** When true, register() spawns all carriers immediately instead of queuing. */
    immediateMode = false;

    constructor(
        private readonly gameState: GameState,
        private readonly eventBus: EventBus
    ) {}

    /** Terrain reference — set when terrain is loaded */
    private terrain!: TerrainData;

    setTerrain(terrain: TerrainData): void {
        this.terrain = terrain;
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
            if (entry.timer > 0) continue;

            // Reset timer for next spawn
            entry.timer += entry.config.spawnInterval!;

            if (!this.spawnOne(entry.buildingEntityId, entry.config)) {
                this.pending.splice(i, 1);
                continue;
            }

            entry.remaining--;
            if (entry.remaining <= 0) {
                this.pending.splice(i, 1);
            }
        }
    }

    /** Spawn a single carrier near the building. Returns false if building no longer exists. */
    private spawnOne(buildingEntityId: number, config: BuildingSpawnConfig): boolean {
        const building = this.gameState.getEntity(buildingEntityId);
        if (!building) return false;

        const bx = building.x;
        const by = building.y;
        for (let radius = 1; radius <= 4; radius++) {
            for (const tile of ringTiles(bx, by, radius)) {
                if (!this.terrain.isInBounds(tile.x, tile.y)) continue;
                if (!this.terrain.isPassable(tile.x, tile.y)) continue;
                if (this.gameState.getEntityAt(tile.x, tile.y)) continue;

                const spawnedEntity = this.gameState.addEntity(
                    EntityType.Unit,
                    config.unitType,
                    tile.x,
                    tile.y,
                    building.player,
                    config.selectable
                );
                spawnedEntity.race = building.race;

                this.eventBus.emit('unit:spawned', {
                    entityId: spawnedEntity.id,
                    unitType: config.unitType,
                    x: tile.x,
                    y: tile.y,
                    player: building.player,
                });

                return true;
            }
        }
        return true; // building exists, just no space — keep trying
    }

    onEntityRemoved(entityId: number): void {
        const idx = this.pending.findIndex(p => p.buildingEntityId === entityId);
        if (idx !== -1) this.pending.splice(idx, 1);
    }

    /** Number of pending spawn entries (for testing) */
    get pendingCount(): number {
        return this.pending.length;
    }
}
