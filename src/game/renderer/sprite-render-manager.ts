import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    BuildingSpriteEntries,
    Race,
    getBuildingSpriteMap,
    getUnitSpriteMap,
    GFX_FILE_NUMBERS,
    getMapObjectSpriteMap,
    getResourceSpriteMap,
    BUILDING_DIRECTION,
    UNIT_DIRECTION,
    AnimatedSpriteEntry,
    SETTLER_FILE_NUMBERS,
} from './sprite-metadata';
import { SpriteLoader } from './sprite-loader';
import { BuildingType, MapObjectType, UnitType } from '../entity';
import { ANIMATION_DEFAULTS, AnimationData } from '../animation';
import { AnimationDataProvider } from '../systems/animation';
import { EMaterialType } from '../economy/material-type';

/**
 * Consolidated building render data - all sprites needed for a building type in one lookup.
 */
export interface BuildingRenderEntry {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) - static fallback */
    completed: SpriteEntry | null;
    /** Animated sprite data if available */
    animated: AnimatedSpriteEntry | null;
}

/**
 * Consolidated map object render data.
 */
export interface MapObjectRenderEntry {
    /** Static sprite */
    static: SpriteEntry | null;
    /** Animated sprite data if available */
    animated: AnimatedSpriteEntry | null;
}

/**
 * Manages sprite loading, atlas packing, and race switching for entity rendering.
 * Extracted from EntityRenderer to separate concerns.
 */
export class SpriteRenderManager {
    private static log = new LogHandler('SpriteRenderManager');

    private fileManager: FileManager;
    private spriteLoader: SpriteLoader;
    private glContext: WebGL2RenderingContext | null = null;
    private textureUnit: number;

    // Sprite atlas and metadata
    private _spriteAtlas: EntityTextureAtlas | null = null;
    private _spriteRegistry: SpriteMetadataRegistry | null = null;
    private _currentRace: Race = Race.Roman;

    constructor(fileManager: FileManager, textureUnit: number) {
        this.fileManager = fileManager;
        this.textureUnit = textureUnit;
        this.spriteLoader = new SpriteLoader(fileManager);
    }

    /** Get the sprite atlas (null if not loaded) */
    get spriteAtlas(): EntityTextureAtlas | null {
        return this._spriteAtlas;
    }

    /** Get the sprite registry (null if not loaded) */
    get spriteRegistry(): SpriteMetadataRegistry | null {
        return this._spriteRegistry;
    }

    /** Get the current race */
    get currentRace(): Race {
        return this._currentRace;
    }

    /** Check if sprites are available for rendering */
    get hasSprites(): boolean {
        return this._spriteAtlas !== null && this._spriteRegistry !== null;
    }

    /**
     * Initialize sprite loading. Call once after GL context is available.
     */
    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.glContext = gl;
        return this.loadSpritesForRace(gl, this._currentRace);
    }

    /**
     * Switch to a different race and reload sprites.
     * Returns true if sprites were loaded successfully.
     */
    public async setRace(race: Race): Promise<boolean> {
        SpriteRenderManager.log.debug(`setRace called: ${Race[race]} (current: ${Race[this._currentRace]})`);

        if (race === this._currentRace) return true;
        if (!this.glContext) {
            SpriteRenderManager.log.debug('setRace failed: no GL context');
            return false;
        }

        this._currentRace = race;

        // Clean up old resources
        this.cleanup();
        this.spriteLoader.clearCache();

        // Load new sprites
        const loaded = await this.loadSpritesForRace(this.glContext, race);

        if (loaded) {
            SpriteRenderManager.log.debug(
                `Switched to ${Race[race]}: ${this._spriteRegistry?.getBuildingCount() ?? 0} building sprites loaded`
            );
        } else {
            SpriteRenderManager.log.debug(`Failed to load sprites for ${Race[race]}, using color fallback`);
        }

        return loaded;
    }

    /**
     * Get a building sprite entry by type (completed state, for backwards compatibility).
     */
    public getBuilding(type: BuildingType): SpriteEntry | null {
        return this._spriteRegistry?.getBuilding(type) ?? null;
    }

    /**
     * Get a building construction sprite entry by type.
     */
    public getBuildingConstruction(type: BuildingType): SpriteEntry | null {
        return this._spriteRegistry?.getBuildingConstruction(type) ?? null;
    }

    /**
     * Get both construction and completed sprites for a building type.
     */
    public getBuildingSprites(type: BuildingType): BuildingSpriteEntries | null {
        return this._spriteRegistry?.getBuildingSprites(type) ?? null;
    }

    /**
     * Get a map object sprite entry by type.
     */
    public getMapObject(type: MapObjectType): SpriteEntry | null {
        return this._spriteRegistry?.getMapObject(type) ?? null;
    }

    /**
     * Get animated building data (if available).
     */
    public getAnimatedBuilding(type: BuildingType): AnimatedSpriteEntry | null {
        return this._spriteRegistry?.getAnimatedBuilding(type) ?? null;
    }

    /**
     * Check if a building has animation frames.
     */
    public hasBuildingAnimation(type: BuildingType): boolean {
        return this._spriteRegistry?.hasBuildingAnimation(type) ?? false;
    }

    /**
     * Get animated map object data (if available).
     */
    public getAnimatedMapObject(type: MapObjectType): AnimatedSpriteEntry | null {
        return this._spriteRegistry?.getAnimatedMapObject(type) ?? null;
    }

    /**
     * Check if a map object has animation frames.
     */
    public hasMapObjectAnimation(type: MapObjectType): boolean {
        return this._spriteRegistry?.hasMapObjectAnimation(type) ?? false;
    }

    /**
     * Get animation data for a building type.
     */
    public getBuildingAnimationData(type: BuildingType): AnimationData | null {
        const entry = this._spriteRegistry?.getAnimatedBuilding(type);
        return entry?.animationData ?? null;
    }

    /**
     * Get animation data for a map object type.
     */
    public getMapObjectAnimationData(type: MapObjectType): AnimationData | null {
        const entry = this._spriteRegistry?.getAnimatedMapObject(type);
        return entry?.animationData ?? null;
    }

    /**
     * Returns this manager as an AnimationDataProvider.
     * Allows the animation system to query animation data without direct coupling.
     */
    public asAnimationProvider(): AnimationDataProvider {
        return {
            getBuildingAnimationData: (type: BuildingType) => this.getBuildingAnimationData(type),
            getMapObjectAnimationData: (type: MapObjectType) => this.getMapObjectAnimationData(type),
            hasBuildingAnimation: (type: BuildingType) => this.hasBuildingAnimation(type),
            hasMapObjectAnimation: (type: MapObjectType) => this.hasMapObjectAnimation(type),
        };
    }

    /**
     * Get a resource/material sprite entry by type.
     */
    public getResource(type: EMaterialType): SpriteEntry | null {
        return this._spriteRegistry?.getResource(type) ?? null;
    }

    /**
     * Get a unit sprite entry by type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT (defaults to 0)
     */
    public getUnit(type: UnitType, direction: number = 0): SpriteEntry | null {
        return this._spriteRegistry?.getUnit(type, direction) ?? null;
    }

    /**
     * Get all building sprites in a single lookup (construction, completed, animated).
     * Reduces multiple method calls per building per frame.
     */
    public getBuildingRenderEntry(type: BuildingType): BuildingRenderEntry {
        const sprites = this._spriteRegistry?.getBuildingSprites(type);
        const animated = this._spriteRegistry?.getAnimatedBuilding(type) ?? null;
        return {
            construction: sprites?.construction ?? null,
            completed: sprites?.completed ?? null,
            animated,
        };
    }

    /**
     * Get all map object sprites in a single lookup (static, animated).
     */
    public getMapObjectRenderEntry(type: MapObjectType): MapObjectRenderEntry {
        const staticSprite = this._spriteRegistry?.getMapObject(type) ?? null;
        const animated = this._spriteRegistry?.getAnimatedMapObject(type) ?? null;
        return {
            static: staticSprite,
            animated,
        };
    }

    /**
     * Clean up GPU resources. Call when switching races or destroying.
     */
    public cleanup(): void {
        this._spriteRegistry?.clear();
        this._spriteAtlas = null;
    }

    /**
     * Full cleanup including sprite loader cache.
     */
    public destroy(): void {
        this.cleanup();
        this.spriteLoader.clearCache();
        SpriteRenderManager.log.debug('SpriteRenderManager resources cleaned up');
    }

    /**
     * Load sprites for a specific race.
     */
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        const spriteMap = getBuildingSpriteMap(race);

        // Determine which GFX files we need
        const requiredFiles = new Set<number>();
        for (const info of Object.values(spriteMap)) {
            if (info) requiredFiles.add(info.file);
        }

        if (requiredFiles.size === 0) {
            SpriteRenderManager.log.debug('No building sprites configured');
            return false;
        }

        // Create atlas and registry - 16384 needed to fit buildings, map objects, resources, and units (4 dirs each)
        const atlas = new EntityTextureAtlas(16384, this.textureUnit);
        const registry = new SpriteMetadataRegistry();

        let loadedAny = false;

        for (const fileNum of requiredFiles) {
            const loaded = await this.loadSpritesFromFile(fileNum, atlas, registry, spriteMap);
            if (loaded) loadedAny = true;
        }

        if (!loadedAny) {
            SpriteRenderManager.log.debug('No building sprite files found');
        }

        // Also load map object sprites (trees, stones)
        const mapObjectsLoaded = await this.loadMapObjectSprites(atlas, registry);
        if (mapObjectsLoaded) {
            SpriteRenderManager.log.debug(`Map object sprites loaded: ${registry.getMapObjectCount()} objects`);
        }

        // Also load resource sprites (logs, planks, goods)
        const resourcesLoaded = await this.loadResourceSprites(atlas, registry);
        if (resourcesLoaded) {
            SpriteRenderManager.log.debug(`Resource sprites loaded: ${registry.getResourceCount()} resources`);
        }

        // Also load unit sprites (settlers, soldiers)
        const unitsLoaded = await this.loadUnitSprites(race, atlas, registry);
        if (unitsLoaded) {
            SpriteRenderManager.log.debug(`Unit sprites loaded: ${registry.getUnitCount()} units`);
        }

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded && !unitsLoaded) {
            SpriteRenderManager.log.debug('No sprite files found, using color fallback');
            return false;
        }

        // Upload atlas to GPU
        atlas.load(gl);
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        return registry.hasBuildingSprites() || registry.hasMapObjectSprites() || registry.hasResourceSprites() || registry.hasUnitSprites();
    }

    /**
     * Load sprites from a single GFX file set.
     */
    private async loadSpritesFromFile(
        fileNum: number,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        spriteMap: Partial<Record<BuildingType, { file: number; index: number }>>
    ): Promise<boolean> {
        const fileId = `${fileNum}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);

        if (!fileSet) {
            SpriteRenderManager.log.debug(`GFX file set ${fileNum} not available`);
            return false;
        }

        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteRenderManager.log.debug(`JIL/DIL files not available for ${fileNum}`);
            return false;
        }

        try {
            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info || info.file !== fileNum) continue;

                const buildingType = Number(typeStr) as BuildingType;
                const jobIndex = info.index;

                // Load construction sprite (D0) - single frame
                const constructionSprite = this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex, directionIndex: BUILDING_DIRECTION.CONSTRUCTION },
                    atlas
                );

                // Check if completed state has multiple frames (animation)
                const completedFrameCount = this.spriteLoader.getFrameCount(
                    fileSet,
                    jobIndex,
                    BUILDING_DIRECTION.COMPLETED
                );

                let completedSprite = null;

                if (completedFrameCount > 1) {
                    // Load as animation
                    const animation = this.spriteLoader.loadJobAnimation(
                        fileSet,
                        jobIndex,
                        BUILDING_DIRECTION.COMPLETED,
                        atlas
                    );

                    if (animation && animation.frames.length > 0) {
                        // Register animated building
                        const frames = animation.frames.map(f => f.entry);
                        registry.registerAnimatedBuilding(
                            buildingType,
                            frames,
                            BUILDING_DIRECTION.COMPLETED,
                            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                            true // loop
                        );
                        completedSprite = animation.frames[0];

                        SpriteRenderManager.log.debug(
                            `Loaded ${animation.frameCount} animation frames for building ${BuildingType[buildingType]}`
                        );
                    }
                } else {
                    // Load single frame
                    completedSprite = this.spriteLoader.loadJobSprite(
                        fileSet,
                        { jobIndex, directionIndex: BUILDING_DIRECTION.COMPLETED },
                        atlas
                    );
                }

                if (!constructionSprite && !completedSprite) {
                    SpriteRenderManager.log.debug(
                        `Failed to load any sprite for building ${BuildingType[buildingType]} (job ${jobIndex})`
                    );
                    continue;
                }

                registry.registerBuilding(
                    buildingType,
                    constructionSprite?.entry ?? null,
                    completedSprite?.entry ?? null
                );
            }

            SpriteRenderManager.log.debug(`Loaded sprites from file ${fileNum}.gfx`);
            return true;
        } catch (e) {
            SpriteRenderManager.log.error(`Failed to load GFX file ${fileNum}: ${e}`);
            return false;
        }
    }

    /**
     * Load map object sprites (trees, stones, etc.).
     */
    private async loadMapObjectSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const spriteMap = getMapObjectSpriteMap();
        const fileNum = GFX_FILE_NUMBERS.MAP_OBJECTS;
        const fileId = `${fileNum}`;

        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet) {
            SpriteRenderManager.log.debug(`Map object GFX file ${fileNum} not available`);
            return false;
        }

        try {
            let loadedCount = 0;

            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info) continue;

                const objectType = Number(typeStr) as MapObjectType;
                const spriteIndex = info.index;
                const paletteIndex = info.paletteIndex ?? 0;

                const loadedSprite = this.spriteLoader.loadDirectSprite(
                    fileSet,
                    spriteIndex,
                    paletteIndex,
                    atlas
                );

                if (!loadedSprite) {
                    SpriteRenderManager.log.debug(
                        `Failed to load sprite for map object ${MapObjectType[objectType]} (index ${spriteIndex})`
                    );
                    continue;
                }

                registry.registerMapObject(objectType, loadedSprite.entry);
                loadedCount++;
            }

            if (loadedCount > 0) {
                SpriteRenderManager.log.debug(`Loaded ${loadedCount} map object sprites from file ${fileNum}.gfx`);
                return true;
            }

            return false;
        } catch (e) {
            SpriteRenderManager.log.error(`Failed to load map object sprites: ${e}`);
            return false;
        }
    }

    /**
     * Load resource sprites (dropped goods like logs, planks, etc.).
     * Resources are stored in file 3.gfx and use JIL job indices.
     */
    private async loadResourceSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const spriteMap = getResourceSpriteMap();
        const fileNum = GFX_FILE_NUMBERS.RESOURCES;
        const fileId = `${fileNum}`;

        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet) {
            SpriteRenderManager.log.debug(`Resource GFX file ${fileNum} not available`);
            return false;
        }

        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteRenderManager.log.debug(`JIL/DIL files not available for resources in ${fileNum}`);
            return false;
        }

        try {
            let loadedCount = 0;

            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info) continue;

                const materialType = Number(typeStr) as EMaterialType;
                const jobIndex = info.index;

                // Load resource sprite using job index (direction 0, frame 0)
                // Resources typically have a single direction with multiple frames for stack sizes
                const loadedSprite = this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex, directionIndex: 0, frameIndex: 0 },
                    atlas
                );

                if (!loadedSprite) {
                    SpriteRenderManager.log.debug(
                        `Failed to load sprite for resource ${EMaterialType[materialType]} (job ${jobIndex})`
                    );
                    continue;
                }

                registry.registerResource(materialType, loadedSprite.entry);
                loadedCount++;
            }

            if (loadedCount > 0) {
                SpriteRenderManager.log.debug(`Loaded ${loadedCount} resource sprites from file ${fileNum}.gfx`);
                return true;
            }

            return false;
        } catch (e) {
            SpriteRenderManager.log.error(`Failed to load resource sprites: ${e}`);
            return false;
        }
    }

    /**
     * Load unit sprites (settlers, soldiers, etc.).
     * Units are stored in race-specific files (20-24.gfx) and use JIL job indices.
     * Loads all 4 directions for each unit type.
     */
    private async loadUnitSprites(
        race: Race,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const spriteMap = getUnitSpriteMap(race);
        const fileNum = SETTLER_FILE_NUMBERS[race];
        const fileId = `${fileNum}`;

        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet) {
            SpriteRenderManager.log.debug(`Unit GFX file ${fileNum} not available`);
            return false;
        }

        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteRenderManager.log.debug(`JIL/DIL files not available for units in ${fileNum}`);
            return false;
        }

        // Unit directions: D0=right, D1=right+down, D2=left+down, D3=left
        const UNIT_DIRECTIONS = [
            UNIT_DIRECTION.RIGHT,
            UNIT_DIRECTION.RIGHT_BOTTOM,
            UNIT_DIRECTION.LEFT_BOTTOM,
            UNIT_DIRECTION.LEFT,
        ];

        try {
            let loadedCount = 0;

            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info) continue;

                const unitType = Number(typeStr) as UnitType;
                const jobIndex = info.index;
                let unitLoadedAny = false;

                // Load all 4 directions for this unit type
                for (const direction of UNIT_DIRECTIONS) {
                    const loadedSprite = this.spriteLoader.loadJobSprite(
                        fileSet,
                        { jobIndex, directionIndex: direction, frameIndex: 0 },
                        atlas
                    );

                    if (loadedSprite) {
                        registry.registerUnit(unitType, direction, loadedSprite.entry);
                        unitLoadedAny = true;
                    }
                }

                if (!unitLoadedAny) {
                    SpriteRenderManager.log.debug(
                        `Failed to load any sprites for unit ${UnitType[unitType]} (job ${jobIndex})`
                    );
                } else {
                    loadedCount++;
                }
            }

            if (loadedCount > 0) {
                SpriteRenderManager.log.debug(`Loaded ${loadedCount} unit types (4 directions each) from file ${fileNum}.gfx`);
                return true;
            }

            return false;
        } catch (e) {
            SpriteRenderManager.log.error(`Failed to load unit sprites: ${e}`);
            return false;
        }
    }
}
