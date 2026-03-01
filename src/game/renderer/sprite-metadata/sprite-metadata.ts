import { BuildingType, UnitType, EntityType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EMaterialType } from '../../economy';
import { ANIMATION_DEFAULTS } from '../../animation';
import { Race } from '../../race';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '../../race-availability';

// Re-export from canonical locations and new index files
export { Race, RACE_NAMES, AVAILABLE_RACES, s4TribeToRace, loadSavedRace, saveSavedRace } from '../../race';
export { BUILDING_ICON_INDICES, MAP_OBJECT_SPRITES } from './gil-indices';
export { GilSpriteManifest } from './gil-sprite-manifest';
export {
    SETTLER_JOB_INDICES,
    SETTLER_KEY_TO_UNIT_TYPE,
    UNIT_BASE_JOB_INDICES,
    BUILDING_JOB_INDICES,
    BUILDING_OVERLAY_JIL_INDICES,
    RESOURCE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    TREE_JOB_OFFSET,
    TREE_JOBS_PER_TYPE,
    TREE_JOB_INDICES,
    type SettlerAnimData,
    collectFieldsByPrefix,
    collectFieldsWithSuffix,
    type SuffixedField,
    parseMaterialSuffix,
    getFirstFieldByPrefix,
} from './jil-indices';

// Import for local use by functions in this file
import { BUILDING_JOB_INDICES, RESOURCE_JOB_INDICES, UNIT_BASE_JOB_INDICES, TREE_JOB_INDICES } from './jil-indices';

// Re-export category types and entries
export type { SpriteEntry, AnimatedSpriteEntry } from './types';
export type { BuildingSpriteEntries } from './categories/building-sprite-category';

// Import internal types for use in this file
import type { SpriteEntry, AnimatedSpriteEntry } from './types';
import type { BuildingSpriteEntries } from './categories/building-sprite-category';

import {
    BuildingSpriteCategory,
    UnitSpriteCategory,
    MapObjectSpriteCategory,
    ResourceSpriteCategory,
    DecorationSpriteCategory,
    OverlaySpriteCategory,
    AnimatedEntityCategory,
} from './categories';
import { SpriteMetadataSerializer } from './sprite-metadata-serializer';

/** Conversion factor from sprite pixels to world-space units */
export const PIXELS_TO_WORLD = 1.0 / 32.0;

/**
 * GFX file numbers for different content types.
 */
export const GFX_FILE_NUMBERS = {
    /** Landscape textures */
    LANDSCAPE: 2,
    /** Resource sprites (logs, piles, goods on ground) */
    RESOURCES: 3,
    /** Map objects (trees, stones, plants, decorations) */
    MAP_OBJECTS: 5,
    /** UI elements including building icons */
    UI: 9,
} as const;

/**
 * GFX file numbers for building icons by race.
 * These contain UI icons for the building palette.
 */
export const BUILDING_ICON_FILE_NUMBERS: Record<Race, number> = {
    [Race.Roman]: 9,
    [Race.Viking]: 19,
    [Race.Mayan]: 29,
    [Race.DarkTribe]: 9, // Fallback to Roman icons
    [Race.Trojan]: 39,
};

/**
 * GFX file numbers for settler/unit sprites by race.
 * These are separate from building sprites.
 */
export const SETTLER_FILE_NUMBERS: Record<Race, number> = {
    [Race.Roman]: 20,
    [Race.Viking]: 21,
    [Race.Mayan]: 22,
    [Race.DarkTribe]: 23,
    [Race.Trojan]: 24,
};

/**
 * Direction indices for unit sprites in DIL files.
 * Units have 6 directions matching the hex grid.
 */
export const UNIT_DIRECTION = {
    /** Facing north-east (D0) */
    NORTH_EAST: 0,
    /** Facing east (D1) */
    EAST: 1,
    /** Facing south-east (D2) */
    SOUTH_EAST: 2,
    /** Facing south-west (D3) */
    SOUTH_WEST: 3,
    /** Facing west (D4) */
    WEST: 4,
    /** Facing north-west (D5) */
    NORTH_WEST: 5,
} as const;

export const NUM_UNIT_DIRECTIONS = 6;

/**
 * Direction indices for building sprites in DIL files.
 * D0 = construction/ghost, D1 = completed building.
 */
export const BUILDING_DIRECTION = {
    /** Partially constructed / ghost preview (D0) */
    CONSTRUCTION: 0,
    /** Completed building (D1) */
    COMPLETED: 1,
} as const;

/**
 * Building sprite info with both construction and completed GIL frame indices.
 * These are looked up via JIL job -> DIL direction -> GIL frame.
 */
export interface BuildingSpriteFrames {
    /** JIL job index for this building */
    job: number;
    /** GIL frame index for construction/ghost state (from DIL D0) */
    construction: number;
    /** GIL frame index for completed state (from DIL D1) */
    completed: number;
}

/**
 * Complete building sprite mappings with both construction and completed frame indices.
 * Job index is the JIL entry, construction/completed are the resolved GIL frame indices.
 */
export const BUILDING_SPRITE_FRAMES: Partial<Record<BuildingType, BuildingSpriteFrames>> = {
    // TODO: Fill in GIL frame indices from JIL viewer
    // Format: { job: JIL_index, construction: D0_GIL_frame, completed: D1_GIL_frame }
};

/**
 * Defines the GFX file and sprite index for a building type.
 */
export interface BuildingSpriteInfo {
    /** GFX file number (e.g., 10 for 10.gfx) */
    file: number;
    /** JIL job index within the GFX file (used for completed state, or both states if constructionIndex is absent) */
    index: number;
    /** Optional separate JIL job index for the construction state (when stored as a separate job entry) */
    constructionIndex?: number;
}

/**
 * Sprite information for a resource type (dropped goods).
 */
export interface ResourceSpriteInfo {
    /** GFX file number (always file 3 for resources) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Get the resource sprite map.
 * Resources use JIL job indices from file 3.gfx.
 */
export function getResourceSpriteMap(): Partial<Record<EMaterialType, ResourceSpriteInfo>> {
    const result: Partial<Record<EMaterialType, ResourceSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
        result[Number(typeStr) as EMaterialType] = {
            file: GFX_FILE_NUMBERS.RESOURCES,
            index: jobIndex,
        };
    }

    return result;
}

/**
 * Sprite information for a unit type.
 */
export interface UnitSpriteInfo {
    /** GFX file number (race-specific: 20-24) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Get the unit sprite map for a specific race.
 * Returns a map of UnitType -> { file, index } using the race's settler file number.
 */
export function getUnitSpriteMap(race: Race): Partial<Record<UnitType, UnitSpriteInfo>> {
    const fileNum = SETTLER_FILE_NUMBERS[race];
    const result: Partial<Record<UnitType, UnitSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(UNIT_BASE_JOB_INDICES)) {
        const unitType = Number(typeStr) as UnitType;
        if (isUnitAvailableForRace(unitType, race)) {
            result[unitType] = {
                file: fileNum,
                index: jobIndex,
            };
        }
    }

    return result;
}

/**
 * Get the building sprite map for a specific race.
 * Returns a map of BuildingType -> { file, index } using the race's GFX file number.
 */
export function getBuildingSpriteMap(race: Race): Partial<Record<BuildingType, BuildingSpriteInfo>> {
    const fileNum = race as number;
    const result: Partial<Record<BuildingType, BuildingSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
        const buildingType = Number(typeStr) as BuildingType;
        if (!isBuildingAvailableForRace(buildingType, race)) continue;
        result[buildingType] = {
            file: fileNum,
            index: jobIndex,
        };
    }

    // SunflowerFarmerHut uses regular index like other buildings (S4BuildingType = 82)

    return result;
}

/** Default building sprite map using Roman race */
export const BUILDING_SPRITE_MAP = getBuildingSpriteMap(Race.Roman);

/**
 * Sprite information for a map object type.
 */
export interface MapObjectSpriteInfo {
    /** GFX file number */
    file: number;
    /** Base GIL sprite index (start of the tree block) */
    index: number;
    /** Optional: palette index if different from sprite index */
    paletteIndex?: number;
}

/**
 * Mapping from MapObjectType (Resource) to EMaterialType for sprite lookup.
 * This allows using resource sprites (pile of ore) for map resources.
 */
const RESOURCE_MAP_OBJECTS: Partial<Record<MapObjectType, EMaterialType>> = {
    [MapObjectType.ResourceCoal]: EMaterialType.COAL,
    [MapObjectType.ResourceGold]: EMaterialType.GOLDORE,
    [MapObjectType.ResourceIron]: EMaterialType.IRONORE,
    // ResourceStone uses GIL-based depletion sprites (loaded in loadStoneSprites), not resource JIL
    [MapObjectType.ResourceSulfur]: EMaterialType.SULFUR,
};

/**
 * Get the map object sprite map.
 * Includes both landscape objects (trees) and resource deposits.
 */
export function getMapObjectSpriteMap(): Partial<Record<MapObjectType, MapObjectSpriteInfo>> {
    const result: Partial<Record<MapObjectType, MapObjectSpriteInfo>> = {};

    // Standard map objects (Trees, etc.) from file 5
    for (const [typeStr, variants] of Object.entries(TREE_JOB_INDICES)) {
        if (Array.isArray(variants) && variants.length > 0) {
            result[Number(typeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.MAP_OBJECTS,
                index: variants[0]!,
            };
        }
    }

    // Resource deposits using resource sprites from file 3
    for (const [moTypeStr, matType] of Object.entries(RESOURCE_MAP_OBJECTS)) {
        const jobIndex = RESOURCE_JOB_INDICES[matType];
        if (jobIndex !== undefined) {
            result[Number(moTypeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.RESOURCES,
                index: jobIndex,
            };
        }
    }

    return result;
}

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 *
 * Acts as a facade delegating to per-domain category instances.
 */
export class SpriteMetadataRegistry {
    private readonly buildings = new BuildingSpriteCategory();
    private readonly units = new UnitSpriteCategory();
    private readonly mapObjectsCategory = new MapObjectSpriteCategory();
    private readonly resourcesCategory = new ResourceSpriteCategory();
    private readonly decoration = new DecorationSpriteCategory();
    private readonly overlays = new OverlaySpriteCategory();
    private readonly animated = new AnimatedEntityCategory();

    private readonly _loadedRaces: Set<number> = new Set();

    /** Get all races that have sprites loaded */
    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    // ========================================================================
    // Buildings
    // ========================================================================

    /**
     * Register sprite entries for a building type (both construction and completed).
     */
    public registerBuilding(
        type: BuildingType,
        construction: SpriteEntry | null,
        completed: SpriteEntry | null,
        race: number
    ): void {
        this.buildings.register(type, construction, completed, race);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the completed sprite entry for a building type and race.
     * Falls back to any loaded race if the requested race has no sprites.
     */
    public getBuilding(type: BuildingType, race: number): SpriteEntry | null {
        return this.buildings.getCompleted(type, race);
    }

    /**
     * Look up the construction sprite entry for a building type and race.
     */
    public getBuildingConstruction(type: BuildingType, race: number): SpriteEntry | null {
        return this.buildings.getConstruction(type, race);
    }

    /**
     * Get both construction and completed sprites for a building type and race.
     */
    public getBuildingSprites(type: BuildingType, race: number): BuildingSpriteEntries | null {
        return this.buildings.getSprites(type, race);
    }

    // ========================================================================
    // Map Objects
    // ========================================================================

    /**
     * Register a sprite entry for a map object type (with optional variation index).
     */
    public registerMapObject(type: MapObjectType, entry: SpriteEntry, variation: number = 0): void {
        this.mapObjectsCategory.register(type, entry, variation);
    }

    /**
     * Look up the sprite entry for a map object type (and optional variation).
     * Returns null if no sprite is registered for this type.
     */
    public getMapObject(type: MapObjectType, variation: number = 0): SpriteEntry | null {
        return this.mapObjectsCategory.get(type, variation);
    }

    // ========================================================================
    // Flags & Territory Dots
    // ========================================================================

    /**
     * Register a flag sprite frame for a player index.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-23)
     */
    public registerFlag(playerIndex: number, frame: number, entry: SpriteEntry): void {
        this.decoration.registerFlag(playerIndex, frame, entry);
    }

    /**
     * Get a flag sprite frame for a player index and animation frame.
     */
    public getFlag(playerIndex: number, frame: number): SpriteEntry | null {
        return this.decoration.getFlag(playerIndex, frame);
    }

    /** Number of flag animation frames per player color. */
    public getFlagFrameCount(playerIndex: number): number {
        return this.decoration.getFlagFrameCount(playerIndex);
    }

    public hasFlagSprites(): boolean {
        return this.decoration.hasFlagSprites();
    }

    /** Register a territory dot sprite for a player index (0-7). */
    public registerTerritoryDot(playerIndex: number, entry: SpriteEntry): void {
        this.decoration.registerTerritoryDot(playerIndex, entry);
    }

    /** Get the territory dot sprite for a player index. */
    public getTerritoryDot(playerIndex: number): SpriteEntry | null {
        return this.decoration.getTerritoryDot(playerIndex);
    }

    public hasTerritoryDotSprites(): boolean {
        return this.decoration.hasTerritoryDotSprites();
    }

    // ========================================================================
    // Overlay sprites
    // ========================================================================

    /**
     * Register sprite frames for a building overlay.
     * @param gfxFile GFX file number
     * @param jobIndex JIL job index
     * @param directionIndex DIL direction index (usually 0)
     * @param frames All animation frames for this overlay
     */
    public registerOverlayFrames(
        gfxFile: number,
        jobIndex: number,
        directionIndex: number,
        frames: SpriteEntry[]
    ): void {
        this.overlays.register(gfxFile, jobIndex, directionIndex, frames);
    }

    /**
     * Get loaded overlay sprite frames.
     * Returns null if the overlay hasn't been loaded.
     */
    public getOverlayFrames(gfxFile: number, jobIndex: number, directionIndex: number): readonly SpriteEntry[] | null {
        return this.overlays.get(gfxFile, jobIndex, directionIndex);
    }

    // ========================================================================
    // Resources
    // ========================================================================

    /**
     * Register a sprite entry for a resource/material type.
     */
    public registerResource(type: EMaterialType, direction: number, entry: SpriteEntry): void {
        this.resourcesCategory.register(type, direction, entry);
    }

    /**
     * Look up the sprite entry for a resource/material type.
     * Returns null if no sprite is registered for this type.
     */
    public getResource(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        return this.resourcesCategory.get(type, direction);
    }

    // ========================================================================
    // Units
    // ========================================================================

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT
     */
    public registerUnit(type: UnitType, direction: number, entry: SpriteEntry, race: number): void {
        this.units.register(type, direction, entry, race);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the sprite entry for a unit type, direction, and race.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT (defaults to 0)
     */
    public getUnit(type: UnitType, direction: number = 0, race?: number): SpriteEntry | null {
        return this.units.get(type, direction, race);
    }

    // ========================================================================
    // Unified Animation API
    // ========================================================================

    /**
     * Register an animated entity with multiple directions and frames.
     * This is the unified method that replaces registerAnimatedBuilding,
     * registerAnimatedMapObject, and registerAnimatedUnit.
     *
     * @param entityType The entity type (Building, Unit, MapObject, etc.)
     * @param subType The specific type (BuildingType, UnitType, etc.)
     * @param directionFrames Map of direction index -> array of frames
     * @param frameDurationMs Duration per frame in milliseconds
     * @param loop Whether the animation loops
     */
    public registerAnimatedEntity(
        entityType: EntityType,
        subType: number,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: number
    ): void {
        this.animated.register(entityType, subType, directionFrames, frameDurationMs, loop, race);
    }

    /**
     * Register an additional animation sequence on an already-registered animated entity.
     * Used to add carry-walk variants for carriers: each material type gets its own
     * sequence key (e.g. 'carry.log' for logs) with its own set of direction frames.
     *
     * The entity must already be registered via registerAnimatedEntity.
     */
    public registerAnimationSequence(
        entityType: EntityType,
        subType: number,
        sequenceKey: string,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: number
    ): void {
        this.animated.registerSequence(entityType, subType, sequenceKey, directionFrames, frameDurationMs, loop, race);
    }

    /**
     * Get animated entity data. Checks race-specific storage first (for buildings/units),
     * then falls back to shared storage (for map objects, resources).
     */
    public getAnimatedEntity(entityType: EntityType, subType: number, race?: number): AnimatedSpriteEntry | null {
        return this.animated.getEntry(entityType, subType, race);
    }

    /**
     * Check if an entity type/subtype has animation data.
     */
    public hasAnimation(entityType: EntityType, subType: number, race?: number): boolean {
        return this.animated.hasAnimation(entityType, subType, race);
    }

    // ========================================================================
    // Presence checks and counts
    // ========================================================================

    /** Check if any building sprites have been registered. */
    public hasBuildingSprites(): boolean {
        return this.buildings.hasSprites();
    }

    /** Check if any map object sprites have been registered. */
    public hasMapObjectSprites(): boolean {
        return this.mapObjectsCategory.hasSprites();
    }

    /** Check if any resource sprites have been registered. */
    public hasResourceSprites(): boolean {
        return this.resourcesCategory.hasSprites();
    }

    /** Check if any unit sprites have been registered. */
    public hasUnitSprites(): boolean {
        return this.units.hasSprites();
    }

    /** Get the number of registered building sprites. */
    public getBuildingCount(): number {
        return this.buildings.getCount();
    }

    /** Get the number of registered map object sprites. */
    public getMapObjectCount(): number {
        return this.mapObjectsCategory.getCount();
    }

    /** Get the number of registered unit sprites. */
    public getUnitCount(): number {
        return this.units.getCount();
    }

    /** Get the number of registered resource sprites. */
    public getResourceCount(): number {
        return this.resourcesCategory.getCount();
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /** Clear all registered sprites. */
    public clear(): void {
        this.buildings.clear();
        this.mapObjectsCategory.clear();
        this.resourcesCategory.clear();
        this.units.clear();
        this.decoration.clear();
        this.overlays.clear();
        this.animated.clear();
        this._loadedRaces.clear();
    }

    // ========================================================================
    // Serialization
    // ========================================================================

    /**
     * Serialize registry data for caching.
     * Converts Maps to arrays for JSON compatibility.
     */
    public serialize(): Record<string, unknown> {
        return SpriteMetadataSerializer.serialize(
            this.buildings,
            this.units,
            this.mapObjectsCategory,
            this.resourcesCategory,
            this.decoration,
            this.animated,
            this._loadedRaces
        );
    }

    /**
     * Deserialize registry data from cache.
     */
    public static deserialize(data: any): SpriteMetadataRegistry {
        const registry = new SpriteMetadataRegistry();
        const result = SpriteMetadataSerializer.deserialize(data);

        for (const [race, typeMap] of result.buildings.getRaceMap()) {
            registry.buildings.setRaceEntry(race, typeMap);
        }
        for (const [race, typeMap] of result.units.getRaceMap()) {
            registry.units.setRaceEntry(race, typeMap);
        }
        registry.mapObjectsCategory.setEntries(result.mapObjects.getEntries());
        registry.resourcesCategory.setEntries(result.resources.getEntries());
        registry.decoration.setFlagsMap(result.decoration.getFlagsMap());
        registry.decoration.setTerritoryDotsMap(result.decoration.getTerritoryDotsMap());
        for (const [entityType, subTypeMap] of result.animated.getSharedEntities()) {
            registry.animated.setSharedEntry(entityType, subTypeMap);
        }
        for (const [race, entityTypeMap] of result.animated.getByRace()) {
            for (const [entityType, subTypeMap] of entityTypeMap) {
                registry.animated.setByRaceEntry(race, entityType, subTypeMap);
            }
        }
        for (const race of result.loadedRaces) registry._loadedRaces.add(race);

        return registry;
    }
}
