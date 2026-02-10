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
    AnimatedSpriteEntry,
    SETTLER_FILE_NUMBERS,
    TREE_JOB_OFFSET,
    TREE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    WORKER_JOB_INDICES,
} from './sprite-metadata';
import { SpriteLoader, type LoadedGfxFileSet } from './sprite-loader';
import { destroyDecoderPool, getDecoderPool, warmUpDecoderPool } from './sprite-decoder-pool';
import { BuildingType, MapObjectType, UnitType, EntityType } from '../entity';
import { ANIMATION_DEFAULTS, ANIMATION_SEQUENCES, AnimationData, carrySequenceKey } from '../animation';
import { AnimationDataProvider } from '../systems/animation';
import { EMaterialType } from '../economy';
import {
    getAtlasCache,
    setAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    type CachedAtlasData,
} from './sprite-atlas-cache';

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
    /**
     * Get a map object sprite entry by type (and optional variation).
     */
    public getMapObject(type: MapObjectType, variation?: number): SpriteEntry | null {
        return this._spriteRegistry?.getMapObject(type, variation) ?? null;
    }

    // ========== Unified Animation API ==========

    /**
     * Get animated entity data for any entity type. O(1) lookup.
     */
    public getAnimatedEntity(entityType: EntityType, subType: number): AnimatedSpriteEntry | null {
        return this._spriteRegistry?.getAnimatedEntity(entityType, subType) ?? null;
    }

    /**
     * Check if any entity type has animation frames. O(1) lookup.
     */
    public hasAnimation(entityType: EntityType, subType: number): boolean {
        return this._spriteRegistry?.hasAnimation(entityType, subType) ?? false;
    }

    /**
     * Get animation data for any entity type. O(1) lookup.
     */
    public getAnimationData(entityType: EntityType, subType: number): AnimationData | null {
        const entry = this._spriteRegistry?.getAnimatedEntity(entityType, subType);
        return entry?.animationData ?? null;
    }

    /**
     * Returns this manager as an AnimationDataProvider.
     * Implements the unified interface for the animation system.
     */
    public asAnimationProvider(): AnimationDataProvider {
        return {
            getAnimationData: (entityType: EntityType, subType: number) =>
                this.getAnimationData(entityType, subType),
            hasAnimation: (entityType: EntityType, subType: number) =>
                this.hasAnimation(entityType, subType),
        };
    }

    // ========== Legacy Wrappers (for backwards compatibility) ==========

    /** @deprecated Use getAnimatedEntity(EntityType.Building, type) instead */
    public getAnimatedBuilding(type: BuildingType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.Building, type);
    }

    /** @deprecated Use hasAnimation(EntityType.Building, type) instead */
    public hasBuildingAnimation(type: BuildingType): boolean {
        return this.hasAnimation(EntityType.Building, type);
    }

    /** @deprecated Use getAnimatedEntity(EntityType.MapObject, type) instead */
    public getAnimatedMapObject(type: MapObjectType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.MapObject, type);
    }

    /** @deprecated Use hasAnimation(EntityType.MapObject, type) instead */
    public hasMapObjectAnimation(type: MapObjectType): boolean {
        return this.hasAnimation(EntityType.MapObject, type);
    }

    /** @deprecated Use getAnimatedEntity(EntityType.Unit, type) instead */
    public getAnimatedUnit(type: UnitType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.Unit, type);
    }

    /** @deprecated Use hasAnimation(EntityType.Unit, type) instead */
    public hasUnitAnimation(type: UnitType): boolean {
        return this.hasAnimation(EntityType.Unit, type);
    }

    /**
     * Get a resource/material sprite entry by type.
     */
    /**
     * Get a resource/material sprite entry by type.
     */
    public getResource(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        return this._spriteRegistry?.getResource(type, direction) ?? null;
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
     * Try to restore sprites from the module-level cache (sync, for HMR).
     * Returns true if cache was hit and sprites restored successfully.
     */
    private tryRestoreFromModuleCache(gl: WebGL2RenderingContext, race: Race): boolean {
        const cached = getAtlasCache(race);
        if (!cached) return false;

        this.restoreFromCachedData(gl, cached, 'module');
        return true;
    }

    /**
     * Try to restore sprites from IndexedDB cache (async, for page refresh).
     * Returns true if cache was hit and sprites restored successfully.
     */
    private async tryRestoreFromIndexedDB(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        const cached = await getIndexedDBCache(race);
        if (!cached) {
            return false;
        }

        this.restoreFromCachedData(gl, cached, 'indexeddb');

        // Also populate module cache for future HMR hits
        setAtlasCache(race, cached);

        return true;
    }

    /**
     * Common restore logic for both cache tiers.
     */
    private restoreFromCachedData(
        gl: WebGL2RenderingContext,
        cached: CachedAtlasData,
        source: 'module' | 'indexeddb'
    ): void {
        const start = performance.now();

        // Restore atlas from cached data
        const atlas = EntityTextureAtlas.fromCache(
            cached.imgData,
            cached.width,
            cached.height,
            cached.maxSize,
            cached.slots,
            cached.textureUnit
        );

        // Restore registry from serialized data
        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);

        // Upload to GPU
        atlas.update(gl);

        // Set as active
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        const elapsed = performance.now() - start;

        // Record cache hit in debug stats
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload: 0,
            atlasAlloc: 0,
            buildings: 0,
            mapObjects: 0,
            resources: 0,
            units: 0,
            gpuUpload: Math.round(elapsed),
            totalSprites: Math.round(elapsed),
            atlasSize: `${atlas.width}x${atlas.height}`,
            spriteCount: registry.getBuildingCount() + registry.getMapObjectCount() +
                registry.getResourceCount() + registry.getUnitCount(),
            cacheHit: true,
            cacheSource: source,
        });

        const sourceLabel = source === 'module' ? 'module cache (HMR)' : 'IndexedDB (refresh)';
        SpriteRenderManager.log.debug(
            `Restored sprites from ${sourceLabel} for ${Race[cached.race]} in ${elapsed.toFixed(1)}ms ` +
            `(${atlas.width}x${atlas.height}, ${registry.getBuildingCount()} buildings)`
        );
    }

    /**
     * Save current atlas and registry to both cache tiers.
     */
    private async saveToCache(race: Race): Promise<void> {
        if (!this._spriteAtlas || !this._spriteRegistry) {
            return;
        }

        const cacheData: CachedAtlasData = {
            imgData: this._spriteAtlas.getImageData(),
            width: this._spriteAtlas.width,
            height: this._spriteAtlas.height,
            maxSize: this._spriteAtlas.getMaxSize(),
            slots: this._spriteAtlas.getSlots(),
            registryData: this._spriteRegistry.serialize(),
            race,
            textureUnit: this.textureUnit,
            timestamp: Date.now(),
        };

        // Save to module cache (sync, for HMR)
        setAtlasCache(race, cacheData);

        // Save to IndexedDB (async, for page refresh) - don't await to avoid blocking
        setIndexedDBCache(race, cacheData).catch(e => {
            SpriteRenderManager.log.debug(`IndexedDB save failed (non-fatal): ${e}`);
        });
    }

    /**
     * Load sprites for a specific race.
     */
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        // Tier 1: Try module-level cache (instant, survives HMR)
        if (this.tryRestoreFromModuleCache(gl, race)) {
            return true;
        }

        // Tier 2: Try IndexedDB cache (fast, survives page refresh)
        if (await this.tryRestoreFromIndexedDB(gl, race)) {
            return true;
        }

        // Tier 3: Full load from files
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

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const effectiveMax = Math.min(32768, maxTextureSize);
        SpriteRenderManager.log.debug(`Atlas max size set to ${effectiveMax} (HW: ${maxTextureSize})`);

        const atlas = new EntityTextureAtlas(effectiveMax, this.textureUnit);
        const atlasAlloc = t.lap();

        const registry = new SpriteMetadataRegistry();

        // Expose atlas and registry immediately for progressive rendering
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        // Load all sprite categories
        let loadedAny = false;
        for (const fileNum of buildingFiles) {
            if (await this.loadBuildingSprites(fileNum, atlas, registry, spriteMap)) {
                loadedAny = true;
            }
        }
        const buildings = t.lap();

        const mapObjectsLoaded = await this.loadMapObjectSprites(gl, atlas, registry);
        const mapObjects = t.lap();

        const resourcesLoaded = await this.loadResourceSprites(atlas, registry);
        const resources = t.lap();

        const unitsLoaded = await this.loadUnitSprites(race, atlas, registry);
        const units = t.lap();

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded && !unitsLoaded) {
            return false;
        }

        // Final full upload to ensure everything is on GPU
        atlas.update(gl);
        const gpuUpload = t.lap();

        // Save to module-level cache for HMR
        this.saveToCache(race);
        const cacheTime = t.lap();

        // Record timings to debug stats
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload, atlasAlloc, buildings, mapObjects, resources, units, gpuUpload,
            totalSprites: t.total(),
            atlasSize: `${atlas.width}x${atlas.height}`,
            spriteCount: registry.getBuildingCount() + registry.getMapObjectCount() +
                registry.getResourceCount() + registry.getUnitCount(),
            cacheHit: false,
            cacheSource: null,
        });

        SpriteRenderManager.log.debug(
            `Sprite loading (ms): preload=${filePreload}, buildings=${buildings}, ` +
            `mapObj=${mapObjects}, resources=${resources}, units=${units}, ` +
            `gpu=${gpuUpload}, cache=${cacheTime}, TOTAL=${t.total()}, workers=${getDecoderPool().getDecodeCount()}`
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
     * Load map object sprites (trees use JIL-based structure, resources use direction-based).
     */
    private async loadMapObjectSprites(
        gl: WebGL2RenderingContext,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        // Load both file sets potentially needed
        const [fileSet5, fileSet3] = await Promise.all([
            this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`),
            this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`)
        ]);

        if (!fileSet5) return false;

        SpriteRenderManager.log.debug(`Loaded MapObjects GFX: ${fileSet5.gilReader.length} images`);

        let loadCount = 0;

        // Load trees using JIL-based structure
        const treeCount = await this.loadTreeSprites(fileSet5, atlas, registry, gl);
        loadCount += treeCount;

        // Load resource map objects (coal, iron, etc.) using direction-based structure
        if (fileSet3) {
            const resourceCount = await this.loadResourceMapObjects(fileSet3, atlas, registry);
            loadCount += resourceCount;
        }

        SpriteRenderManager.log.debug(`MapObject sprite loading complete: ${loadCount} sprites`);
        return loadCount > 0;
    }

    /**
     * Load tree sprites using JIL/DIL structure.
     * Trees have: D0-D2 = growth stages, D3 = normal, D4 = falling, D5 = canopy disappearing
     */
    private async loadTreeSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext
    ): Promise<number> {
        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteRenderManager.log.debug('Tree JIL/DIL not available, skipping tree loading');
            return 0;
        }

        const treeInfos: Array<{ treeType: MapObjectType; jobIndex: number }> = [];
        for (const [typeStr, jobIndex] of Object.entries(TREE_JOB_INDICES)) {
            if (jobIndex !== undefined) {
                treeInfos.push({
                    treeType: Number(typeStr) as MapObjectType,
                    jobIndex,
                });
            }
        }

        let loadedCount = 0;

        await processBatchedWithHandler(
            treeInfos,
            async({ treeType, jobIndex: baseJobIndex }) => {
                // Each tree state is a separate job. Direction is always 0.
                // Job = baseJobIndex + offset, e.g., Oak normal = 1 + 3 = job 4

                // Load normal tree sprite (base + 3) - this is what healthy trees display
                const normalJob = baseJobIndex + TREE_JOB_OFFSET.NORMAL;
                const normalSprite = await this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex: normalJob, directionIndex: 0 },
                    atlas
                );

                // Load growth stages (base + 0, 1, 2) for future use
                const growthSprites: SpriteEntry[] = [];
                for (let offset = TREE_JOB_OFFSET.SAPLING; offset <= TREE_JOB_OFFSET.MEDIUM; offset++) {
                    const sprite = await this.spriteLoader.loadJobSprite(
                        fileSet,
                        { jobIndex: baseJobIndex + offset, directionIndex: 0 },
                        atlas
                    );
                    if (sprite) {
                        growthSprites.push(sprite.entry);
                    }
                }

                // Load falling animation (base + 4)
                const fallingAnim = await this.spriteLoader.loadJobAnimation(
                    fileSet,
                    baseJobIndex + TREE_JOB_OFFSET.FALLING,
                    0, // direction
                    atlas
                );

                // Load canopy disappearing animation (base + 5) - last frame is trunk only
                const canopyAnim = await this.spriteLoader.loadJobAnimation(
                    fileSet,
                    baseJobIndex + TREE_JOB_OFFSET.CANOPY_DISAPPEARING,
                    0, // direction
                    atlas
                );

                return { treeType, normalSprite, growthSprites, fallingAnim, canopyAnim };
            },
            (result) => {
                if (!result) return;

                const { treeType, normalSprite, growthSprites, fallingAnim, canopyAnim } = result;

                // Register normal tree sprite (variation 0 = healthy tree)
                if (normalSprite) {
                    registry.registerMapObject(treeType, normalSprite.entry, 0);
                    loadedCount++;
                }

                // Register growth stages as variations 1-3 (for growing trees)
                for (let i = 0; i < growthSprites.length; i++) {
                    // Growth stages go in reverse order: mature=1, medium=2, sapling=3
                    // So variation 1 is most grown (closest to normal), 3 is smallest
                    registry.registerMapObject(treeType, growthSprites[growthSprites.length - 1 - i], i + 1);
                    loadedCount++;
                }

                // Register animations for woodcutting system
                // TODO: Register falling and canopy animations when tree cutting is implemented
                if (fallingAnim && fallingAnim.frames.length > 0) {
                    // Will be used for tree falling animation
                }
                if (canopyAnim && canopyAnim.frames.length > 0) {
                    // Last frame is trunk only - useful for stumps/logs
                }
            }
        );

        // Force atlas update after loading trees
        atlas.update(gl);

        SpriteRenderManager.log.debug(`Loaded ${loadedCount} tree sprites`);
        return loadedCount;
    }

    /**
     * Load resource map objects (coal, iron, gold, stone, sulfur deposits).
     */
    private async loadResourceMapObjects(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<number> {
        const mapObjectSpriteMap = getMapObjectSpriteMap();
        let loadedCount = 0;

        for (const [typeStr, info] of Object.entries(mapObjectSpriteMap)) {
            if (!info || info.file !== GFX_FILE_NUMBERS.RESOURCES) continue;

            const type = Number(typeStr) as MapObjectType;

            // Load 8 directions for quantities 1-8
            for (let dir = 0; dir < 8; dir++) {
                const sprite = await this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex: info.index, directionIndex: dir },
                    atlas
                );
                if (sprite) {
                    registry.registerMapObject(type, sprite.entry, dir);
                    loadedCount++;
                }
            }
        }

        return loadedCount;
    }

    /**
     * Load resource sprites.
     */
    /**
     * Load resource sprites.
     */
    private async loadResourceSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const fileSet = await this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        const DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7];

        return this.loadSpritesFromMap(
            getResourceSpriteMap(),
            (type, info) => DIRECTIONS.map(dir => ({ type, dir, jobIndex: info.index })),
            ({ dir, jobIndex }) => this.spriteLoader.loadJobSprite(
                fileSet, { jobIndex, directionIndex: dir, frameIndex: 0 }, atlas
            ),
            ({ type, dir }, sprite) => registry.registerResource(type, dir, sprite.entry)
        );
    }

    /**
     * Load unit sprites with all animation frames for all available directions.
     */
    private async loadUnitSprites(
        race: Race,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        const fileSet = await this.spriteLoader.loadFileSet(`${SETTLER_FILE_NUMBERS[race]}`);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        const spriteMap = getUnitSpriteMap(race);
        const unitInfos: Array<{ unitType: UnitType; jobIndex: number }> = [];

        for (const [typeStr, info] of Object.entries(spriteMap)) {
            if (!info) continue;
            unitInfos.push({
                unitType: Number(typeStr) as UnitType,
                jobIndex: info.index,
            });
        }

        let loadedCount = 0;

        await processBatchedWithHandler(
            unitInfos,
            async({ unitType, jobIndex }) => {
                // Load all directions with all frames using helper
                const loadedDirs = await this.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas);
                if (!loadedDirs) {
                    SpriteRenderManager.log.debug(`Job ${jobIndex} not found for unit ${UnitType[unitType]}`);
                    return null;
                }

                // Convert LoadedSprite[] to SpriteEntry[]
                const directionFrames = new Map<number, SpriteEntry[]>();
                for (const [dir, sprites] of loadedDirs) {
                    directionFrames.set(dir, sprites.map(s => s.entry));
                }

                return { unitType, jobIndex, directionFrames };
            },
            (result) => {
                if (!result || result.directionFrames.size === 0) return;

                const { unitType, directionFrames } = result;

                // Register animated unit with all directions and frames
                registry.registerAnimatedUnit(
                    unitType,
                    directionFrames,
                    ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                    true // loop
                );

                // Also register static sprites (first frame of each direction) for fallback
                for (const [dir, frames] of directionFrames) {
                    if (frames.length > 0) {
                        registry.registerUnit(unitType, dir, frames[0]);
                    }
                }

                loadedCount++;
            }
        );

        SpriteRenderManager.log.debug(`Loaded ${loadedCount} animated units for ${Race[race]}`);

        // Load carrier material variants (carrier carrying different goods)
        const carrierCount = await this.loadCarrierVariants(fileSet, atlas, registry);
        if (carrierCount > 0) {
            SpriteRenderManager.log.debug(`Loaded ${carrierCount} carrier material variants for ${Race[race]}`);
        }

        // Load worker-specific animations (e.g., woodcutter chopping)
        await this.loadWorkerAnimations(fileSet, atlas, registry);

        return loadedCount > 0;
    }

    /**
     * Load carrier sprite variants for each material type.
     * Each material has its own JIL job with 6 directions of walk frames.
     * These are registered as additional animation sequences on the Carrier entity
     * under keys like 'carry_0' (trunk), 'carry_9' (plank), etc.
     */
    private async loadCarrierVariants(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<number> {
        const entries = Object.entries(CARRIER_MATERIAL_JOB_INDICES) as [string, number | undefined][];
        const tasks: Array<{ materialType: EMaterialType; jobIndex: number }> = [];

        for (const [typeStr, jobIndex] of entries) {
            if (jobIndex === undefined) continue;
            tasks.push({ materialType: Number(typeStr) as EMaterialType, jobIndex });
        }

        if (tasks.length === 0) return 0;

        let loadedCount = 0;

        await processBatchedWithHandler(
            tasks,
            async({ materialType, jobIndex }) => {
                const loadedDirs = await this.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas);
                if (!loadedDirs) {
                    SpriteRenderManager.log.debug(
                        `Carrier job ${jobIndex} not found for material ${EMaterialType[materialType]}`
                    );
                    return null;
                }

                // Convert LoadedSprite[] to SpriteEntry[]
                const directionFrames = new Map<number, SpriteEntry[]>();
                for (const [dir, sprites] of loadedDirs) {
                    directionFrames.set(dir, sprites.map(s => s.entry));
                }

                return { materialType, directionFrames };
            },
            (result) => {
                if (!result || result.directionFrames.size === 0) return;

                const seqKey = carrySequenceKey(result.materialType);
                registry.registerAnimationSequence(
                    EntityType.Unit,
                    UnitType.Carrier,
                    seqKey,
                    result.directionFrames,
                    ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                    true
                );

                loadedCount++;
            }
        );

        return loadedCount;
    }

    /**
     * Load worker-specific animation sequences (e.g., woodcutter chopping).
     * These are registered as additional sequences on existing units.
     */
    private async loadWorkerAnimations(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<void> {
        // Load woodcutter work animation: chopping (56) + cutting log on ground (57)
        const choppingJobIndex = WORKER_JOB_INDICES.woodcutter.chopping;
        const cuttingLogJobIndex = WORKER_JOB_INDICES.woodcutter.cuttingLogOnGround;

        // Get direction count from whichever job exists
        const choppingDirCount = this.spriteLoader.getDirectionCount(fileSet, choppingJobIndex);
        const cuttingLogDirCount = this.spriteLoader.getDirectionCount(fileSet, cuttingLogJobIndex);

        if (choppingDirCount === 0 && cuttingLogDirCount === 0) {
            SpriteRenderManager.log.debug(`Woodcutter work jobs ${choppingJobIndex}/${cuttingLogJobIndex} not found`);
            return;
        }

        const dirCount = choppingDirCount || cuttingLogDirCount;

        const directionFrames = new Map<number, SpriteEntry[]>();

        for (let dir = 0; dir < dirCount; dir++) {
            const frames: SpriteEntry[] = [];

            // First: chopping animation (hitting the tree)
            if (choppingDirCount > 0) {
                const choppingAnim = await this.spriteLoader.loadJobAnimation(
                    fileSet, choppingJobIndex, dir, atlas
                );
                if (choppingAnim && choppingAnim.frames.length > 0) {
                    frames.push(...choppingAnim.frames.map(f => f.entry));
                }
            }

            // Second: cutting log on ground animation
            if (cuttingLogDirCount > 0) {
                const cuttingLogAnim = await this.spriteLoader.loadJobAnimation(
                    fileSet, cuttingLogJobIndex, dir, atlas
                );
                if (cuttingLogAnim && cuttingLogAnim.frames.length > 0) {
                    frames.push(...cuttingLogAnim.frames.map(f => f.entry));
                }
            }

            if (frames.length > 0) {
                directionFrames.set(dir, frames);
            }
        }

        if (directionFrames.size > 0) {
            registry.registerAnimationSequence(
                EntityType.Unit,
                UnitType.Woodcutter,
                ANIMATION_SEQUENCES.WORK,
                directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                true // loop
            );
            const totalFrames = directionFrames.get(0)?.length ?? 0;
            SpriteRenderManager.log.debug(
                `Loaded woodcutter work animation: ${directionFrames.size} directions, ${totalFrames} frames each`
            );
        }
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
