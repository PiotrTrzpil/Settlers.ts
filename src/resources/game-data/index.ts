/**
 * Game Data module - parses and provides access to game configuration XML files.
 *
 * Usage:
 *   import { getGameDataLoader } from '@/resources/game-data';
 *
 *   // Load data (call once at startup)
 *   await getGameDataLoader().load();
 *
 *   // Access data
 *   const building = getGameDataLoader().getBuilding('RACE_ROMAN', 'BUILDING_SAWMILL');
 */

export { GameDataLoader, getGameDataLoader } from './game-data-loader';
export type {
    GameData,
    RaceId,
    RaceIndex,
    RaceBuildingData,
    RaceJobData,
    BuildingInfo,
    BuildingPileInfo,
    BuilderInfo,
    PositionOffset,
    BoundingRect,
    JobInfo,
    JobNode,
    ObjectInfo,
} from './types';
export { raceIdToIndex } from './types';

// Footprint decoder
export {
    decodeBuildingFootprint,
    getBuildingFootprintFromInfo,
    getBuildingFootprintAt,
    getFootprintBounds,
} from './footprint-decoder';
