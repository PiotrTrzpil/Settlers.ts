import { BuildingType, MapObjectType } from '../entity';
import { AtlasRegion } from './entity-texture-atlas';

/** Conversion factor from sprite pixels to world-space units */
export const PIXELS_TO_WORLD = 1.0 / 64.0;

/**
 * Available races/civilizations with their GFX file numbers.
 */
export enum Race {
    Roman = 10,
    Viking = 11,
    Mayan = 12,
    Trojan = 13,
    // Dark Tribe uses file 14
}

/** Display names for races */
export const RACE_NAMES: Record<Race, string> = {
    [Race.Roman]: 'Roman',
    [Race.Viking]: 'Viking',
    [Race.Mayan]: 'Mayan',
    [Race.Trojan]: 'Trojan',
};

/** List of all available races for UI */
export const AVAILABLE_RACES: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan];

/**
 * GFX file numbers for different content types.
 */
export const GFX_FILE_NUMBERS = {
    /** Map objects (trees, stones, resources) */
    MAP_OBJECTS: 20,
    /** Landscape textures */
    LANDSCAPE: 2,
} as const;

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
}

/**
 * Direction indices for building sprites.
 * D0 = construction/ghost, D1 = completed building.
 */
export const BUILDING_DIRECTION = {
    /** Partially constructed / ghost preview */
    CONSTRUCTION: 0,
    /** Completed building */
    COMPLETED: 1,
} as const;

/**
 * Defines the GFX file and sprite index for a building type.
 */
export interface BuildingSpriteInfo {
    /** GFX file number (e.g., 10 for 10.gfx) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Mapping from BuildingType to JIL job index.
 * The job index is the same across all race files - only the GFX file number differs.
 * These indices map to building sprites via JIL -> DIL -> GIL -> GFX.
 */
export const BUILDING_JOB_INDICES: Partial<Record<BuildingType, number>> = {
    // Job indices for buildings - same across all races
    // These can be verified/edited via the /building-sprites view
    // or by browsing JIL files in /jil-view
    [BuildingType.Lumberjack]:    1,
    [BuildingType.Stonecutter]:   2,
    [BuildingType.Sawmill]:       3,
    [BuildingType.Forester]:      4,
    [BuildingType.Farm]:          5,
    [BuildingType.Fishery]:       6,
    [BuildingType.Windmill]:      7,
    [BuildingType.Bakery]:        8,
    [BuildingType.PigFarm]:       9,
    [BuildingType.Slaughterhouse]: 10,
    [BuildingType.Waterworks]:    11,
    [BuildingType.CoalMine]:      12,
    [BuildingType.IronMine]:      13,
    [BuildingType.GoldMine]:      14,
    [BuildingType.IronSmelter]:   15,
    [BuildingType.GoldSmelter]:   16,
    [BuildingType.WeaponSmith]:   17,
    [BuildingType.ToolSmith]:     18,
    [BuildingType.Warehouse]:     19,
    [BuildingType.Guardhouse]:    20,
    [BuildingType.Barrack]:       21,
    [BuildingType.LivingHouse]:   22,
    [BuildingType.Tower]:         23,
    [BuildingType.Winegrower]:    24,
};

/**
 * Get the building sprite map for a specific race.
 * Returns a map of BuildingType -> { file, index } using the race's GFX file number.
 */
export function getBuildingSpriteMap(race: Race): Partial<Record<BuildingType, BuildingSpriteInfo>> {
    const fileNum = race as number;
    const result: Partial<Record<BuildingType, BuildingSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
        if (jobIndex !== undefined) {
            result[Number(typeStr) as BuildingType] = {
                file: fileNum,
                index: jobIndex,
            };
        }
    }

    return result;
}

/** Default building sprite map using Roman race */
export const BUILDING_SPRITE_MAP = getBuildingSpriteMap(Race.Roman);

/**
 * Mapping from MapObjectType to GIL sprite index (direct index, not job-based).
 * Map objects typically use direct GIL indexing rather than JIL job indexing.
 * These indices need to be verified by visually inspecting the GFX files.
 */
export const MAP_OBJECT_SPRITE_INDICES: Partial<Record<MapObjectType, number>> = {
    // Trees - indices to be determined by visual inspection of GFX file 20
    [MapObjectType.TreePine]: 0,
    [MapObjectType.TreeOak]: 1,
    [MapObjectType.TreeBirch]: 2,
    [MapObjectType.TreePalm]: 3,
    [MapObjectType.TreeCypress]: 4,
    [MapObjectType.TreeDead]: 5,

    // Stones
    [MapObjectType.StoneSmall]: 10,
    [MapObjectType.StoneMedium]: 11,
    [MapObjectType.StoneLarge]: 12,

    // Plants
    [MapObjectType.Bush]: 30,
    [MapObjectType.Mushroom]: 31,
};

/**
 * Sprite information for a map object type.
 */
export interface MapObjectSpriteInfo {
    /** GFX file number */
    file: number;
    /** GIL sprite index (direct) */
    index: number;
    /** Optional: palette index if different from sprite index */
    paletteIndex?: number;
}

/**
 * Get the map object sprite map.
 */
export function getMapObjectSpriteMap(): Partial<Record<MapObjectType, MapObjectSpriteInfo>> {
    const result: Partial<Record<MapObjectType, MapObjectSpriteInfo>> = {};

    for (const [typeStr, spriteIndex] of Object.entries(MAP_OBJECT_SPRITE_INDICES)) {
        if (spriteIndex !== undefined) {
            result[Number(typeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.MAP_OBJECTS,
                index: spriteIndex,
            };
        }
    }

    return result;
}

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 */
export class SpriteMetadataRegistry {
    private buildings: Map<BuildingType, SpriteEntry> = new Map();
    private mapObjects: Map<MapObjectType, SpriteEntry> = new Map();

    /**
     * Register a sprite entry for a building type.
     */
    public registerBuilding(type: BuildingType, entry: SpriteEntry): void {
        this.buildings.set(type, entry);
    }

    /**
     * Look up the sprite entry for a building type.
     * Returns null if no sprite is registered for this type.
     */
    public getBuilding(type: BuildingType): SpriteEntry | null {
        return this.buildings.get(type) ?? null;
    }

    /**
     * Register a sprite entry for a map object type.
     */
    public registerMapObject(type: MapObjectType, entry: SpriteEntry): void {
        this.mapObjects.set(type, entry);
    }

    /**
     * Look up the sprite entry for a map object type.
     * Returns null if no sprite is registered for this type.
     */
    public getMapObject(type: MapObjectType): SpriteEntry | null {
        return this.mapObjects.get(type) ?? null;
    }

    /**
     * Check if any building sprites have been registered.
     */
    public hasBuildingSprites(): boolean {
        return this.buildings.size > 0;
    }

    /**
     * Check if any map object sprites have been registered.
     */
    public hasMapObjectSprites(): boolean {
        return this.mapObjects.size > 0;
    }

    /**
     * Get the number of registered building sprites.
     */
    public getBuildingCount(): number {
        return this.buildings.size;
    }

    /**
     * Get the number of registered map object sprites.
     */
    public getMapObjectCount(): number {
        return this.mapObjects.size;
    }

    /**
     * Clear all registered sprites.
     */
    public clear(): void {
        this.buildings.clear();
        this.mapObjects.clear();
    }
}
