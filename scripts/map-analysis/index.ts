export { loadMapData, getMapPathFromArgs, findMapFiles, DEFAULT_MAP_DIR, type MapRawData } from './map-data-loader';
export { getGroundTypeName, getTerrainGroup, TERRAIN_GROUPS, type TerrainGroup } from './ground-type-names';
export {
    buildObjectProfiles,
    buildCategorySummaries,
    buildTerrainGroupSummaries,
    profileMapsSequential,
} from './profile-builder';
export { buildAggregateProfiles, type AggregateProfile } from './aggregate-builder';
export { profileMapsParallel } from './parallel-profiler';
export { printFullReport } from './formatters';
export { writeYamlReport, writeAggregateYaml } from './yaml-writer';
export type {
    ObjectProfile,
    HeightStats,
    CategorySummary,
    TerrainGroupSummary,
    NeighborFreq,
    MapProfileResult,
} from './object-profile';
