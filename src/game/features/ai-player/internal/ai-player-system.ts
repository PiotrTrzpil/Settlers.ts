/**
 * AiPlayerSystemImpl — TickSystem managing all AI player controllers.
 *
 * Holds a Map<playerIndex, AiPlayerController>. Each tick iterates
 * controllers in deterministic (sorted) order and calls evaluate().
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import type { CommandExecutor } from '@/game/commands/command-types';
import type { PlacementFilter } from '@/game/systems/placement/types';
import type { UnitCommitmentQuery } from '@/game/systems/unit-commitment';
import type { AiPlayerConfig, AiPlayerState, AiPlayerSystem } from '../types';
import { AiPlayerController } from './ai-player-controller';

export class AiPlayerSystemImpl implements AiPlayerSystem {
    private readonly controllers = new Map<number, AiPlayerController>();
    private readonly gameState: GameState;
    private readonly executeCommand: CommandExecutor;
    private readonly unitCommitments: UnitCommitmentQuery;
    private readonly isGameOver: () => boolean;

    private readonly hasSite: (buildingId: number) => boolean;
    private readonly getPlacementFilter: () => PlacementFilter;
    private readonly terrain: TerrainData;

    constructor(deps: {
        gameState: GameState;
        terrain: TerrainData;
        executeCommand: CommandExecutor;
        unitCommitments: UnitCommitmentQuery;
        isGameOver: () => boolean;
        hasSite: (buildingId: number) => boolean;
        getPlacementFilter: () => PlacementFilter;
    }) {
        this.gameState = deps.gameState;
        this.terrain = deps.terrain;
        this.executeCommand = deps.executeCommand;
        this.unitCommitments = deps.unitCommitments;
        this.isGameOver = deps.isGameOver;
        this.hasSite = deps.hasSite;
        this.getPlacementFilter = deps.getPlacementFilter;
    }

    // ── AiPlayerSystem interface ─────────────────────────────────

    addPlayer(config: AiPlayerConfig): void {
        if (this.controllers.has(config.player)) {
            throw new Error(`AiPlayerSystem.addPlayer: player ${config.player} already has a controller`);
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
            unitCommitments: this.unitCommitments,
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
