/**
 * AI API - Computer player control functions
 * Implements the AI.* Lua table
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';

const log = new LogHandler('AIAPI');

/** AI behavior mode constants */
export const AI_MODE_CONSTANTS = {
    PASSIVE: 0,      // AI does nothing
    DEFENSIVE: 1,    // AI only defends
    AGGRESSIVE: 2,   // AI attacks when able
    ECONOMIC: 3,     // AI focuses on economy
} as const;

export interface AIAPIContext {
    gameState: GameState;
}

/**
 * Register the AI API with the Lua runtime
 */
export function registerAIAPI(runtime: LuaRuntime, _context: AIAPIContext): void {
    // Create AI table
    runtime.createTable('AI');

    // Register AI mode constants
    for (const [name, value] of Object.entries(AI_MODE_CONSTANTS)) {
        runtime.setTableField('AI', name, value);
    }

    // AI.SetMode(player, mode) - Set AI behavior mode
    runtime.registerFunction('AI', 'SetMode', (player: number, mode: number) => {
        log.debug(`AI.SetMode: player ${player}, mode ${mode}`);
        // TODO: Implement AI mode setting
        return true;
    });

    // AI.GetMode(player) - Get current AI mode
    runtime.registerFunction('AI', 'GetMode', (_player: number) => {
        // TODO: Implement AI mode lookup
        return AI_MODE_CONSTANTS.PASSIVE;
    });

    // AI.Enable(player, enabled) - Enable/disable AI for player
    runtime.registerFunction('AI', 'Enable', (player: number, enabled: boolean) => {
        log.debug(`AI.Enable: player ${player}, enabled ${enabled}`);
        // TODO: Implement AI enable/disable
        return true;
    });

    // AI.IsEnabled(player) - Check if AI is enabled
    runtime.registerFunction('AI', 'IsEnabled', (_player: number) => {
        // TODO: Implement AI status check
        return false;
    });

    // AI.SetAttackTarget(player, x, y) - Direct AI to attack position
    runtime.registerFunction('AI', 'SetAttackTarget', (player: number, x: number, y: number) => {
        log.debug(`AI.SetAttackTarget: player ${player} -> (${x}, ${y})`);
        // TODO: Implement AI attack targeting
        return true;
    });

    // AI.SetDefendPosition(player, x, y) - Set AI defense point
    runtime.registerFunction('AI', 'SetDefendPosition', (player: number, x: number, y: number) => {
        log.debug(`AI.SetDefendPosition: player ${player} -> (${x}, ${y})`);
        // TODO: Implement AI defense positioning
        return true;
    });

    // AI.SetPriority(player, buildingType, priority) - Set building construction priority
    runtime.registerFunction('AI', 'SetPriority', (
        player: number, buildingType: number, priority: number
    ) => {
        log.debug(`AI.SetPriority: player ${player}, building ${buildingType}, priority ${priority}`);
        // TODO: Implement AI priority setting
        return true;
    });

    // AI.SendSquad(player, targetPlayer, soldierCount) - Send soldiers to attack
    runtime.registerFunction('AI', 'SendSquad', (
        player: number, targetPlayer: number, soldierCount: number
    ) => {
        log.debug(`AI.SendSquad: player ${player} sends ${soldierCount} soldiers to attack player ${targetPlayer}`);
        // TODO: Implement squad sending
        return true;
    });

    log.debug('AI API registered');
}
