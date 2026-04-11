/**
 * Settlers API - Unit management functions
 * Implements the Settlers.* Lua table
 *
 * Note: Uses S4-compatible constant values. The game engine maps these
 * to internal UnitType values as needed.
 */

import { LogHandler } from '@/utilities/log-handler';
import { Race } from '../../core/race';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';
import { EntityType, UnitType, type Tile, getEntityIfType } from '@/game/entity';
import type { ExecuteCommand } from '@/game/commands';

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

    // Military - Backpack Catapultists (Trojan)
    BACKPACKCATAPULTIST_01: 61,
    BACKPACKCATAPULTIST_02: 62,
    BACKPACKCATAPULTIST_03: 63,

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
function mapS4ToInternalType(s4Type: number): UnitType {
    // Map implemented types
    const mapping: Record<number, UnitType> = {
        // Workers
        [S4_SETTLER_TYPES.CARRIER]: UnitType.Carrier,
        [S4_SETTLER_TYPES.DIGGER]: UnitType.Digger,
        [S4_SETTLER_TYPES.BUILDER]: UnitType.Builder,
        [S4_SETTLER_TYPES.WOODCUTTER]: UnitType.Woodcutter,
        [S4_SETTLER_TYPES.STONECUTTER]: UnitType.Stonecutter,
        [S4_SETTLER_TYPES.FORESTER]: UnitType.Forester,
        [S4_SETTLER_TYPES.FARMERGRAIN]: UnitType.Farmer,
        [S4_SETTLER_TYPES.FARMERANIMALS]: UnitType.AnimalFarmer,
        [S4_SETTLER_TYPES.FISHER]: UnitType.Fisher,
        [S4_SETTLER_TYPES.WATERWORKER]: UnitType.Waterworker,
        [S4_SETTLER_TYPES.HUNTER]: UnitType.Hunter,
        [S4_SETTLER_TYPES.SAWMILLWORKER]: UnitType.SawmillWorker,
        [S4_SETTLER_TYPES.SMELTER]: UnitType.Smelter,
        [S4_SETTLER_TYPES.MINEWORKER]: UnitType.Miner,
        [S4_SETTLER_TYPES.SMITH]: UnitType.Smith,
        [S4_SETTLER_TYPES.MILLER]: UnitType.Miller,
        [S4_SETTLER_TYPES.BAKER]: UnitType.Baker,
        [S4_SETTLER_TYPES.BUTCHER]: UnitType.Butcher,
        [S4_SETTLER_TYPES.HEALER]: UnitType.Healer,
        [S4_SETTLER_TYPES.CHARCOALMAKER]: UnitType.Smelter, // charcoal burner uses smelter worker
        [S4_SETTLER_TYPES.AMMOMAKER]: UnitType.Smith, // ammo smith uses smith worker
        [S4_SETTLER_TYPES.VEHICLEMAKER]: UnitType.Smith, // vehicle maker uses smith worker
        [S4_SETTLER_TYPES.VINTNER]: UnitType.Winemaker,
        [S4_SETTLER_TYPES.BEEKEEPER]: UnitType.Beekeeper,
        [S4_SETTLER_TYPES.MEADMAKER]: UnitType.Meadmaker,
        [S4_SETTLER_TYPES.AGAVEFARMER]: UnitType.AgaveFarmer,
        [S4_SETTLER_TYPES.TEQUILAMAKER]: UnitType.Tequilamaker,
        // Military
        [S4_SETTLER_TYPES.SWORDSMAN_01]: UnitType.Swordsman1,
        [S4_SETTLER_TYPES.SWORDSMAN_02]: UnitType.Swordsman2,
        [S4_SETTLER_TYPES.SWORDSMAN_03]: UnitType.Swordsman3,
        [S4_SETTLER_TYPES.BOWMAN_01]: UnitType.Bowman1,
        [S4_SETTLER_TYPES.BOWMAN_02]: UnitType.Bowman2,
        [S4_SETTLER_TYPES.BOWMAN_03]: UnitType.Bowman3,
        [S4_SETTLER_TYPES.MEDIC_01]: UnitType.Medic1,
        [S4_SETTLER_TYPES.MEDIC_02]: UnitType.Medic2,
        [S4_SETTLER_TYPES.MEDIC_03]: UnitType.Medic3,
        [S4_SETTLER_TYPES.AXEWARRIOR_01]: UnitType.AxeWarrior1,
        [S4_SETTLER_TYPES.AXEWARRIOR_02]: UnitType.AxeWarrior2,
        [S4_SETTLER_TYPES.AXEWARRIOR_03]: UnitType.AxeWarrior3,
        [S4_SETTLER_TYPES.BLOWGUNWARRIOR_01]: UnitType.BlowgunWarrior1,
        [S4_SETTLER_TYPES.BLOWGUNWARRIOR_02]: UnitType.BlowgunWarrior2,
        [S4_SETTLER_TYPES.BLOWGUNWARRIOR_03]: UnitType.BlowgunWarrior3,
        [S4_SETTLER_TYPES.BACKPACKCATAPULTIST_01]: UnitType.BackpackCatapultist1,
        [S4_SETTLER_TYPES.BACKPACKCATAPULTIST_02]: UnitType.BackpackCatapultist2,
        [S4_SETTLER_TYPES.BACKPACKCATAPULTIST_03]: UnitType.BackpackCatapultist3,
        // Specialists
        [S4_SETTLER_TYPES.SQUADLEADER]: UnitType.SquadLeader,
        [S4_SETTLER_TYPES.PRIEST]: UnitType.Priest,
        [S4_SETTLER_TYPES.SABOTEUR]: UnitType.Saboteur,
        [S4_SETTLER_TYPES.PIONEER]: UnitType.Pioneer,
        [S4_SETTLER_TYPES.THIEF]: UnitType.Thief,
        [S4_SETTLER_TYPES.GEOLOGIST]: UnitType.Geologist,
        [S4_SETTLER_TYPES.GARDENER]: UnitType.Gardener,
        [S4_SETTLER_TYPES.LANDSCAPER]: UnitType.Gardener,
        [S4_SETTLER_TYPES.DONKEY]: UnitType.Donkey,
    };

    const mapped = mapping[s4Type];
    if (!mapped) {
        throw new Error(`Unknown S4 settler type: ${s4Type} — add mapping in settlers-api.ts`);
    }
    return mapped;
}

export interface SettlersAPIContext {
    gameState: GameState;
    /** Per-player race mapping (player index → Race) */
    playerRaces?: Map<number, Race>;
    /** Optional: move a unit to a target position (uses pathfinding) */
    moveUnit?: (entityId: number, target: Tile) => boolean;
    executeCommand?: ExecuteCommand;
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
    runtime.registerFunction(
        'Settlers',
        'AddSettlers',
        (x: number, y: number, player: number, settlerType: number, amount: number = 1) => {
            const internalType = mapS4ToInternalType(settlerType);
            log.debug(
                `AddSettlers: ${amount}x type ${settlerType} (internal: ${internalType}) at (${x}, ${y}) for player ${player}`
            );

            const race = context.playerRaces?.get(player);
            if (race === undefined) {
                throw new Error(`No race mapping for player ${player} in AddSettlers`);
            }

            const result = context.executeCommand!({
                type: 'script_add_settlers',
                unitType: internalType,
                x,
                y,
                player,
                amount,
                race,
            });

            return result.success ? result.count : 0;
        }
    );

    // Settlers.Amount(player, settlerType) - Count settlers of type
    runtime.registerFunction('Settlers', 'Amount', (player: number, settlerType: number) => {
        const internalType = mapS4ToInternalType(settlerType);
        return context.gameState.entityIndex.query(EntityType.Unit, player, internalType).count();
    });

    // Settlers.AmountInArea(player, settlerType, x, y, range) - Count settlers in area
    runtime.registerFunction(
        'Settlers',
        'AmountInArea',
        (player: number, settlerType: number, x: number, y: number, range: number) => {
            const internalType = mapS4ToInternalType(settlerType);
            return context.gameState.entityIndex
                .query(EntityType.Unit, player, internalType)
                .inRadius({ x, y }, range)
                .count();
        }
    );

    // Settlers.Kill(entityId) - Kill a specific settler
    runtime.registerFunction('Settlers', 'Kill', (entityId: number) => {
        const entity = getEntityIfType(context.gameState, entityId, EntityType.Unit);
        if (entity) {
            context.gameState.removeEntity(entityId);
            log.debug(`Killed settler ${entityId}`);
            return true;
        }
        return false;
    });

    // Settlers.MoveTo(entityId, x, y) - Move a settler to a position
    runtime.registerFunction('Settlers', 'MoveTo', (entityId: number, x: number, y: number) => {
        const entity = getEntityIfType(context.gameState, entityId, EntityType.Unit);
        if (!entity) {
            log.debug(`MoveTo: entity ${entityId} not found or not a unit`);
            return false;
        }

        if (context.moveUnit) {
            log.debug(`MoveTo: moving ${entityId} to (${x}, ${y})`);
            return context.moveUnit(entityId, { x, y });
        }

        log.debug(`MoveTo: movement system not available`);
        return false;
    });

    // Settlers.GetPosition(entityId) - Get settler's current position
    runtime.registerFunction('Settlers', 'GetPosition', (entityId: number) => {
        const entity = getEntityIfType(context.gameState, entityId, EntityType.Unit);
        if (entity) {
            return { x: entity.x, y: entity.y };
        }
        return null;
    });

    // Settlers.IsAlive(entityId) - Check if settler exists
    runtime.registerFunction('Settlers', 'IsAlive', (entityId: number) => {
        return getEntityIfType(context.gameState, entityId, EntityType.Unit) !== undefined;
    });

    // Settlers.GetType(entityId) - Get settler's type (returns string name or -1 if not a unit)
    // S4 Lua API convention: -1 sentinel for not-found; mixed return type is intentional.
    /* eslint-disable sonarjs/function-return-type -- S4 Lua API convention: -1 sentinel for not-found; mixed return type is intentional */
    runtime.registerFunction('Settlers', 'GetType', (entityId: number): string | number => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Unit) {
            return entity.subType;
        }
        return -1;
    });
    /* eslint-enable sonarjs/function-return-type -- end S4 Lua API exception */

    // Settlers.GetPlayer(entityId) - Get settler's owner player
    runtime.registerFunction('Settlers', 'GetPlayer', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Unit) {
            return entity.player;
        }
        return -1;
    });

    log.debug('Settlers API registered');
}
