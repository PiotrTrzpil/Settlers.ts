/**
 * Settlers API - Unit management functions
 * Implements the Settlers.* Lua table
 *
 * Note: Uses S4-compatible constant values. The game engine maps these
 * to internal UnitType values as needed.
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';
import { EntityType, UnitType } from '@/game/entity';

const log = new LogHandler('SettlersAPI');

/**
 * S4 Settler type constants
 * These match the original Settlers 4 Lua API values
 */
export const S4_SETTLER_TYPES = {
    // Workers (values match S4SettlerType enum from s4-types.ts)
    CARRIER: 1,
    DIGGER: 2,
    BUILDER: 3,
    WOODCUTTER: 4,
    STONECUTTER: 5,
    FORESTER: 6,
    FARMERGRAIN: 7,
    FARMERANIMALS: 8,
    FISHER: 9,
    WATERWORKER: 10,
    HUNTER: 11,
    SAWMILLWORKER: 12,
    SMELTER: 13,
    MINEWORKER: 14,
    SMITH: 15,
    MILLER: 16,
    BAKER: 17,
    BUTCHER: 18,
    SHIPYARDWORKER: 19,
    HEALER: 20,
    CHARCOALMAKER: 21,
    AMMOMAKER: 22,
    VEHICLEMAKER: 23,
    VINTNER: 24,
    BEEKEEPER: 25,
    MEADMAKER: 26,
    AGAVEFARMER: 27,
    TEQUILAMAKER: 28,

    // Military - Swordsmen
    SWORDSMAN_01: 29,
    SWORDSMAN_02: 30,
    SWORDSMAN_03: 31,

    // Military - Bowmen
    BOWMAN_01: 32,
    BOWMAN_02: 33,
    BOWMAN_03: 34,

    // Military - Medics
    MEDIC_01: 35,
    MEDIC_02: 36,
    MEDIC_03: 37,

    // Military - Axe Warriors
    AXEWARRIOR_01: 38,
    AXEWARRIOR_02: 39,
    AXEWARRIOR_03: 40,

    // Military - Blowgun Warriors
    BLOWGUNWARRIOR_01: 41,
    BLOWGUNWARRIOR_02: 42,
    BLOWGUNWARRIOR_03: 43,

    // Special units
    SQUADLEADER: 44,
    PRIEST: 45,
    SABOTEUR: 46,
    PIONEER: 47,
    THIEF: 48,
    GEOLOGIST: 49,
    GARDENER: 50,
    LANDSCAPER: 51,
    DONKEY: 60,
} as const;

/**
 * Map S4 settler types to internal UnitType values
 * Returns the internal type, or the S4 value if not yet implemented
 */
function mapS4ToInternalType(s4Type: number): number {
    // Map implemented types
    const mapping: Record<number, UnitType> = {
        [S4_SETTLER_TYPES.CARRIER]: UnitType.Carrier,
        [S4_SETTLER_TYPES.BUILDER]: UnitType.Builder,
        [S4_SETTLER_TYPES.WOODCUTTER]: UnitType.Woodcutter,
        [S4_SETTLER_TYPES.SWORDSMAN_01]: UnitType.Swordsman,
        [S4_SETTLER_TYPES.BOWMAN_01]: UnitType.Bowman,
        [S4_SETTLER_TYPES.PRIEST]: UnitType.Priest,
        [S4_SETTLER_TYPES.PIONEER]: UnitType.Pioneer,
        [S4_SETTLER_TYPES.THIEF]: UnitType.Thief,
        [S4_SETTLER_TYPES.GEOLOGIST]: UnitType.Geologist,
    };

    return mapping[s4Type] ?? s4Type;
}

export interface SettlersAPIContext {
    gameState: GameState;
}

/**
 * Register the Settlers API with the Lua runtime
 */
export function registerSettlersAPI(runtime: LuaRuntime, context: SettlersAPIContext): void {
    // Create Settlers table
    runtime.createTable('Settlers');

    // Register settler type constants (S4 values)
    for (const [name, value] of Object.entries(S4_SETTLER_TYPES)) {
        runtime.setTableField('Settlers', name, value);
    }

    // Settlers.AddSettlers(x, y, player, settlerType, amount) - Spawn settlers
    runtime.registerFunction('Settlers', 'AddSettlers', (
        x: number, y: number, player: number, settlerType: number, amount: number = 1
    ) => {
        const internalType = mapS4ToInternalType(settlerType);
        log.debug(`AddSettlers: ${amount}x type ${settlerType} (internal: ${internalType}) at (${x}, ${y}) for player ${player}`);

        const created: number[] = [];
        for (let i = 0; i < amount; i++) {
            // Offset slightly for multiple units
            const offsetX = x + (i % 3);
            const offsetY = y + Math.floor(i / 3);

            const entity = context.gameState.addEntity(
                EntityType.Unit,
                internalType,
                offsetX,
                offsetY,
                player
            );
            created.push(entity.id);
        }

        return created.length;
    });

    // Settlers.Amount(player, settlerType) - Count settlers of type
    runtime.registerFunction('Settlers', 'Amount', (player: number, settlerType: number) => {
        const internalType = mapS4ToInternalType(settlerType);
        let count = 0;
        for (const entity of context.gameState.entities) {
            if (entity.type === EntityType.Unit &&
                entity.subType === internalType &&
                entity.player === player) {
                count++;
            }
        }
        return count;
    });

    // Settlers.AmountInArea(player, settlerType, x, y, range) - Count settlers in area
    runtime.registerFunction('Settlers', 'AmountInArea', (
        player: number, settlerType: number, x: number, y: number, range: number
    ) => {
        const internalType = mapS4ToInternalType(settlerType);
        let count = 0;
        const rangeSq = range * range;

        for (const entity of context.gameState.entities) {
            if (entity.type !== EntityType.Unit) continue;
            if (entity.subType !== internalType) continue;
            if (entity.player !== player) continue;

            const dx = entity.x - x;
            const dy = entity.y - y;
            if (dx * dx + dy * dy <= rangeSq) {
                count++;
            }
        }
        return count;
    });

    // Settlers.Kill(entityId) - Kill a specific settler
    runtime.registerFunction('Settlers', 'Kill', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Unit) {
            context.gameState.removeEntity(entityId);
            log.debug(`Killed settler ${entityId}`);
            return true;
        }
        return false;
    });

    log.debug('Settlers API registered');
}
