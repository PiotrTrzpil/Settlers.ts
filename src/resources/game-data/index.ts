/**
 * Game Data module - parses and provides access to game configuration XML files.
 *
 * This is a pure data layer keyed by XML string identifiers (RaceId, building XML IDs).
 * For domain-typed access (Race, BuildingType enums), use '@/game/data/game-data-access'.
 *
 * Usage:
 *   import { getGameDataLoader } from '@/resources/game-data';
 *   await getGameDataLoader().load();
 *   const building = getGameDataLoader().getBuilding('RACE_ROMAN', 'BUILDING_SAWMILL');
 */

export { GameDataLoader, getGameDataLoader } from './game-data-loader';
export type {
    GameData,
    RaceId,
    RaceIndex,
    RaceBuildingData,
    RaceJobData,
    RaceBuildingTriggerData,
    RaceSettlerValueData,
    BuildingInfo,
    BuildingPatch,
    PatchSound,
    BuildingSettlerPos,
    BuildingPileInfo,
    BuilderInfo,
    PositionOffset,
    BoundingRect,
    JobInfo,
    JobNode,
    ObjectInfo,
    BuildingTrigger,
    TriggerEffect,
    TriggerPatch,
    TriggerSound,
    SettlerValueInfo,
} from './types';
export { raceIdToIndex, PileSlotType } from './types';

// Footprint decoder
export {
    decodeBuildingFootprint,
    getBuildingFootprintFromInfo,
    getBuildingFootprintAt,
    getBuildingBlockAreaAt,
    getFootprintBounds,
} from './footprint-decoder';
