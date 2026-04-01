/**
 * AiPlayerSystemImpl — TickSystem managing all AI player controllers.
 *
 * Holds a Map<playerIndex, AiPlayerController>. Each tick iterates
 * controllers in deterministic (sorted) order and calls evaluate().
 *
 * TerrainData and hasSite are injected lazily:
 * - terrain via onTerrainReady() (called when terrain data is loaded)
 * - hasSite via setHasSite() (called after feature construction)
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { CommandExecutor } from '@/game/commands/command-types';
import type { PlacementFilter } from '@/game/systems/placement/types';
import type { AiPlayerConfig, AiPlayerState, AiPlayerSystem } from '../types';
import { AiPlayerController } from './ai-player-controller';

export class AiPlayerSystemImpl implements AiPlayerSystem {
    private readonly controllers = new Map<number, AiPlayerController>();
    private readonly gameState: GameState;
    private readonly executeCommand: CommandExecutor;
    private readonly isGameOver: () => boolean;

    private hasSite: (buildingId: number) => boolean = () => false;
    private getPlacementFilter: () => PlacementFilter | null = () => null;
    private terrain: TerrainData | null = null;

    constructor(deps: {
        gameState: GameState;
        executeCommand: CommandExecutor;
        isGameOver: () => boolean;
    }) {
        this.gameState = deps.gameState;
        this.executeCommand = deps.executeCommand;
        this.isGameOver = deps.isGameOver;
    }

    /** Inject construction site check. Called by feature after deps are ready. */
    setHasSite(hasSite: (buildingId: number) => boolean): void {
        this.hasSite = hasSite;
    }

    /** Inject placement filter (territory). Called by feature after deps are ready. */
    setPlacementFilter(getter: () => PlacementFilter | null): void {
        this.getPlacementFilter = getter;
    }

    /** Store terrain data. Called via onTerrainReady in the feature instance. */
    onTerrainReady(terrain: TerrainData): void {
        this.terrain = terrain;
    }

    // ── AiPlayerSystem interface ─────────────────────────────────

    addPlayer(config: AiPlayerConfig): void {
        if (this.controllers.has(config.player)) {
            throw new Error(`AiPlayerSystem.addPlayer: player ${config.player} already has a controller`);
        }
        if (!this.terrain) {
            throw new Error('AiPlayerSystem.addPlayer: terrain not loaded — wait for onTerrainReady()');
        }

        const race = this.gameState.playerRaces.get(config.player);
        if (race === undefined) {
            throw new Error(`AiPlayerSystem.addPlayer: no race mapping for player ${config.player}`);
        }

        const controller = new AiPlayerController({
            config,
            race,
            gameState: this.gameState,
            terrain: this.terrain,
            executeCommand: this.executeCommand,
            getPlacementFilter: this.getPlacementFilter,
            hasSite: this.hasSite,
            isGameOver: this.isGameOver,
        });

        this.controllers.set(config.player, controller);
    }

    removePlayer(player: number): void {
        if (!this.controllers.has(player)) {
            throw new Error(`AiPlayerSystem.removePlayer: no controller for player ${player}`);
        }
        this.controllers.delete(player);
    }

    getState(player: number): Readonly<AiPlayerState> {
        const controller = this.controllers.get(player);
        if (!controller) {
            throw new Error(`AiPlayerSystem.getState: no controller for player ${player}`);
        }
        return controller.getState();
    }

    getActivePlayers(): readonly number[] {
        return [...this.controllers.keys()].sort((a, b) => a - b);
    }

    // ── TickSystem interface ─────────────────────────────────────

    tick(dt: number): void {
        // Deterministic iteration: sorted by player index
        const sortedPlayers = [...this.controllers.keys()].sort((a, b) => a - b);
        for (const player of sortedPlayers) {
            const controller = this.controllers.get(player);
            if (!controller) {
                throw new Error(`No AI controller for player ${player} in AiPlayerSystem.tick`);
            }
            try {
                controller.evaluate(dt);
            } catch (err) {
                // Tick systems catch errors — don't crash other AIs
                console.error(`[AI] Player ${player} evaluation error:`, err);
            }
        }
    }

    destroy(): void {
        this.controllers.clear();
    }
}
