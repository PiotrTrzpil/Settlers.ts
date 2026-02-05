import { BuildingType, MapObjectType } from '../entity';
import { EMaterialType } from '../economy/material-type';
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
    DarkTribe = 13,  // Uses different building mappings
    Trojan = 14,
}

/** Display names for races */
export const RACE_NAMES: Record<Race, string> = {
    [Race.Roman]: 'Roman',
    [Race.Viking]: 'Viking',
    [Race.Mayan]: 'Mayan',
    [Race.DarkTribe]: 'Dark Tribe',
    [Race.Trojan]: 'Trojan',
};

/** List of all available races for UI (excludes DarkTribe which has different mappings) */
export const AVAILABLE_RACES: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan];

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
 * Direct GIL indices for building icons in the UI palette, per race.
 * Each entry has [unselected, selected] indices.
 * Mapped from the icon GFX files (9.gfx for Roman, 19.gfx for Viking, etc.)
 */
export const BUILDING_ICON_INDICES: Record<Race, Partial<Record<BuildingType, [number, number]>>> = {
    [Race.Roman]: {
        [BuildingType.Lumberjack]: [828, 833],
    },
    [Race.Viking]: {
        [BuildingType.Lumberjack]: [772, 773],
    },
    [Race.Mayan]: {
        [BuildingType.Lumberjack]: [776, 806],
    },
    [Race.DarkTribe]: {},
    [Race.Trojan]: {},
};

/**
 * GFX file numbers for building icons by race.
 * These contain UI icons for the building palette.
 */
export const BUILDING_ICON_FILE_NUMBERS: Record<Race, number> = {
    [Race.Roman]: 9,
    [Race.Viking]: 19,
    [Race.Mayan]: 29,
    [Race.DarkTribe]: 9,  // Fallback to Roman icons
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
    [BuildingType.Forester]:      2,
    [BuildingType.Sawmill]:       3,
    [BuildingType.Stonecutter]:   4,
    [BuildingType.Waterworks]:    5,
    [BuildingType.Fishery]:       6,
    [BuildingType.Hunter]:        7,
    [BuildingType.Slaughterhouse]: 8,
    [BuildingType.Windmill]:      9,
    [BuildingType.Bakery]:        10,
    [BuildingType.Farm]:          11,
    [BuildingType.PigFarm]:       12,
    [BuildingType.DonkeyFarm]:    13,
    [BuildingType.StoneMine]:     14,
    [BuildingType.IronMine]:      15,
    [BuildingType.GoldMine]:      16,
    [BuildingType.CoalMine]:      17,
    [BuildingType.SulfurMine]:    18,
    [BuildingType.GoldSmelter]:   19,
    [BuildingType.IronSmelter]:   20,
    [BuildingType.ToolSmith]:     21,
    [BuildingType.WeaponSmith]:   22,
    [BuildingType.SiegeWorkshop]: 23,  // Siege engine maker (uncertain)
    [BuildingType.LargeDecoration]: 33,
    [BuildingType.Warehouse]:     34,
    [BuildingType.Barrack]:       24,
    [BuildingType.LivingHouse]:   26,
    [BuildingType.Healer]:        27,
    [BuildingType.AmmunitionMaker]: 28,
    [BuildingType.Winegrower]:    29,
    [BuildingType.WinePress]:     35,  // Wine processing (race-equivalent)
    [BuildingType.SmallHouse]:    40,
    [BuildingType.MediumHouse]:   41,
    [BuildingType.LargeHouse]:    42,
    [BuildingType.SmallTemple]:   43,
    [BuildingType.LargeTemple]:   44,
    [BuildingType.ScoutTower]:    45,
    [BuildingType.Tower]:         46,
    [BuildingType.LargeTower]:    47,
    [BuildingType.Castle]:        48,
    [BuildingType.Shipyard]:      52,  // 52-63, 76-79 are shipyard orientations
    [BuildingType.Decoration]:    64,  // 64-75 are decorations
};

/**
 * Mapping from EMaterialType to JIL job index in file 3.jil (resources).
 * These indices need to be verified by visually inspecting the GFX file.
 */
export const RESOURCE_JOB_INDICES: Partial<Record<EMaterialType, number>> = {
    // Job 0: Placeholder
    // Job 1: Unknown plant
    [EMaterialType.IRONORE]: 2,
    [EMaterialType.OFFICER_GEAR]: 3,  // Leader helmets/equipment
    [EMaterialType.AXE]: 4,
    [EMaterialType.BATTLE_AXE]: 5,    // Heavy battle axes
    [EMaterialType.PLANK]: 7,
    [EMaterialType.CROP]: 16,         // Wheat
    [EMaterialType.TRUNK]: 22,        // Logs

    // TODO: Need to identify remaining indices from visual inspection
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
 * Building sprite entries with both construction and completed states.
 */
export interface BuildingSpriteEntries {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) */
    completed: SpriteEntry | null;
}

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 */
export class SpriteMetadataRegistry {
    private buildings: Map<BuildingType, BuildingSpriteEntries> = new Map();
    private mapObjects: Map<MapObjectType, SpriteEntry> = new Map();

    /**
     * Register sprite entries for a building type (both construction and completed).
     */
    public registerBuilding(type: BuildingType, construction: SpriteEntry | null, completed: SpriteEntry | null): void {
        this.buildings.set(type, { construction, completed });
    }

    /**
     * Look up the completed sprite entry for a building type (legacy/default).
     * Returns null if no sprite is registered for this type.
     */
    public getBuilding(type: BuildingType): SpriteEntry | null {
        return this.buildings.get(type)?.completed ?? null;
    }

    /**
     * Look up the construction sprite entry for a building type.
     * Returns null if no sprite is registered for this type.
     */
    public getBuildingConstruction(type: BuildingType): SpriteEntry | null {
        return this.buildings.get(type)?.construction ?? null;
    }

    /**
     * Get both construction and completed sprites for a building type.
     */
    public getBuildingSprites(type: BuildingType): BuildingSpriteEntries | null {
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
