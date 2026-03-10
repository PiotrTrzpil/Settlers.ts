/**
 * System for populating buildings from map entity data.
 * Maps S4BuildingType to our internal BuildingType and creates completed buildings.
 */

import { BuildingType } from '../../buildings/types';
import { captureOriginalTerrain, setConstructionSiteGroundType, applyTerrainLeveling } from './terrain';
import type { TerrainBuildingParams } from './terrain';
import { GameState } from '../../game-state';
import { createLogger } from '@/utilities/logger';
import type { MapBuildingData } from '@/resources/map/map-entity-data';
import { S4BuildingType } from '@/resources/map/s4-types';
import type { EventBus } from '../../event-bus';
import type { TerrainData } from '../../terrain';

const log = createLogger('MapBuildings');

/**
 * Mapping from Settlers 4 building types to our internal building types.
 * Some S4 types don't have direct equivalents and are approximated.
 */
const S4_TO_BUILDING_TYPE: Partial<Record<S4BuildingType, BuildingType>> = {
    [S4BuildingType.WOODCUTTERHUT]: BuildingType.WoodcutterHut,
    [S4BuildingType.FORESTERHUT]: BuildingType.ForesterHut,
    [S4BuildingType.SAWMILL]: BuildingType.Sawmill,
    [S4BuildingType.STONECUTTERHUT]: BuildingType.StonecutterHut,
    [S4BuildingType.WATERWORKHUT]: BuildingType.WaterworkHut,
    [S4BuildingType.FISHERHUT]: BuildingType.FisherHut,
    [S4BuildingType.HUNTERHUT]: BuildingType.HunterHut,
    [S4BuildingType.SLAUGHTERHOUSE]: BuildingType.Slaughterhouse,
    [S4BuildingType.MILL]: BuildingType.Mill,
    [S4BuildingType.BAKERY]: BuildingType.Bakery,
    [S4BuildingType.GRAINFARM]: BuildingType.GrainFarm,
    [S4BuildingType.ANIMALRANCH]: BuildingType.AnimalRanch,
    [S4BuildingType.DONKEYRANCH]: BuildingType.DonkeyRanch,
    [S4BuildingType.STONEMINE]: BuildingType.StoneMine,
    [S4BuildingType.IRONMINE]: BuildingType.IronMine,
    [S4BuildingType.GOLDMINE]: BuildingType.GoldMine,
    [S4BuildingType.COALMINE]: BuildingType.CoalMine,
    [S4BuildingType.SULFURMINE]: BuildingType.SulfurMine,
    [S4BuildingType.SMELTGOLD]: BuildingType.SmeltGold,
    [S4BuildingType.SMELTIRON]: BuildingType.IronSmelter,
    [S4BuildingType.TOOLSMITH]: BuildingType.ToolSmith,
    [S4BuildingType.WEAPONSMITH]: BuildingType.WeaponSmith,
    [S4BuildingType.VEHICLEHALL]: BuildingType.SiegeWorkshop,
    [S4BuildingType.BARRACKS]: BuildingType.Barrack,
    [S4BuildingType.CHARCOALMAKER]: BuildingType.CharcoalMaker,
    [S4BuildingType.HEALERHUT]: BuildingType.HealerHut,
    [S4BuildingType.AMMOMAKERHUT]: BuildingType.AmmunitionMaker,
    [S4BuildingType.SHIPYARD]: BuildingType.Shipyard,
    [S4BuildingType.PORT]: BuildingType.Port,
    [S4BuildingType.MARKETPLACE]: BuildingType.Marketplace,
    [S4BuildingType.STORAGEAREA]: BuildingType.StorageArea,
    [S4BuildingType.VINYARD]: BuildingType.Vinyard,
    [S4BuildingType.AGAVEFARMERHUT]: BuildingType.AgaveFarmerHut,
    [S4BuildingType.TEQUILAMAKERHUT]: BuildingType.TequilaMakerHut,
    [S4BuildingType.BEEKEEPERHUT]: BuildingType.BeekeeperHut,
    [S4BuildingType.MEADMAKERHUT]: BuildingType.MeadMakerHut,
    [S4BuildingType.SUNFLOWERFARMERHUT]: BuildingType.SunflowerFarmerHut,
    [S4BuildingType.SUNFLOWEROILMAKERHUT]: BuildingType.SunflowerOilMakerHut,
    [S4BuildingType.RESIDENCESMALL]: BuildingType.ResidenceSmall,
    [S4BuildingType.RESIDENCEMEDIUM]: BuildingType.ResidenceMedium,
    [S4BuildingType.RESIDENCEBIG]: BuildingType.ResidenceBig,
    [S4BuildingType.SMALLTEMPLE]: BuildingType.SmallTemple,
    [S4BuildingType.BIGTEMPLE]: BuildingType.LargeTemple,
    [S4BuildingType.LOOKOUTTOWER]: BuildingType.LookoutTower,
    [S4BuildingType.GUARDTOWERSMALL]: BuildingType.GuardTowerSmall,
    [S4BuildingType.GUARDTOWERBIG]: BuildingType.GuardTowerBig,
    [S4BuildingType.CASTLE]: BuildingType.Castle,
    [S4BuildingType.FORTRESS]: BuildingType.Fortress,
    [S4BuildingType.MANACOPTERHALL]: BuildingType.ManaCopterHall,
    // Eyecatchers / monuments
    [S4BuildingType.EYECATCHER01]: BuildingType.Eyecatcher01,
    [S4BuildingType.EYECATCHER02]: BuildingType.Eyecatcher02,
    [S4BuildingType.EYECATCHER03]: BuildingType.Eyecatcher03,
    [S4BuildingType.EYECATCHER04]: BuildingType.Eyecatcher04,
    [S4BuildingType.EYECATCHER05]: BuildingType.Eyecatcher05,
    [S4BuildingType.EYECATCHER06]: BuildingType.Eyecatcher06,
    [S4BuildingType.EYECATCHER07]: BuildingType.Eyecatcher07,
    [S4BuildingType.EYECATCHER08]: BuildingType.Eyecatcher08,
    [S4BuildingType.EYECATCHER09]: BuildingType.Eyecatcher09,
    [S4BuildingType.EYECATCHER10]: BuildingType.Eyecatcher10,
    [S4BuildingType.EYECATCHER11]: BuildingType.Eyecatcher11,
    [S4BuildingType.EYECATCHER12]: BuildingType.Eyecatcher12,
    // Dark Tribe buildings
    [S4BuildingType.MUSHROOMFARM]: BuildingType.MushroomFarm,
    [S4BuildingType.DARKTEMPLE]: BuildingType.DarkTemple,
};

/**
 * Options for populating map buildings.
 */
export interface PopulateBuildingsOptions {
    /** Only populate buildings for this player (undefined = all players) */
    player?: number;
    /** Event bus for emitting building:completed events */
    eventBus: EventBus;
    /** Terrain data for terrain modification (required) */
    terrain: TerrainData;
}

/**
 * Populate buildings from map entity data.
 * Creates completed building entities from the map's building data.
 *
 * @param state - Game state to add entities to
 * @param buildings - Building data from map parser
 * @param options - Filtering and terrain options
 * @returns Number of buildings spawned
 */
export function populateMapBuildings(
    state: GameState,
    buildings: MapBuildingData[],
    options: PopulateBuildingsOptions
): number {
    const { player, eventBus } = options;
    let count = 0;
    let skipped = 0;
    const perPlayer = new Map<number, string[]>();

    for (const buildingData of buildings) {
        // Filter by player if specified
        if (player !== undefined && buildingData.player !== player) {
            continue;
        }

        // Map S4 building type to internal type
        const buildingType = S4_TO_BUILDING_TYPE[buildingData.buildingType];
        if (buildingType === undefined) {
            log.debug(
                `Skipping unmapped building type: ${S4BuildingType[buildingData.buildingType]} at (${buildingData.x}, ${buildingData.y})`
            );
            skipped++;
            continue;
        }

        // Skip if tile is already occupied
        if (state.getEntityAt(buildingData.x, buildingData.y)) {
            log.debug(`Skipping building at occupied tile (${buildingData.x}, ${buildingData.y})`);
            skipped++;
            continue;
        }

        // Create the building entity — race is derived from playerRaces[player] in GameState
        const entity = state.addBuilding(buildingType, buildingData.x, buildingData.y, buildingData.player);

        // Apply instant terrain modification using a temporary params object.
        // No ConstructionSite is created — the building is immediately operational.
        // originalTerrain is discarded — terrain permanence for completed buildings.
        const { groundType, groundHeight, mapSize } = options.terrain;
        const terrainParams: TerrainBuildingParams = {
            buildingType,
            race: entity.race,
            tileX: entity.x,
            tileY: entity.y,
        };
        const originalTerrain = captureOriginalTerrain(terrainParams, groundType, groundHeight, mapSize);
        setConstructionSiteGroundType(terrainParams, groundType, mapSize, originalTerrain);
        applyTerrainLeveling(terrainParams, groundType, groundHeight, mapSize, 1.0, originalTerrain);

        // Mark the building's footprint as movement-blocking (completed buildings block tiles).
        // This must happen before building:completed so listeners see correct occupancy.
        state.restoreBuildingFootprintBlock(entity.id);

        // Emit building:completed so that systems (like CarrierSystem) can register state
        // and spawn units (handled by BuildingConstructionSystem listener)
        // Map-loaded buildings get their workers from map data + assignInitialBuildingWorkers.
        // Do NOT set spawnWorker — that would spawn a duplicate worker at the door.
        eventBus.emit('building:completed', {
            entityId: entity.id,
            buildingType,
            race: entity.race,
        });

        const entries = perPlayer.get(buildingData.player) ?? [];
        entries.push(`${BuildingType[buildingType]}@(${buildingData.x},${buildingData.y})`);
        perPlayer.set(buildingData.player, entries);
        count++;
    }

    if (count > 0) {
        const parts = [...perPlayer.entries()].map(([p, entries]) => `P${p}: ${entries.join(', ')}`).join(' | ');
        log.debug(`Populated ${count} buildings (${skipped} skipped) — ${parts}`);
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
