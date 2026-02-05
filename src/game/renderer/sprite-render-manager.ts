import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    BuildingSpriteEntries,
    Race,
    getBuildingSpriteMap,
    GFX_FILE_NUMBERS,
    getMapObjectSpriteMap,
    getResourceSpriteMap,
    BUILDING_DIRECTION,
} from './sprite-metadata';
import { SpriteLoader, LoadedGfxFileSet } from './sprite-loader';
import { BuildingType, MapObjectType } from '../entity';
import { EMaterialType } from '../economy/material-type';

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
     * Get a resource/material sprite entry by type.
     */
    public getResource(type: EMaterialType): SpriteEntry | null {
        return this._spriteRegistry?.getResource(type) ?? null;
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

        // Create atlas and registry - 4096 needed for large building sprites
        const atlas = new EntityTextureAtlas(4096, this.textureUnit);
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

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded) {
            SpriteRenderManager.log.debug('No sprite files found, using color fallback');
            return false;
        }

        // Upload atlas to GPU
        atlas.load(gl);
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        return registry.hasBuildingSprites() || registry.hasMapObjectSprites() || registry.hasResourceSprites();
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

                // Load construction sprite (D0)
                const constructionSprite = this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex, directionIndex: BUILDING_DIRECTION.CONSTRUCTION },
                    atlas
                );

                // Load completed sprite (D1)
                const completedSprite = this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex, directionIndex: BUILDING_DIRECTION.COMPLETED },
                    atlas
                );

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
}
