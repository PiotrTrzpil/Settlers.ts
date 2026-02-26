import { BuildingType, MapObjectType, UnitType, EntityType } from '../../entity';
import { EMaterialType } from '../../economy';
import { AtlasRegion } from '../entity-texture-atlas';
import { AnimationSequence, AnimationData, ANIMATION_DEFAULTS, ANIMATION_SEQUENCES } from '../../animation';
import { mapToArray, arrayToMap } from './sprite-metadata-helpers';
import { Race } from '../../race';
import { isUnitAvailableForRace, isBuildingAvailableForRace } from '../../race-availability';

// Re-export from canonical locations and new index files
export { Race, RACE_NAMES, AVAILABLE_RACES, s4TribeToRace } from '../../race';
export { BUILDING_ICON_INDICES, MAP_OBJECT_SPRITES } from './gil-indices';
export {
    UNIT_JOB_INDICES,
    WORKER_JOB_INDICES,
    BUILDING_JOB_INDICES,
    RESOURCE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    TREE_JOB_OFFSET,
    TREE_JOBS_PER_TYPE,
    TREE_JOB_INDICES,
} from './jil-indices';

// Import for local use by functions in this file
import { BUILDING_JOB_INDICES, RESOURCE_JOB_INDICES, TREE_JOB_INDICES, UNIT_JOB_INDICES } from './jil-indices';

/** Conversion factor from sprite pixels to world-space units */
export const PIXELS_TO_WORLD = 1.0 / 32.0;

/**
 * Pin all frames' offsets to frame 0's offset so the sprite anchor stays stable
 * throughout the animation. Prevents visible "jumping" when individual frames
 * have slightly different left/top values in the original GFX data.
 */
function stabilizeFrameAnchors(frames: SpriteEntry[]): SpriteEntry[] {
    if (frames.length <= 1) return frames;
    const ref = frames[0]!;
    return frames.map(f =>
        f.offsetX === ref.offsetX && f.offsetY === ref.offsetY
            ? f
            : { ...f, offsetX: ref.offsetX, offsetY: ref.offsetY }
    );
}

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
 * Metadata for a single sprite entry in the atlas.
 * Contains both atlas coordinates and world-space sizing.
 */
export interface SpriteEntry {
    /** UV coordinates and pixel position in the atlas */
    atlasRegion: AtlasRegion;
    /** Drawing offset X from GfxImage.left, in world units */
    offsetX: number;
    /** Drawing offset Y from GfxImage.top, in world units */
    offsetY: number;
    /** Sprite width in world-space units */
    widthWorld: number;
    /** Sprite height in world-space units */
    heightWorld: number;
    /**
     * Base offset into combined palette texture for this sprite's GFX file.
     * Added to sprite's relative palette indices in the shader.
     */
    paletteBaseOffset: number;
}

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

    for (const [typeStr, jobIndex] of Object.entries(UNIT_JOB_INDICES)) {
        const unitType = Number(typeStr) as UnitType;
        // Skip negative indices (not yet identified) and units unavailable for this race
        if (jobIndex >= 0 && isUnitAvailableForRace(unitType, race)) {
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

    // SunflowerFarmerHut is stored in 13.gfx (DarkTribe file) as two separate jobs:
    // JIL #109 = construction state, JIL #110 = completed state
    if (race === Race.Trojan) {
        result[BuildingType.SunflowerFarmerHut] = {
            file: Race.DarkTribe as number,
            index: 110,
            constructionIndex: 109,
        };
    }

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
    for (const [typeStr, jobIndex] of Object.entries(TREE_JOB_INDICES)) {
        if (typeof jobIndex === 'number') {
            result[Number(typeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.MAP_OBJECTS,
                index: jobIndex,
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
 * Building sprite entries with both construction and completed states.
 */
export interface BuildingSpriteEntries {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) */
    completed: SpriteEntry | null;
}

/**
 * Animation entry containing sequence data for animated sprites.
 */
export interface AnimatedSpriteEntry {
    /** Static sprite (first frame) for non-animated rendering */
    staticSprite: SpriteEntry;
    /** Full animation data with all frames */
    animationData: AnimationData;
    /** Whether this sprite has multiple frames */
    isAnimated: boolean;
}

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 */
export class SpriteMetadataRegistry {
    /** Building sprites keyed by race → buildingType */
    private buildingsByRace: Map<number, Map<BuildingType, BuildingSpriteEntries>> = new Map();
    private mapObjects: Map<MapObjectType, SpriteEntry[]> = new Map();
    private resources: Map<EMaterialType, Map<number, SpriteEntry>> = new Map();
    /** Unit sprites keyed by race → unitType → direction */
    private unitsByRace: Map<number, Map<UnitType, Map<number, SpriteEntry>>> = new Map();
    /** Flag sprites keyed by playerIndex → frame[] */
    private flags: Map<number, SpriteEntry[]> = new Map();

    /**
     * Animated entities: shared storage for map objects/resources (race-independent).
     * Maps EntityType -> subType -> AnimatedSpriteEntry
     */
    private animatedEntities: Map<EntityType, Map<number, AnimatedSpriteEntry>> = new Map();

    /**
     * Animated entities: per-race storage for buildings and units.
     * Maps Race -> EntityType -> subType -> AnimatedSpriteEntry
     */
    private animatedByRace: Map<number, Map<EntityType, Map<number, AnimatedSpriteEntry>>> = new Map();

    /** Set of races that have building/unit sprites loaded */
    private _loadedRaces: Set<number> = new Set();

    /** Get all races that have sprites loaded */
    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    /**
     * Register sprite entries for a building type (both construction and completed).
     */
    public registerBuilding(
        type: BuildingType,
        construction: SpriteEntry | null,
        completed: SpriteEntry | null,
        race: number
    ): void {
        let raceMap = this.buildingsByRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.buildingsByRace.set(race, raceMap);
        }
        raceMap.set(type, { construction, completed });
        this._loadedRaces.add(race);
    }

    /**
     * Look up the completed sprite entry for a building type and race.
     * Falls back to any loaded race if the requested race has no sprites.
     */
    public getBuilding(type: BuildingType, race: number): SpriteEntry | null {
        return (
            this.buildingsByRace.get(race)?.get(type)?.completed ?? this.getBuildingFallback(type)?.completed ?? null
        );
    }

    /**
     * Look up the construction sprite entry for a building type and race.
     */
    public getBuildingConstruction(type: BuildingType, race: number): SpriteEntry | null {
        return (
            this.buildingsByRace.get(race)?.get(type)?.construction ??
            this.getBuildingFallback(type)?.construction ??
            null
        );
    }

    /**
     * Get both construction and completed sprites for a building type and race.
     */
    public getBuildingSprites(type: BuildingType, race: number): BuildingSpriteEntries | null {
        return this.buildingsByRace.get(race)?.get(type) ?? this.getBuildingFallback(type) ?? null;
    }

    /** Fallback: find building in any loaded race */
    private getBuildingFallback(type: BuildingType): BuildingSpriteEntries | null {
        for (const raceMap of this.buildingsByRace.values()) {
            const entry = raceMap.get(type);
            if (entry) return entry;
        }
        return null;
    }

    /**
     * Register a sprite entry for a map object type (with optional variation index).
     */
    public registerMapObject(type: MapObjectType, entry: SpriteEntry, variation: number = 0): void {
        const entries = this.mapObjects.get(type) ?? [];
        if (entries.length <= variation) {
            entries.length = variation + 1;
        }
        entries[variation] = entry;
        this.mapObjects.set(type, entries);
    }

    /**
     * Look up the sprite entry for a map object type (and optional variation).
     * Returns null if no sprite is registered for this type.
     */
    public getMapObject(type: MapObjectType, variation: number = 0): SpriteEntry | null {
        return this.mapObjects.get(type)?.[variation] ?? null;
    }

    /**
     * Register a flag sprite frame for a player index.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-23)
     */
    public registerFlag(playerIndex: number, frame: number, entry: SpriteEntry): void {
        let frames = this.flags.get(playerIndex);
        if (!frames) {
            frames = [];
            this.flags.set(playerIndex, frames);
        }
        frames[frame] = entry;
    }

    /**
     * Get a flag sprite frame for a player index and animation frame.
     */
    public getFlag(playerIndex: number, frame: number): SpriteEntry | null {
        return this.flags.get(playerIndex)?.[frame] ?? null;
    }

    /** Number of flag animation frames per player color. */
    public getFlagFrameCount(playerIndex: number): number {
        return this.flags.get(playerIndex)?.length ?? 0;
    }

    public hasFlagSprites(): boolean {
        return this.flags.size > 0;
    }

    /**
     * Register a sprite entry for a resource/material type.
     */
    public registerResource(type: EMaterialType, direction: number, entry: SpriteEntry): void {
        let dirMap = this.resources.get(type);
        if (!dirMap) {
            dirMap = new Map();
            this.resources.set(type, dirMap);
        }
        dirMap.set(direction, entry);
    }

    /**
     * Look up the sprite entry for a resource/material type.
     * Returns null if no sprite is registered for this type.
     */
    public getResource(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        const dirMap = this.resources.get(type);
        if (!dirMap) return null;
        // Try requested direction, fall back to direction 0 if not found
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT
     */
    public registerUnit(type: UnitType, direction: number, entry: SpriteEntry, race: number): void {
        let raceMap = this.unitsByRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.unitsByRace.set(race, raceMap);
        }
        let dirMap = raceMap.get(type);
        if (!dirMap) {
            dirMap = new Map();
            raceMap.set(type, dirMap);
        }
        dirMap.set(direction, entry);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the sprite entry for a unit type, direction, and race.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT (defaults to 0)
     */
    public getUnit(type: UnitType, direction: number = 0, race?: number): SpriteEntry | null {
        const dirMap =
            (race !== undefined ? this.unitsByRace.get(race)?.get(type) : undefined) ?? this.getUnitFallback(type);
        if (!dirMap) return null;
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    /** Fallback: find unit in any loaded race */
    private getUnitFallback(type: UnitType): Map<number, SpriteEntry> | undefined {
        for (const raceMap of this.unitsByRace.values()) {
            const dirMap = raceMap.get(type);
            if (dirMap) return dirMap;
        }
        return undefined;
    }

    // ========== Unified Animation API ==========

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
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity -- multi-path animation setup
    public registerAnimatedEntity(
        entityType: EntityType,
        subType: number,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: number
    ): void {
        if (directionFrames.size === 0) return;

        // Build direction map for all directions
        const directionMap = new Map<number, AnimationSequence>();
        let firstFrame: SpriteEntry | null = null;

        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;

            if (!firstFrame) {
                firstFrame = frames[0]!;
            }

            directionMap.set(direction, {
                frames,
                frameDurationMs,
                loop,
            });
        }

        if (!firstFrame) return;

        const sequences = new Map<string, Map<number, AnimationSequence>>();

        // For units, create separate idle and walk sequences:
        // - Idle (DEFAULT): only frame 0 (standing pose)
        // - Walk: frames 1+ (walk cycle, excluding standing frame)
        if (entityType === EntityType.Unit) {
            // Idle sequence: just frame 0 for each direction
            const idleDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 0) {
                    idleDirectionMap.set(direction, {
                        frames: [frames[0]!],
                        frameDurationMs,
                        loop: false, // Single frame, no loop needed
                    });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, idleDirectionMap);

            // Walk sequence: frames 1+ (skip standing frame)
            const walkDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 1) {
                    walkDirectionMap.set(direction, {
                        frames: frames.slice(1), // Skip frame 0
                        frameDurationMs,
                        loop,
                    });
                } else if (frames.length === 1) {
                    // Fallback: if only 1 frame, use it for walk too
                    walkDirectionMap.set(direction, {
                        frames,
                        frameDurationMs,
                        loop,
                    });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.WALK, walkDirectionMap);
        } else {
            // Non-units: use all frames for default sequence
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, directionMap);
        }

        const animationData: AnimationData = {
            sequences,
            defaultSequence: ANIMATION_SEQUENCES.DEFAULT,
        };

        const entry: AnimatedSpriteEntry = {
            staticSprite: firstFrame,
            animationData,
            isAnimated: directionFrames.size > 0,
        };

        // Race-specific storage for buildings and units; shared storage for everything else
        const isRaceSpecific =
            race !== undefined && (entityType === EntityType.Building || entityType === EntityType.Unit);
        if (isRaceSpecific) {
            let raceMap = this.animatedByRace.get(race);
            if (!raceMap) {
                raceMap = new Map();
                this.animatedByRace.set(race, raceMap);
            }
            let subTypeMap = raceMap.get(entityType);
            if (!subTypeMap) {
                subTypeMap = new Map();
                raceMap.set(entityType, subTypeMap);
            }
            subTypeMap.set(subType, entry);
        } else {
            let subTypeMap = this.animatedEntities.get(entityType);
            if (!subTypeMap) {
                subTypeMap = new Map();
                this.animatedEntities.set(entityType, subTypeMap);
            }
            subTypeMap.set(subType, entry);
        }
    }

    /**
     * Register an additional animation sequence on an already-registered animated entity.
     * Used to add carry-walk variants for carriers: each material type gets its own
     * sequence key (e.g. 'carry_0' for trunk) with its own set of direction frames.
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
        const entry =
            race !== undefined
                ? this.animatedByRace.get(race)?.get(entityType)?.get(subType)
                : this.animatedEntities.get(entityType)?.get(subType);
        if (!entry) return;

        const directionMap = new Map<number, AnimationSequence>();
        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;
            directionMap.set(direction, { frames: stabilizeFrameAnchors(frames), frameDurationMs, loop });
        }

        if (directionMap.size > 0) {
            entry.animationData.sequences.set(sequenceKey, directionMap);
        }
    }

    /**
     * Get animated entity data. Checks race-specific storage first (for buildings/units),
     * then falls back to shared storage (for map objects, resources).
     */
    public getAnimatedEntity(entityType: EntityType, subType: number, race?: number): AnimatedSpriteEntry | null {
        if (race !== undefined) {
            const raceEntry = this.animatedByRace.get(race)?.get(entityType)?.get(subType);
            if (raceEntry) return raceEntry;
            // Fallback: try any loaded race
            for (const raceMap of this.animatedByRace.values()) {
                const entry = raceMap.get(entityType)?.get(subType);
                if (entry) return entry;
            }
        }
        return this.animatedEntities.get(entityType)?.get(subType) ?? null;
    }

    /**
     * Check if an entity type/subtype has animation data.
     */
    public hasAnimation(entityType: EntityType, subType: number, race?: number): boolean {
        const entry = this.getAnimatedEntity(entityType, subType, race);
        return entry?.isAnimated ?? false;
    }

    /**
     * Check if any building sprites have been registered.
     */
    public hasBuildingSprites(): boolean {
        return this.buildingsByRace.size > 0;
    }

    /**
     * Check if any map object sprites have been registered.
     */
    public hasMapObjectSprites(): boolean {
        return this.mapObjects.size > 0;
    }

    /**
     * Check if any resource sprites have been registered.
     */
    public hasResourceSprites(): boolean {
        return this.resources.size > 0;
    }

    /**
     * Check if any unit sprites have been registered.
     */
    public hasUnitSprites(): boolean {
        return this.unitsByRace.size > 0;
    }

    /**
     * Get the number of registered building sprites.
     */
    public getBuildingCount(): number {
        let count = 0;
        for (const raceMap of this.buildingsByRace.values()) count += raceMap.size;
        return count;
    }

    /**
     * Get the number of registered map object sprites.
     */
    public getMapObjectCount(): number {
        return this.mapObjects.size;
    }

    /**
     * Get the number of registered unit sprites.
     */
    public getUnitCount(): number {
        let count = 0;
        for (const raceMap of this.unitsByRace.values()) count += raceMap.size;
        return count;
    }

    /**
     * Get the number of registered resource sprites.
     */
    public getResourceCount(): number {
        return this.resources.size;
    }

    /**
     * Clear all registered sprites.
     */
    public clear(): void {
        this.buildingsByRace.clear();
        this.mapObjects.clear();
        this.animatedEntities.clear();
        this.animatedByRace.clear();
        this.resources.clear();
        this.unitsByRace.clear();
        this.flags.clear();
        this._loadedRaces.clear();
    }

    /**
     * Serialize registry data for caching.
     * Converts Maps to arrays for JSON compatibility.
     */
    public serialize(): Record<string, unknown> {
        // Helper to serialize AnimatedSpriteEntry (nested AnimationData maps)
        const serializeAnimEntry = (entry: AnimatedSpriteEntry) => {
            const sequences = mapToArray(entry.animationData.sequences).map(([seqKey, dirMap]) => {
                return [seqKey, mapToArray(dirMap)] as [string, Array<[number, AnimationSequence]>];
            });
            return {
                ...entry,
                animationData: {
                    ...entry.animationData,
                    sequences,
                },
            };
        };

        // Serialize shared animated entities (map objects, resources)
        const serializedAnimatedEntities = mapToArray(this.animatedEntities).map(([entityType, subTypeMap]) => {
            return [entityType, mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)])];
        });

        // Serialize race-specific animated entities (buildings, units)
        const serializedAnimatedByRace = mapToArray(this.animatedByRace).map(([race, entityTypeMap]) => {
            const entityTypes = mapToArray(entityTypeMap).map(([entityType, subTypeMap]) => {
                return [
                    entityType,
                    mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)]),
                ];
            });
            return [race, entityTypes];
        });

        // Serialize per-race buildings
        const serializedBuildings = mapToArray(this.buildingsByRace).map(([race, typeMap]) => [
            race,
            mapToArray(typeMap),
        ]);

        // Serialize per-race units
        const serializedUnits = mapToArray(this.unitsByRace).map(([race, typeMap]) => [
            race,
            mapToArray(typeMap).map(([k, v]) => [k, mapToArray(v)]),
        ]);

        return {
            buildingsByRace: serializedBuildings,
            mapObjects: mapToArray(this.mapObjects),
            resources: mapToArray(this.resources).map(([k, v]) => [k, mapToArray(v)]),
            unitsByRace: serializedUnits,
            flags: mapToArray(this.flags),
            animatedEntities: serializedAnimatedEntities,
            animatedByRace: serializedAnimatedByRace,
            loadedRaces: [...this._loadedRaces],
        };
    }

    /** Helper to deserialize an AnimatedSpriteEntry from cached data */
    private static deserializeAnimEntry(entryData: any): AnimatedSpriteEntry {
        const sequences = new Map<string, Map<number, AnimationSequence>>();
        if (entryData.animationData?.sequences) {
            for (const [seqKey, dirArr] of entryData.animationData.sequences) {
                sequences.set(seqKey, arrayToMap(dirArr));
            }
        }
        return {
            ...entryData,
            animationData: { ...entryData.animationData, sequences },
        };
    }

    /** Helper to deserialize legacy animated entity format into unified map */
    private static deserializeLegacyAnimated(
        legacyData: Array<[number, any]> | undefined,
        entityType: EntityType,
        targetMap: Map<EntityType, Map<number, AnimatedSpriteEntry>>
    ): void {
        if (!legacyData) return;
        let subTypeMap = targetMap.get(entityType);
        if (!subTypeMap) {
            subTypeMap = new Map();
            targetMap.set(entityType, subTypeMap);
        }
        for (const [type, entryData] of legacyData) {
            subTypeMap.set(type, SpriteMetadataRegistry.deserializeAnimEntry(entryData));
        }
    }

    /**
     * Deserialize registry data from cache.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity -- legacy format compat requires branching
    public static deserialize(data: any): SpriteMetadataRegistry {
        const registry = new SpriteMetadataRegistry();

        // Deserialize per-race buildings (new format)
        if (data.buildingsByRace) {
            for (const [race, typeArr] of data.buildingsByRace) {
                registry.buildingsByRace.set(race, arrayToMap(typeArr));
                registry._loadedRaces.add(race);
            }
        } else if (data.buildings) {
            // Legacy: single-race buildings stored without race key — treat as Race.Roman (10)
            registry.buildingsByRace.set(10, arrayToMap(data.buildings));
            registry._loadedRaces.add(10);
        }

        if (data.mapObjects) registry.mapObjects = arrayToMap(data.mapObjects);
        if (data.flags) registry.flags = arrayToMap(data.flags);

        if (data.resources) {
            registry.resources = new Map(
                (data.resources as Array<[EMaterialType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [
                    k,
                    arrayToMap(v),
                ])
            );
        }

        // Deserialize per-race units (new format)
        if (data.unitsByRace) {
            for (const [race, typeArr] of data.unitsByRace) {
                registry.unitsByRace.set(
                    race,
                    new Map(
                        (typeArr as Array<[UnitType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [k, arrayToMap(v)])
                    )
                );
                registry._loadedRaces.add(race);
            }
        } else if (data.units) {
            // Legacy: single-race units — treat as Race.Roman (10)
            registry.unitsByRace.set(
                10,
                new Map(
                    (data.units as Array<[UnitType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [k, arrayToMap(v)])
                )
            );
            registry._loadedRaces.add(10);
        }

        // Deserialize shared animated entities (map objects, resources)
        if (data.animatedEntities) {
            for (const [entityType, subTypeArr] of data.animatedEntities) {
                const subTypeMap = new Map<number, AnimatedSpriteEntry>();
                for (const [subType, entryData] of subTypeArr) {
                    subTypeMap.set(subType, SpriteMetadataRegistry.deserializeAnimEntry(entryData));
                }
                registry.animatedEntities.set(entityType, subTypeMap);
            }
        }

        // Deserialize race-specific animated entities (buildings, units)
        if (data.animatedByRace) {
            for (const [race, entityTypeArr] of data.animatedByRace) {
                const entityTypeMap = new Map<EntityType, Map<number, AnimatedSpriteEntry>>();
                for (const [entityType, subTypeArr] of entityTypeArr) {
                    const subTypeMap = new Map<number, AnimatedSpriteEntry>();
                    for (const [subType, entryData] of subTypeArr) {
                        subTypeMap.set(subType, SpriteMetadataRegistry.deserializeAnimEntry(entryData));
                    }
                    entityTypeMap.set(entityType, subTypeMap);
                }
                registry.animatedByRace.set(race, entityTypeMap);
            }
        }

        // Legacy support: deserialize old format if present
        SpriteMetadataRegistry.deserializeLegacyAnimated(
            data.animatedBuildings,
            EntityType.Building,
            registry.animatedEntities
        );
        SpriteMetadataRegistry.deserializeLegacyAnimated(
            data.animatedMapObjects,
            EntityType.MapObject,
            registry.animatedEntities
        );
        SpriteMetadataRegistry.deserializeLegacyAnimated(
            data.animatedUnits,
            EntityType.Unit,
            registry.animatedEntities
        );

        if (data.loadedRaces) {
            for (const race of data.loadedRaces) registry._loadedRaces.add(race);
        }

        return registry;
    }
}
