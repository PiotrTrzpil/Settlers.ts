export { loadMapData, getMapPathFromArgs, type MapRawData } from './map-data-loader';
export {
    getGroundTypeName,
    getTerrainGroup,
    DARK_GROUND_TYPES,
    TERRAIN_GROUPS,
    type TerrainGroup,
} from './ground-type-names';
export { buildObjectProfiles, buildCategorySummaries, buildTerrainGroupSummaries } from './profile-builder';
export { printFullReport } from './formatters';
export { writeYamlReport } from './yaml-writer';
export type { ObjectProfile, HeightStats, CategorySummary, TerrainGroupSummary } from './object-profile';
