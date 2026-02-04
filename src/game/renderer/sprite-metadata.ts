import { BuildingType } from '../entity';
import { AtlasRegion } from './entity-texture-atlas';

/** Conversion factor from sprite pixels to world-space units */
export const PIXELS_TO_WORLD = 1.0 / 64.0;

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
 * Defines the GFX file and sprite index for a building type.
 */
export interface BuildingSpriteInfo {
    /** GFX file number (e.g., 3 for 3.gfx) */
    file: number;
    /** Sprite index within the GFX file */
    index: number;
}

/**
 * Mapping from BuildingType to GFX sprite information.
 * These indices need to be determined by inspecting the game files.
 *
 * Note: The actual indices will vary depending on the Settlers 4 version
 * and localization. These are placeholder values that should be updated
 * by inspecting the GFX files using the file browser view.
 */
export const BUILDING_SPRITE_MAP: Partial<Record<BuildingType, BuildingSpriteInfo>> = {
    // Romans (file 11) - example mappings, need verification
    [BuildingType.Guardhouse]:    { file: 11, index: 0 },
    [BuildingType.Lumberjack]:    { file: 11, index: 8 },
    [BuildingType.Warehouse]:     { file: 11, index: 16 },
    [BuildingType.Sawmill]:       { file: 11, index: 24 },
    [BuildingType.Stonecutter]:   { file: 11, index: 32 },
    [BuildingType.Farm]:          { file: 11, index: 40 },
    [BuildingType.Windmill]:      { file: 11, index: 48 },
    [BuildingType.Bakery]:        { file: 11, index: 56 },
    [BuildingType.Fishery]:       { file: 11, index: 64 },
    [BuildingType.PigFarm]:       { file: 11, index: 72 },
    [BuildingType.Slaughterhouse]: { file: 11, index: 80 },
    [BuildingType.Waterworks]:    { file: 11, index: 88 },
    [BuildingType.CoalMine]:      { file: 11, index: 96 },
    [BuildingType.IronMine]:      { file: 11, index: 104 },
    [BuildingType.GoldMine]:      { file: 11, index: 112 },
    [BuildingType.IronSmelter]:   { file: 11, index: 120 },
    [BuildingType.GoldSmelter]:   { file: 11, index: 128 },
    [BuildingType.WeaponSmith]:   { file: 11, index: 136 },
    [BuildingType.ToolSmith]:     { file: 11, index: 144 },
    [BuildingType.Barrack]:       { file: 11, index: 152 },
    [BuildingType.Forester]:      { file: 11, index: 160 },
    [BuildingType.LivingHouse]:   { file: 11, index: 168 },
    [BuildingType.Tower]:         { file: 11, index: 176 },
    [BuildingType.Winegrower]:    { file: 11, index: 184 },
};

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 */
export class SpriteMetadataRegistry {
    private buildings: Map<BuildingType, SpriteEntry> = new Map();

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
     * Check if any building sprites have been registered.
     */
    public hasBuildingSprites(): boolean {
        return this.buildings.size > 0;
    }

    /**
     * Get the number of registered building sprites.
     */
    public getBuildingCount(): number {
        return this.buildings.size;
    }

    /**
     * Clear all registered sprites.
     */
    public clear(): void {
        this.buildings.clear();
    }
}
