/**
 * ResidenceSpawnerSystem — spawns carriers from residences at fixed intervals.
 *
 * Instead of spawning all carriers instantly when a residence completes,
 * this system queues them and spawns one at a time per interval tick.
 *
 * Set `immediateMode = true` (test/debug) to spawn all carriers at once in register().
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { BuildingSpawnConfig } from './types';
import { ringTiles } from '../../systems/spatial-search';
import type { Command, CommandResult } from '../../commands';
import type { Persistable } from '@/game/persistence';
import type { SerializedPendingSpawn } from '@/game/state/game-state-persistence';

interface PendingSpawn {
    buildingEntityId: number;
    config: BuildingSpawnConfig;
    remaining: number;
    timer: number;
}

export interface ResidenceSpawnerConfig {
    gameState: GameState;
    executeCommand: (cmd: Command) => CommandResult;
}

export class ResidenceSpawnerSystem implements TickSystem, Persistable<SerializedPendingSpawn[]> {
    readonly persistKey = 'residenceSpawns' as const;
    private readonly pending: PendingSpawn[] = [];
    private readonly gameState: GameState;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    /** When true, register() spawns all carriers immediately instead of queuing. */
    immediateMode = false;

    constructor(cfg: ResidenceSpawnerConfig) {
        this.gameState = cfg.gameState;
        this.executeCommand = cfg.executeCommand;
    }

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

                this.executeCommand({
                    type: 'spawn_unit',
                    unitType: config.unitType,
                    x: tile.x,
                    y: tile.y,
                    player: building.player,
                    race: building.race,
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

    // ── Persistable ───────────────────────────────────────────────

    serialize(): SerializedPendingSpawn[] {
        return this.pending.map(p => ({
            buildingEntityId: p.buildingEntityId,
            remaining: p.remaining,
            timer: p.timer,
            unitType: p.config.unitType,
            count: p.config.count,
            spawnInterval: p.config.spawnInterval!,
        }));
    }

    deserialize(data: SerializedPendingSpawn[]): void {
        this.pending.length = 0;
        for (const s of data) {
            this.pending.push({
                buildingEntityId: s.buildingEntityId,
                remaining: s.remaining,
                timer: s.timer,
                config: {
                    unitType: s.unitType,
                    count: s.count,
                    spawnInterval: s.spawnInterval,
                },
            });
        }
    }
}
