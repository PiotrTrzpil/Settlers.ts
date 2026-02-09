/**
 * Goods API - Resource and material management
 * Implements the Goods.* Lua table
 *
 * Note: Uses S4-compatible constant values.
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';
import { EntityType } from '@/game/entity';

const log = new LogHandler('GoodsAPI');

/**
 * S4 Good type constants
 * These match the original Settlers 4 Lua API values (S4GoodType)
 */
export const S4_GOOD_TYPES = {
    // Resources
    LOG: 1,
    BOARD: 2,
    STONE: 3,
    COAL: 4,
    IRONORE: 5,
    GOLDORE: 6,
    SULFUR: 7,
    IRON: 8,
    GOLD: 9,

    // Tools
    AXE: 10,
    SAW: 11,
    PICK: 12,
    PICKAXE: 12,   // Alias for script compatibility
    HAMMER: 13,
    SHOVEL: 14,
    FISHINGROD: 15,
    ROD: 15,       // Alias for script compatibility
    SCYTHE: 16,
    BOW: 17,
    CROSSBOW: 18,
    SWORD: 19,
    LANCE: 20,
    MACE: 21,

    // Food
    FISH: 22,
    BREAD: 23,
    MEAT: 24,
    GRAIN: 25,
    FLOUR: 26,
    WATER: 27,
    WINE: 28,
    MEAD: 29,
    TEQUILA: 30,
    HONEY: 31,

    // Military
    ARMOR: 32,
    ARROWS: 33,
    GUNPOWDER: 34,
    EXPLOSIVES: 35,
    CANNON: 36,
    CATAPULT_AMMO: 37,

    // Transport
    CART: 38,
    BOAT: 39,
    DONKEY: 40,

    // Animals
    PIG: 41,
    SHEEP: 42,
} as const;

export interface GoodsAPIContext {
    gameState: GameState;
}

/**
 * Register the Goods API with the Lua runtime
 */
export function registerGoodsAPI(runtime: LuaRuntime, context: GoodsAPIContext): void {
    // Create Goods table
    runtime.createTable('Goods');

    // Register good type constants
    for (const [name, value] of Object.entries(S4_GOOD_TYPES)) {
        runtime.setTableField('Goods', name, value);
    }

    // Goods.Amount(player, goodType) - Count goods of type owned by player
    runtime.registerFunction('Goods', 'Amount', (player: number, goodType: number) => {
        // TODO: Implement inventory system lookup
        // For now, count stacks on the map
        let count = 0;
        for (const entity of context.gameState.entities) {
            if (entity.type === EntityType.StackedResource &&
                entity.subType === goodType &&
                entity.player === player) {
                // Stack entity - count would be stored in entity data
                count++;
            }
        }
        return count;
    });

    // Goods.AddGoods(x, y, goodType, amount) - Create goods at position
    runtime.registerFunction('Goods', 'AddGoods', (
        x: number, y: number, goodType: number, amount: number
    ) => {
        log.debug(`AddGoods: ${amount}x type ${goodType} at (${x}, ${y})`);

        // Create stack entity
        const entity = context.gameState.addEntity(
            EntityType.StackedResource,
            goodType,
            x,
            y,
            0 // Goods don't belong to a specific player initially
        );

        // Set the quantity
        if (amount > 1) {
            context.gameState.setResourceQuantity(entity.id, amount);
        }

        return entity.id;
    });

    // Goods.RemoveGoods(player, goodType, amount) - Remove goods from player's inventory
    runtime.registerFunction('Goods', 'RemoveGoods', (
        player: number, goodType: number, amount: number
    ) => {
        // TODO: Implement proper inventory management
        log.debug(`RemoveGoods: ${amount}x type ${goodType} from player ${player}`);
        return false;
    });

    // Goods.GetStackAt(x, y) - Get goods info at position
    runtime.registerFunction('Goods', 'GetStackAt', (x: number, y: number) => {
        for (const entity of context.gameState.entities) {
            if (entity.type === EntityType.StackedResource &&
                Math.floor(entity.x) === x &&
                Math.floor(entity.y) === y) {
                return {
                    type: entity.subType,
                    amount: 1, // TODO: Get actual amount from stack data
                    id: entity.id,
                };
            }
        }
        return null;
    });

    // Goods.AddPileEx(x, y, goodType, amount) - Alias for AddGoods (S4 script compatibility)
    // Creates a resource pile at the specified location
    runtime.registerFunction('Goods', 'AddPileEx', (
        x: number, y: number, goodType: number, amount: number
    ) => {
        log.debug(`AddPileEx: ${amount}x type ${goodType} at (${x}, ${y})`);

        // Create stack entity
        const entity = context.gameState.addEntity(
            EntityType.StackedResource,
            goodType,
            x,
            y,
            0 // Goods don't belong to a specific player initially
        );

        // Set the quantity (defaults to 1, so only update if different)
        if (amount > 1) {
            context.gameState.setResourceQuantity(entity.id, amount);
        }

        return entity.id;
    });

    log.debug('Goods API registered');
}
