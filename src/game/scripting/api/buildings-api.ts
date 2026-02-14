/**
 * Buildings API - Building management functions
 * Implements the Buildings.* Lua table
 *
 * Note: Uses S4-compatible constant values. The game engine maps these
 * to internal BuildingType values as needed.
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { GameState } from '@/game/game-state';
import { EntityType, BuildingType } from '@/game/entity';
import { BuildingConstructionPhase, type BuildingStateManager } from '@/game/features/building-construction';

const log = new LogHandler('BuildingsAPI');

/** Building state constants */
export const BUILDING_STATE_CONSTANTS = {
    BUILD: 0, // Under construction
    STANDARD: 1, // Completed
} as const;

/**
 * S4 Building type constants
 * These match the original Settlers 4 Lua API values (S4BuildingType)
 */
export const S4_BUILDING_TYPES = {
    WOODCUTTERHUT: 1,
    FORESTERHUT: 2,
    SAWMILL: 3,
    STONECUTTERHUT: 4,
    WATERWORKHUT: 5,
    FISHERHUT: 6,
    HUNTERHUT: 7,
    SLAUGHTERHOUSE: 8,
    MILL: 9,
    BAKERY: 10,
    GRAINFARM: 11,
    ANIMALRANCH: 12,
    DONKEYRANCH: 13,
    STONEMINE: 14,
    IRONMINE: 15,
    GOLDMINE: 16,
    COALMINE: 17,
    SULFURMINE: 18,
    SMELTGOLD: 19,
    SMELTIRON: 20,
    TOOLSMITH: 21,
    WEAPONSMITH: 22,
    VEHICLEHALL: 23,
    BARRACKS: 24,
    CHARCOALMAKER: 25,
    TRAININGCENTER: 26,
    HEALERHUT: 27,
    AMMOMAKERHUT: 28,
    GUNPOWDERMAKERHUT: 29,
    LANDSCAPEMAKERHUT: 30,
    SHIPYARD: 31,
    PORT: 32,
    MARKETPLACE: 33,
    STORAGEAREA: 34,
    VINYARD: 35,
    AGAVEFARMERHUT: 36,
    TEQUILAMAKERHUT: 37,
    BEEKEEPERHUT: 38,
    MEADMAKERHUT: 39,
    RESIDENCESMALL: 40,
    RESIDENCEMEDIUM: 41,
    RESIDENCEBIG: 42,
    SMALLTEMPLE: 43,
    BIGTEMPLE: 44,
    LOOKOUTTOWER: 45,
    GUARDTOWERSMALL: 46,
    GUARDTOWERBIG: 47,
    CASTLE: 48,
} as const;

/**
 * Map S4 building types to internal BuildingType values
 * Returns the internal type, or the S4 value if not yet implemented
 */
function mapS4ToInternalType(s4Type: number): number {
    const mapping: Record<number, BuildingType> = {
        [S4_BUILDING_TYPES.WOODCUTTERHUT]: BuildingType.WoodcutterHut,
        [S4_BUILDING_TYPES.FORESTERHUT]: BuildingType.ForesterHut,
        [S4_BUILDING_TYPES.SAWMILL]: BuildingType.Sawmill,
        [S4_BUILDING_TYPES.STONECUTTERHUT]: BuildingType.StonecutterHut,
        [S4_BUILDING_TYPES.WATERWORKHUT]: BuildingType.WaterworkHut,
        [S4_BUILDING_TYPES.FISHERHUT]: BuildingType.FisherHut,
        [S4_BUILDING_TYPES.HUNTERHUT]: BuildingType.HunterHut,
        [S4_BUILDING_TYPES.SLAUGHTERHOUSE]: BuildingType.Slaughterhouse,
        [S4_BUILDING_TYPES.MILL]: BuildingType.Mill,
        [S4_BUILDING_TYPES.BAKERY]: BuildingType.Bakery,
        [S4_BUILDING_TYPES.GRAINFARM]: BuildingType.GrainFarm,
        [S4_BUILDING_TYPES.ANIMALRANCH]: BuildingType.AnimalRanch,
        [S4_BUILDING_TYPES.DONKEYRANCH]: BuildingType.DonkeyRanch,
        [S4_BUILDING_TYPES.STONEMINE]: BuildingType.StoneMine,
        [S4_BUILDING_TYPES.IRONMINE]: BuildingType.IronMine,
        [S4_BUILDING_TYPES.GOLDMINE]: BuildingType.GoldMine,
        [S4_BUILDING_TYPES.COALMINE]: BuildingType.CoalMine,
        [S4_BUILDING_TYPES.SULFURMINE]: BuildingType.SulfurMine,
        [S4_BUILDING_TYPES.SMELTGOLD]: BuildingType.SmeltGold,
        [S4_BUILDING_TYPES.SMELTIRON]: BuildingType.IronSmelter,
        [S4_BUILDING_TYPES.TOOLSMITH]: BuildingType.ToolSmith,
        [S4_BUILDING_TYPES.WEAPONSMITH]: BuildingType.WeaponSmith,
        [S4_BUILDING_TYPES.BARRACKS]: BuildingType.Barrack,
        [S4_BUILDING_TYPES.HEALERHUT]: BuildingType.HealerHut,
        [S4_BUILDING_TYPES.AMMOMAKERHUT]: BuildingType.AmmunitionMaker,
        [S4_BUILDING_TYPES.SHIPYARD]: BuildingType.Shipyard,
        [S4_BUILDING_TYPES.STORAGEAREA]: BuildingType.StorageArea,
        [S4_BUILDING_TYPES.RESIDENCESMALL]: BuildingType.ResidenceSmall,
        [S4_BUILDING_TYPES.RESIDENCEMEDIUM]: BuildingType.ResidenceMedium,
        [S4_BUILDING_TYPES.RESIDENCEBIG]: BuildingType.ResidenceBig,
        [S4_BUILDING_TYPES.SMALLTEMPLE]: BuildingType.SmallTemple,
        [S4_BUILDING_TYPES.BIGTEMPLE]: BuildingType.LargeTemple,
        [S4_BUILDING_TYPES.LOOKOUTTOWER]: BuildingType.LookoutTower,
        [S4_BUILDING_TYPES.GUARDTOWERSMALL]: BuildingType.GuardTowerSmall,
        [S4_BUILDING_TYPES.GUARDTOWERBIG]: BuildingType.GuardTowerBig,
        [S4_BUILDING_TYPES.CASTLE]: BuildingType.Castle,
    };

    return mapping[s4Type] ?? s4Type;
}

export interface BuildingsAPIContext {
    gameState: GameState;
    buildingStateManager: BuildingStateManager;
}

/**
 * Check if a building is in "completed" state
 */
function isBuildingCompleted(buildingStateManager: BuildingStateManager, entityId: number): boolean {
    const buildingState = buildingStateManager.getBuildingState(entityId);
    if (!buildingState) return false;
    return buildingState.phase === BuildingConstructionPhase.Completed;
}

/**
 * Register the Buildings API with the Lua runtime
 */
export function registerBuildingsAPI(runtime: LuaRuntime, context: BuildingsAPIContext): void {
    // Create Buildings table
    runtime.createTable('Buildings');

    // Register building state constants
    for (const [name, value] of Object.entries(BUILDING_STATE_CONSTANTS)) {
        runtime.setTableField('Buildings', name, value);
    }

    // Register building type constants (S4 values)
    for (const [name, value] of Object.entries(S4_BUILDING_TYPES)) {
        runtime.setTableField('Buildings', name, value);
    }

    // Buildings.AddBuilding(x, y, player, buildingType) - Create a building
    runtime.registerFunction(
        'Buildings',
        'AddBuilding',
        (x: number, y: number, player: number, buildingType: number) => {
            const internalType = mapS4ToInternalType(buildingType);
            log.debug(
                `AddBuilding: type ${buildingType} (internal: ${internalType}) at (${x}, ${y}) for player ${player}`
            );

            const entity = context.gameState.addEntity(EntityType.Building, internalType, x, y, player);

            return entity.id;
        }
    );

    // Buildings.CrushBuilding(entityId) - Destroy a building
    runtime.registerFunction('Buildings', 'CrushBuilding', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Building) {
            context.gameState.removeEntity(entityId);
            log.debug(`Crushed building ${entityId}`);
            return true;
        }
        return false;
    });

    // Buildings.Amount(player, buildingType, state?) - Count buildings
    runtime.registerFunction('Buildings', 'Amount', (player: number, buildingType: number, state?: number) => {
        const internalType = mapS4ToInternalType(buildingType);
        let count = 0;

        for (const entity of context.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;
            if (entity.subType !== internalType) continue;
            if (entity.player !== player) continue;

            // Filter by state if specified
            if (state !== undefined) {
                const isComplete = isBuildingCompleted(context.buildingStateManager, entity.id);
                if (state === BUILDING_STATE_CONSTANTS.STANDARD && !isComplete) continue;
                if (state === BUILDING_STATE_CONSTANTS.BUILD && isComplete) continue;
            }

            count++;
        }
        return count;
    });

    // Buildings.ExistsBuildingInArea(player, buildingType, x, y, range) - Check if building exists in area
    runtime.registerFunction(
        'Buildings',
        'ExistsBuildingInArea',
        (player: number, buildingType: number, x: number, y: number, range: number) => {
            const internalType = mapS4ToInternalType(buildingType);
            const rangeSq = range * range;

            for (const entity of context.gameState.entities) {
                if (entity.type !== EntityType.Building) continue;
                if (entity.subType !== internalType) continue;
                if (entity.player !== player) continue;

                const dx = entity.x - x;
                const dy = entity.y - y;
                if (dx * dx + dy * dy <= rangeSq) {
                    return true;
                }
            }
            return false;
        }
    );

    // Buildings.AddBuildingEx(x, y, player, buildingType) - Alias for AddBuilding (S4 script compatibility)
    runtime.registerFunction(
        'Buildings',
        'AddBuildingEx',
        (x: number, y: number, player: number, buildingType: number) => {
            const internalType = mapS4ToInternalType(buildingType);
            log.debug(
                `AddBuildingEx: type ${buildingType} (internal: ${internalType}) at (${x}, ${y}) for player ${player}`
            );

            const entity = context.gameState.addEntity(EntityType.Building, internalType, x, y, player);

            return entity.id;
        }
    );

    // Buildings.GetState(entityId) - Get building construction state
    // Returns: 0 = BUILD (under construction), 1 = STANDARD (completed)
    runtime.registerFunction('Buildings', 'GetState', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Building) {
            return -1;
        }

        const isComplete = isBuildingCompleted(context.buildingStateManager, entityId);
        return isComplete ? BUILDING_STATE_CONSTANTS.STANDARD : BUILDING_STATE_CONSTANTS.BUILD;
    });

    // Buildings.IsComplete(entityId) - Check if building is fully constructed
    runtime.registerFunction('Buildings', 'IsComplete', (entityId: number) => {
        return isBuildingCompleted(context.buildingStateManager, entityId);
    });

    // Buildings.GetPosition(entityId) - Get building position
    runtime.registerFunction('Buildings', 'GetPosition', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Building) {
            return { x: entity.x, y: entity.y };
        }
        return null;
    });

    // Buildings.GetType(entityId) - Get building type
    runtime.registerFunction('Buildings', 'GetType', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Building) {
            return entity.subType;
        }
        return -1;
    });

    // Buildings.GetPlayer(entityId) - Get building owner
    runtime.registerFunction('Buildings', 'GetPlayer', (entityId: number) => {
        const entity = context.gameState.getEntity(entityId);
        if (entity && entity.type === EntityType.Building) {
            return entity.player;
        }
        return -1;
    });

    log.debug('Buildings API registered');
}
