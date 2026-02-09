/**
 * Game API - Core game state functions
 * Implements the Game.* Lua table
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';

const log = new LogHandler('GameAPI');

/** Race/tribe constants matching S4 */
export const RACE_CONSTANTS = {
    RACE_ROMAN: 0,
    RACE_VIKING: 1,
    RACE_MAYA: 2,
    RACE_DARK: 3,
    RACE_TROJAN: 4,
} as const;

export interface GameAPIContext {
    gameState: GameState;
    /** Current game time in ticks */
    gameTime: number;
    /** Local player index */
    localPlayer: number;
    /** Total number of players */
    playerCount: number;
    /** Difficulty level (0=easy, 1=normal, 2=hard) */
    difficulty: number;
    /** Callback when a player wins */
    onPlayerWon?: (player: number) => void;
    /** Callback when a player loses */
    onPlayerLost?: (player: number) => void;
    /** Map dimensions */
    mapWidth: number;
    mapHeight: number;
}

/**
 * Register the Game API with the Lua runtime
 */
export function registerGameAPI(runtime: LuaRuntime, context: GameAPIContext): void {
    // Create Game table
    runtime.createTable('Game');

    // Register race constants
    for (const [name, value] of Object.entries(RACE_CONSTANTS)) {
        runtime.setTableField('Game', name, value);
    }

    // Game.Time() - Returns current game time in ticks
    runtime.registerFunction('Game', 'Time', () => {
        return context.gameTime;
    });

    // Game.LocalPlayer() - Returns the local player index
    runtime.registerFunction('Game', 'LocalPlayer', () => {
        return context.localPlayer;
    });

    // Game.NumberOfPlayers() - Returns total player count
    runtime.registerFunction('Game', 'NumberOfPlayers', () => {
        return context.playerCount;
    });

    // Game.GetDifficulty() - Returns difficulty level
    runtime.registerFunction('Game', 'GetDifficulty', () => {
        return context.difficulty;
    });

    // Game.PlayerWon(player) - Mark player as winner
    runtime.registerFunction('Game', 'PlayerWon', (player: number) => {
        log.debug(`Player ${player} won!`);
        context.onPlayerWon?.(player);
    });

    // Game.PlayerLost(player) - Mark player as loser
    runtime.registerFunction('Game', 'PlayerLost', (player: number) => {
        log.debug(`Player ${player} lost!`);
        context.onPlayerLost?.(player);
    });

    // Game.Random(max) - Returns random integer 0 to max-1
    runtime.registerFunction('Game', 'Random', (max: number) => {
        return Math.floor(Math.random() * max);
    });

    // Game.ShowClock(time) - Display countdown timer
    runtime.registerFunction('Game', 'ShowClock', (time: number) => {
        log.debug(`ShowClock: ${time}`);
        // TODO: Implement UI countdown display
    });

    // Game.IsAreaOwned(player, x, y, range) - Check if player owns area
    runtime.registerFunction('Game', 'IsAreaOwned', (_player: number, _x: number, _y: number, _range: number) => {
        // TODO: Implement territory ownership check
        // For now, always return false
        return false;
    });

    // Game.PlayerRace(player) - Get player's race/tribe
    // Returns: 0=Roman, 1=Viking, 2=Maya, 3=Dark, 4=Trojan
    runtime.registerFunction('Game', 'PlayerRace', (player: number) => {
        // TODO: Look up player race from player data
        // For now, return Roman (0) as default
        log.debug(`PlayerRace: player ${player} -> 0 (Roman, default)`);
        return RACE_CONSTANTS.RACE_ROMAN;
    });

    // Game.MapWidth() - Get map width
    runtime.registerFunction('Game', 'MapWidth', () => {
        return context.mapWidth;
    });

    // Game.MapHeight() - Get map height
    runtime.registerFunction('Game', 'MapHeight', () => {
        return context.mapHeight;
    });

    log.debug('Game API registered');
}
