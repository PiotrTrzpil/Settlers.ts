import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { processBatchedWithHandler } from './batch-loader';
import { debugStats } from '@/game/debug-stats';
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
import { destroyDecoderPool, getDecoderPool, warmUpDecoderPool } from './sprite-decoder-pool';
import { BuildingType, MapObjectType, UnitType } from '../entity';
import { ANIMATION_DEFAULTS, AnimationData } from '../animation';
import { AnimationDataProvider } from '../systems/animation';
import { EMaterialType } from '../economy/material-type';

/** Simple timer for measuring phases */
function createTimer() {
    const start = performance.now();
    let last = start;
    return {
        lap: () => { const now = performance.now(); const elapsed = Math.round(now - last); last = now; return elapsed },
        total: () => Math.round(performance.now() - start),
    };
}

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
     * Full cleanup including sprite loader cache and worker pool.
     */
    public destroy(): void {
        this.cleanup();
        this.spriteLoader.clearCache();
        destroyDecoderPool();
        SpriteRenderManager.log.debug('SpriteRenderManager resources cleaned up');
    }

    /**
     * Load sprites for a specific race.
     */
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        const t = createTimer();
        const spriteMap = getBuildingSpriteMap(race);

        // Determine which GFX files we need
        const buildingFiles = new Set<number>();
        for (const info of Object.values(spriteMap)) {
            if (info) buildingFiles.add(info.file);
        }

        if (buildingFiles.size === 0) {
            SpriteRenderManager.log.debug('No building sprites configured');
            return false;
        }

        // Collect ALL file IDs and preload in parallel
        const allFileIds = [
            ...Array.from(buildingFiles).map(String),
            `${GFX_FILE_NUMBERS.MAP_OBJECTS}`,
            `${GFX_FILE_NUMBERS.RESOURCES}`,
            `${SETTLER_FILE_NUMBERS[race]}`,
        ];

        // Warm up decoder workers in parallel with file loading
        // This ensures workers are ready before sprite decoding starts
        await Promise.all([
            ...allFileIds.map(id => this.spriteLoader.loadFileSet(id)),
            warmUpDecoderPool(),
        ]);
        const filePreload = t.lap();

        const atlas = new EntityTextureAtlas(8192, this.textureUnit);
        const atlasAlloc = t.lap();

        const registry = new SpriteMetadataRegistry();

        // Load all sprite categories
        let loadedAny = false;
        for (const fileNum of buildingFiles) {
            if (await this.loadBuildingSprites(fileNum, atlas, registry, spriteMap)) {
                loadedAny = true;
            }
        }
        const buildings = t.lap();

        const mapObjectsLoaded = await this.loadMapObjectSprites(atlas, registry);
        const mapObjects = t.lap();

        const resourcesLoaded = await this.loadResourceSprites(atlas, registry);
        const resources = t.lap();

        const unitsLoaded = await this.loadUnitSprites(race, atlas, registry);
        const units = t.lap();

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded && !unitsLoaded) {
            return false;
        }

        atlas.load(gl);
        const gpuUpload = t.lap();

        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        // Record timings to debug stats
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload, atlasAlloc, buildings, mapObjects, resources, units, gpuUpload,
            totalSprites: t.total(),
            atlasSize: `${atlas.width}x${atlas.height}`,
            spriteCount: registry.getBuildingCount() + registry.getMapObjectCount() +
                         registry.getResourceCount() + registry.getUnitCount(),
        });

        SpriteRenderManager.log.debug(
            `Sprite loading (ms): preload=${filePreload}, buildings=${buildings}, ` +
            `mapObj=${mapObjects}, resources=${resources}, units=${units}, ` +
            `gpu=${gpuUpload}, TOTAL=${t.total()}, workers=${getDecoderPool().getDecodeCount()}`
        );

        return registry.hasBuildingSprites() || registry.hasMapObjectSprites() ||
               registry.hasResourceSprites() || registry.hasUnitSprites();
    }

    /**
     * Load building sprites from a GFX file set.
     */
    private async loadBuildingSprites(
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
            // Collect building info for this file
            const buildingInfos: Array<{ buildingType: BuildingType; jobIndex: number }> = [];

            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info || info.file !== fileNum) continue;
                buildingInfos.push({
                    buildingType: Number(typeStr) as BuildingType,
                    jobIndex: info.index,
                });
            }

            // Process buildings in batches with yielding
            await processBatchedWithHandler(
                buildingInfos,
                async({ buildingType, jobIndex }) => {
                    // Load construction sprite (D0)
                    const constructionSprite = await this.spriteLoader.loadJobSprite(
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
                    let animationFrames: SpriteEntry[] | null = null;

                    if (completedFrameCount > 1) {
                        // Load as animation
                        const animation = await this.spriteLoader.loadJobAnimation(
                            fileSet,
                            jobIndex,
                            BUILDING_DIRECTION.COMPLETED,
                            atlas
                        );

                        if (animation && animation.frames.length > 0) {
                            animationFrames = animation.frames.map(f => f.entry);
                            completedSprite = animation.frames[0];
                        }
                    } else {
                        // Load single frame
                        completedSprite = await this.spriteLoader.loadJobSprite(
                            fileSet,
                            { jobIndex, directionIndex: BUILDING_DIRECTION.COMPLETED },
                            atlas
                        );
                    }

                    return { buildingType, jobIndex, constructionSprite, completedSprite, animationFrames };
                },
                ({ buildingType, jobIndex, constructionSprite, completedSprite, animationFrames }) => {
                    if (!constructionSprite && !completedSprite) {
                        SpriteRenderManager.log.debug(
                            `Failed to load any sprite for building ${BuildingType[buildingType]} (job ${jobIndex})`
                        );
                        return;
                    }

                    if (animationFrames) {
                        registry.registerAnimatedBuilding(
                            buildingType,
                            animationFrames,
                            BUILDING_DIRECTION.COMPLETED,
                            ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                            true // loop
                        );
                    }

                    registry.registerBuilding(
                        buildingType,
                        constructionSprite?.entry ?? null,
                        completedSprite?.entry ?? null
                    );
                }
            );

            return true;
        } catch (e) {
            SpriteRenderManager.log.error(`Failed to load GFX file ${fileNum}: ${e}`);
            return false;
        }
    }

    /**
     * Load map object sprites.
     */
    private async loadMapObjectSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const fileSet = await this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`);
        if (!fileSet) return false;

        return this.loadSpritesFromMap(
            getMapObjectSpriteMap(),
            (type, info) => [{ type, index: info.index, palette: info.paletteIndex ?? 0 }],
            ({ index, palette }) => this.spriteLoader.loadDirectSprite(fileSet, index, palette, atlas),
            ({ type }, sprite) => registry.registerMapObject(type, sprite.entry)
        );
    }

    /**
     * Load resource sprites.
     */
    private async loadResourceSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const fileSet = await this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        return this.loadSpritesFromMap(
            getResourceSpriteMap(),
            (type, info) => [{ type, jobIndex: info.index }],
            ({ jobIndex }) => this.spriteLoader.loadJobSprite(
                fileSet, { jobIndex, directionIndex: 0, frameIndex: 0 }, atlas
            ),
            ({ type }, sprite) => registry.registerResource(type, sprite.entry)
        );
    }

    /**
     * Load unit sprites (all 4 directions per unit).
     */
    private async loadUnitSprites(
        race: Race,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const fileSet = await this.spriteLoader.loadFileSet(`${SETTLER_FILE_NUMBERS[race]}`);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        const DIRECTIONS = [
            UNIT_DIRECTION.RIGHT, UNIT_DIRECTION.RIGHT_BOTTOM,
            UNIT_DIRECTION.LEFT_BOTTOM, UNIT_DIRECTION.LEFT,
        ];

        return this.loadSpritesFromMap(
            getUnitSpriteMap(race),
            (type, info) => DIRECTIONS.map(dir => ({ type, dir, jobIndex: info.index })),
            ({ dir, jobIndex }) => this.spriteLoader.loadJobSprite(
                fileSet, { jobIndex, directionIndex: dir, frameIndex: 0 }, atlas
            ),
            ({ type, dir }, sprite) => registry.registerUnit(type, dir, sprite.entry)
        );
    }

    /**
     * Generic sprite loading helper.
     * Collects tasks from sprite map, loads in batches, registers results.
     */
    private async loadSpritesFromMap<K extends number, I, T extends { type: K }, R>(
        spriteMap: Partial<Record<K, I>>,
        expandTasks: (type: K, info: I) => T[],
        load: (task: T) => Promise<R | null>,
        register: (task: T, result: R) => void
    ): Promise<boolean> {
        const tasks: T[] = [];
        for (const [typeStr, info] of Object.entries(spriteMap) as [string, I][]) {
            if (info) tasks.push(...expandTasks(Number(typeStr) as K, info));
        }

        let count = 0;
        await processBatchedWithHandler(
            tasks,
            load,
            (result, task) => { if (result) { register(task, result); count++ } }
        );
        return count > 0;
    }
}
