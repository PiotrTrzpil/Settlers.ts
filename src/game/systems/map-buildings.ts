/**
 * System for populating buildings from map entity data.
 * Maps S4BuildingType to our internal BuildingType and creates completed buildings.
 */

import { EntityType } from '../entity';
import { BuildingType } from '../buildings/types';
import { BuildingConstructionPhase, type BuildingState } from '../features/building-construction';
import { GameState } from '../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { MapBuildingData } from '@/resources/map/map-entity-data';
import { S4BuildingType } from '@/resources/map/s4-types';

const log = new LogHandler('MapBuildings');

/**
 * Mapping from Settlers 4 building types to our internal building types.
 * Some S4 types don't have direct equivalents and are approximated.
 */
const S4_TO_BUILDING_TYPE: Partial<Record<S4BuildingType, BuildingType>> = {
    [S4BuildingType.WOODCUTTERHUT]: BuildingType.Lumberjack,
    [S4BuildingType.FORESTERHUT]: BuildingType.Forester,
    [S4BuildingType.SAWMILL]: BuildingType.Sawmill,
    [S4BuildingType.STONECUTTERHUT]: BuildingType.Stonecutter,
    [S4BuildingType.WATERWORKHUT]: BuildingType.Waterworks,
    [S4BuildingType.FISHERHUT]: BuildingType.Fishery,
    [S4BuildingType.HUNTERHUT]: BuildingType.Hunter,
    [S4BuildingType.SLAUGHTERHOUSE]: BuildingType.Slaughterhouse,
    [S4BuildingType.MILL]: BuildingType.Windmill,
    [S4BuildingType.BAKERY]: BuildingType.Bakery,
    [S4BuildingType.GRAINFARM]: BuildingType.Farm,
    [S4BuildingType.ANIMALRANCH]: BuildingType.PigFarm,
    [S4BuildingType.DONKEYRANCH]: BuildingType.DonkeyFarm,
    [S4BuildingType.STONEMINE]: BuildingType.StoneMine,
    [S4BuildingType.IRONMINE]: BuildingType.IronMine,
    [S4BuildingType.GOLDMINE]: BuildingType.GoldMine,
    [S4BuildingType.COALMINE]: BuildingType.CoalMine,
    [S4BuildingType.SULFURMINE]: BuildingType.SulfurMine,
    [S4BuildingType.SMELTGOLD]: BuildingType.GoldSmelter,
    [S4BuildingType.SMELTIRON]: BuildingType.IronSmelter,
    [S4BuildingType.TOOLSMITH]: BuildingType.ToolSmith,
    [S4BuildingType.WEAPONSMITH]: BuildingType.WeaponSmith,
    [S4BuildingType.VEHICLEHALL]: BuildingType.SiegeWorkshop,
    [S4BuildingType.BARRACKS]: BuildingType.Barrack,
    [S4BuildingType.CHARCOALMAKER]: BuildingType.CoalMine, // Approximation
    [S4BuildingType.TRAININGCENTER]: BuildingType.Barrack, // Approximation
    [S4BuildingType.HEALERHUT]: BuildingType.Healer,
    [S4BuildingType.AMMOMAKERHUT]: BuildingType.AmmunitionMaker,
    [S4BuildingType.SHIPYARD]: BuildingType.Shipyard,
    [S4BuildingType.STORAGEAREA]: BuildingType.Warehouse,
    [S4BuildingType.VINYARD]: BuildingType.WinePress,
    [S4BuildingType.RESIDENCESMALL]: BuildingType.SmallHouse,
    [S4BuildingType.RESIDENCEMEDIUM]: BuildingType.MediumHouse,
    [S4BuildingType.RESIDENCEBIG]: BuildingType.LargeHouse,
    [S4BuildingType.SMALLTEMPLE]: BuildingType.SmallTemple,
    [S4BuildingType.BIGTEMPLE]: BuildingType.LargeTemple,
    [S4BuildingType.LOOKOUTTOWER]: BuildingType.ScoutTower,
    [S4BuildingType.GUARDTOWERSMALL]: BuildingType.Tower,
    [S4BuildingType.GUARDTOWERBIG]: BuildingType.LargeTower,
    [S4BuildingType.CASTLE]: BuildingType.Castle,
    [S4BuildingType.FORTRESS]: BuildingType.Castle, // Approximation
    [S4BuildingType.MANACOPTERHALL]: BuildingType.SiegeWorkshop, // Approximation
};

/**
 * Default construction duration used for building state.
 * Since these are pre-built, we set elapsed time equal to this.
 */
const DEFAULT_CONSTRUCTION_DURATION = 10;

/**
 * Create a completed building state for a pre-existing building.
 */
function createCompletedBuildingState(
    entityId: number,
    buildingType: BuildingType,
    x: number,
    y: number
): BuildingState {
    return {
        entityId,
        buildingType,
        phase: BuildingConstructionPhase.Completed,
        phaseProgress: 1.0,
        totalDuration: DEFAULT_CONSTRUCTION_DURATION,
        elapsedTime: DEFAULT_CONSTRUCTION_DURATION,
        tileX: x,
        tileY: y,
        originalTerrain: null,
        terrainModified: true, // Mark as already modified since it's pre-existing
    };
}

/**
 * Options for populating map buildings.
 */
export interface PopulateBuildingsOptions {
    /** Only populate buildings for this player (undefined = all players) */
    player?: number;
}

/**
 * Populate buildings from map entity data.
 * Creates completed building entities from the map's building data.
 *
 * @param state - Game state to add entities to
 * @param buildings - Building data from map parser
 * @param options - Filtering options
 * @returns Number of buildings spawned
 */
export function populateMapBuildings(
    state: GameState,
    buildings: MapBuildingData[],
    options: PopulateBuildingsOptions = {}
): number {
    const { player } = options;
    let count = 0;
    let skipped = 0;

    for (const buildingData of buildings) {
        // Filter by player if specified
        if (player !== undefined && buildingData.player !== player) {
            continue;
        }

        // Map S4 building type to internal type
        const buildingType = S4_TO_BUILDING_TYPE[buildingData.buildingType];
        if (buildingType === undefined) {
            log.debug(`Skipping unmapped building type: ${S4BuildingType[buildingData.buildingType] ?? buildingData.buildingType} at (${buildingData.x}, ${buildingData.y})`);
            skipped++;
            continue;
        }

        // Skip if tile is already occupied
        if (state.getEntityAt(buildingData.x, buildingData.y)) {
            log.debug(`Skipping building at occupied tile (${buildingData.x}, ${buildingData.y})`);
            skipped++;
            continue;
        }

        // Create the building entity
        // Note: addEntity handles tile occupancy and creates a default building state
        const entity = state.addEntity(
            EntityType.Building,
            buildingType,
            buildingData.x,
            buildingData.y,
            buildingData.player
        );

        // Override the building state to be completed (pre-existing building)
        const completedState = createCompletedBuildingState(
            entity.id,
            buildingType,
            buildingData.x,
            buildingData.y
        );
        state.buildingStates.set(entity.id, completedState);

        log.debug(`Created completed building: ${BuildingType[buildingType]} at (${buildingData.x}, ${buildingData.y}) for player ${buildingData.player}`);
        count++;
    }

    if (count > 0) {
        log.debug(`Populated ${count} buildings from map data (${skipped} skipped)`);
    }

    return count;
}

/**
 * Get the internal building type for an S4 building type.
 * Returns undefined if no mapping exists.
 */
export function mapS4BuildingType(s4Type: S4BuildingType): BuildingType | undefined {
    return S4_TO_BUILDING_TYPE[s4Type];
}
