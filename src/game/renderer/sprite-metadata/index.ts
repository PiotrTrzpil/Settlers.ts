/**
 * Sprite Metadata Module
 *
 * Maps game data (buildings, units, resources, map objects) to sprite coordinates,
 * animation sequences, and atlas regions. This is purely data — no rendering logic.
 *
 * Public API:
 * - Constants: PIXELS_TO_WORLD, GFX_FILE_NUMBERS, SETTLER_FILE_NUMBERS
 * - Race: Race enum, formatRace, AVAILABLE_RACES
 * - Building sprites: BUILDING_ICON_INDICES, BUILDING_SPRITE_FRAMES, getBuildingSpriteMap, etc.
 * - Unit sprites: SETTLER_JOB_INDICES, UNIT_BASE_JOB_INDICES, getUnitSpriteMap, etc.
 * - Resource sprites: RESOURCE_JOB_INDICES, getResourceSpriteMap, etc.
 * - Map object sprites: MAP_OBJECT_SPRITES (GIL), TREE_JOB_INDICES (JIL), getMapObjectSpriteMap, etc.
 * - Registry: SpriteMetadataRegistry
 *
 * @module renderer/sprite-metadata
 */
export {
    // Constants
    PIXELS_TO_WORLD,

    // Race enum and data
    Race,
    RACE_GFX_FILE,
    formatRace,
    AVAILABLE_RACES,
    s4TribeToRace,
    loadSavedRace,
    saveSavedRace,

    // GFX file numbers
    GFX_FILE_NUMBERS,

    // Building data
    BUILDING_ICON_INDICES,
    BUILDING_ICON_FILE_NUMBERS,
    BUILDING_DIRECTION,
    type BuildingSpriteFrames,
    BUILDING_SPRITE_FRAMES,
    type BuildingSpriteInfo,
    BUILDING_JOB_INDICES,
    OVERLAY_DIRECTION_BASE,
    getBuildingSpriteMap,

    // Unit data
    SETTLER_FILE_NUMBERS,
    UNIT_DIRECTION,
    NUM_UNIT_DIRECTIONS,
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    UNIT_BASE_JOB_INDICES,
    type SettlerAnimData,
    stripXmlPrefix,
    UNIT_XML_PREFIX,
    type UnitSpriteInfo,
    getUnitSpriteMap,

    // Resource data
    RESOURCE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    type ResourceSpriteInfo,
    getGoodSpriteMap as getResourceSpriteMap,

    // Tree/MapObject data
    TREE_JOB_OFFSET,
    TREE_JOBS_PER_TYPE,
    TREE_JOB_INDICES,
    DARK_TREE_JOB_INDICES,
    DARK_TREE_STATIC_JOB_INDICES,
    type JilFrameSkip,
    applyJilFrameSkips,
    DARK_TRIBE_TREE_JOBS,
    SEA_ROCK_JOBS,
    TERRITORY_DOT_JOB,
    RESOURCE_SIGN_JOBS,
    type MapObjectSpriteInfo,
    getMapObjectSpriteMap,
    MAP_OBJECT_SPRITES,

    // Sprite entries
    type SpriteEntry,
    type AnimatedSpriteEntry,

    // Registry
    SpriteMetadataRegistry,
} from './sprite-metadata';
