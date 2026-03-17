/**
 * VictoryConditionsSystem — event-driven win/loss condition checking.
 *
 * Default condition (matching Settlers 4 engine behavior):
 *   A player loses when they have no military buildings remaining
 *   (Castle, GuardTowerSmall, GuardTowerBig).
 *   The human player wins when all enemy players have lost.
 *
 * Castle counts are tracked via events (building:completed, building:removed,
 * building:ownerChanged) so no per-tick scanning is needed. The tick only
 * rechecks conditions when the dirty flag is set.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EntityType, BuildingType } from '../../entity';

export enum PlayerStatus {
    Playing = 'playing',
    Eliminated = 'eliminated',
}

export enum GameEndReason {
    /** All enemy players eliminated (castles destroyed). */
    AllEnemiesEliminated = 'all_enemies_eliminated',
    /** The local player was eliminated. */
    LocalPlayerEliminated = 'local_player_eliminated',
}

export interface GameResult {
    readonly ended: boolean;
    readonly winner: number | null;
    readonly reason: GameEndReason | null;
}

export interface VictoryConditionsConfig {
    gameState: GameState;
    eventBus: EventBus;
    /** The local/human player index (used to determine win vs loss). */
    localPlayer: number;
}

/** Buildings that count toward a player's survival — losing all of these means elimination. */
const MILITARY_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.Castle,
    BuildingType.GuardTowerSmall,
    BuildingType.GuardTowerBig,
]);

export class VictoryConditionsSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private localPlayer: number;

    /** Per-player status. Populated on first tick from gameState.playerRaces keys. */
    private readonly playerStatus = new Map<number, PlayerStatus>();
    /** Per-player count of military buildings (castles + towers), maintained via events. */
    private readonly castleCounts = new Map<number, number>();
    private initialized = false;
    /** Set when castle counts change — triggers condition recheck on next tick. */
    private dirty = false;

    /** Cached result — only changes when a player is eliminated or game ends. */
    private result: GameResult = { ended: false, winner: null, reason: null };

    constructor(config: VictoryConditionsConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.localPlayer = config.localPlayer;
    }

    /** Update the local player index (called after map load determines the human player). */
    setLocalPlayer(player: number): void {
        this.localPlayer = player;
    }

    // ── Event handlers (called by feature wiring) ───────────────────────

    onBuildingCompleted(buildingType: BuildingType, player: number): void {
        if (!MILITARY_BUILDINGS.has(buildingType)) {
            return;
        }
        this.castleCounts.set(player, (this.castleCounts.get(player) ?? 0) + 1);
        this.dirty = true;
    }

    onBuildingRemoved(buildingType: BuildingType, player: number): void {
        if (!MILITARY_BUILDINGS.has(buildingType)) {
            return;
        }
        const count = this.castleCounts.get(player) ?? 0;
        this.castleCounts.set(player, Math.max(0, count - 1));
        this.dirty = true;
    }

    onBuildingOwnerChanged(buildingType: BuildingType, oldPlayer: number, newPlayer: number): void {
        if (!MILITARY_BUILDINGS.has(buildingType)) {
            return;
        }
        const oldCount = this.castleCounts.get(oldPlayer) ?? 0;
        this.castleCounts.set(oldPlayer, Math.max(0, oldCount - 1));
        this.castleCounts.set(newPlayer, (this.castleCounts.get(newPlayer) ?? 0) + 1);
        this.dirty = true;
    }

    /** Reset all internal state so the system can re-initialize from restored entities. */
    reset(): void {
        this.playerStatus.clear();
        this.castleCounts.clear();
        this.initialized = false;
        this.dirty = false;
        this.result = { ended: false, winner: null, reason: null };
    }

    // ── Public query API ────────────────────────────────────────────────

    getPlayerStatus(player: number): PlayerStatus {
        return this.playerStatus.get(player) ?? PlayerStatus.Playing;
    }

    getResult(): GameResult {
        return this.result;
    }

    getActivePlayers(): number[] {
        const active: number[] = [];
        for (const [player, status] of this.playerStatus) {
            if (status === PlayerStatus.Playing) {
                active.push(player);
            }
        }
        return active;
    }

    // ── TickSystem ──────────────────────────────────────────────────────

    tick(_dt: number): void {
        if (this.result.ended) {
            return;
        }

        if (!this.initialized) {
            if (!this.tryInitPlayers()) {
                return;
            }
            // First init counts as dirty — need initial check
            this.dirty = true;
        }

        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        this.checkConditions();
    }

    // ── Internals ───────────────────────────────────────────────────────

    /** Returns true if players were successfully initialized. */
    private tryInitPlayers(): boolean {
        const races = this.gameState.playerRaces;
        if (races.size === 0) {
            return false;
        }

        for (const playerIndex of races.keys()) {
            this.playerStatus.set(playerIndex, PlayerStatus.Playing);
        }

        // Seed military building counts from current state
        for (const [playerIndex] of this.playerStatus) {
            let count = 0;
            const buildingIds = this.gameState.entityIndex.idsOfTypeAndPlayer(EntityType.Building, playerIndex);
            for (const id of buildingIds) {
                const entity = this.gameState.getEntity(id);
                if (entity && MILITARY_BUILDINGS.has(entity.subType as BuildingType)) {
                    count++;
                }
            }
            this.castleCounts.set(playerIndex, count);
        }

        this.initialized = true;
        return true;
    }

    private checkConditions(): void {
        // Don't eliminate players until at least one castle has been placed somewhere.
        // Without this guard, test scenarios (and skirmish starts) that place buildings
        // before castles would immediately eliminate all players on tick 1.
        let anyCastles = false;
        for (const count of this.castleCounts.values()) {
            if (count > 0) {
                anyCastles = true;
                break;
            }
        }
        if (!anyCastles) {
            return;
        }

        // Check each active player for castle ownership
        for (const [player, status] of this.playerStatus) {
            if (status !== PlayerStatus.Playing) {
                continue;
            }
            if ((this.castleCounts.get(player) ?? 0) === 0) {
                this.eliminatePlayer(player);
            }
        }

        // Determine game end
        const activePlayers = this.getActivePlayers();

        // Local player eliminated → loss
        if (this.playerStatus.get(this.localPlayer) === PlayerStatus.Eliminated) {
            this.result = {
                ended: true,
                winner: null,
                reason: GameEndReason.LocalPlayerEliminated,
            };
            this.eventBus.emit('game:ended', {
                winner: null,
                reason: GameEndReason.LocalPlayerEliminated,
                level: 'info',
            });
            return;
        }

        // All enemies eliminated → win
        const enemies = activePlayers.filter(p => p !== this.localPlayer);
        if (enemies.length === 0 && activePlayers.length > 0) {
            this.result = {
                ended: true,
                winner: this.localPlayer,
                reason: GameEndReason.AllEnemiesEliminated,
            };
            this.eventBus.emit('game:ended', {
                winner: this.localPlayer,
                reason: GameEndReason.AllEnemiesEliminated,
                level: 'info',
            });
        }
    }

    private eliminatePlayer(player: number): void {
        this.playerStatus.set(player, PlayerStatus.Eliminated);
        this.eventBus.emit('game:playerEliminated', { player, level: 'info' });
    }
}
