import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { PaletteTextureManager } from './palette-texture';
import { TEXTURE_UNIT_PALETTE } from './entity-renderer-constants';
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
import { ANIMATION_DEFAULTS, AnimationData, carrySequenceKey, workSequenceKey } from '../animation';
import { AnimationDataProvider } from '../systems/animation';
import { EMaterialType } from '../economy';
import {
    getAtlasCache,
    setAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    isCacheDisabled,
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

// =============================================================================
// Safe Progressive Loading Pattern
// =============================================================================
//
// To prevent black boxes during progressive rendering, sprites must only be
// registered (made visible) AFTER GPU upload. The pattern is:
//
//   1. Load sprites (blits to CPU buffer, collects results)
//   2. GPU upload (atlas.update)
//   3. Register sprites (now safe to render)
//
// The SafeLoadBatch helper enforces this pattern.

/**
 * Helper for safe progressive sprite loading.
 * Collects loaded sprites, then uploads to GPU, then registers.
 * This prevents black boxes from rendering before GPU has pixel data.
 */
class SafeLoadBatch<T> {
    private items: T[] = [];

    /** Add a loaded item to the batch */
    add(item: T): void {
        this.items.push(item);
    }

    /** Add multiple loaded items */
    addAll(items: T[]): void {
        this.items.push(...items);
    }

    /**
     * Finalize the batch: upload to GPU, then register all items.
     * @param atlas - The texture atlas to upload
     * @param gl - WebGL context for GPU upload
     * @param register - Function to register each item (called after GPU upload)
     */
    finalize(
        atlas: EntityTextureAtlas,
        gl: WebGL2RenderingContext,
        register: (item: T) => void
    ): void {
        if (this.items.length === 0) return;

        // GPU upload first
        atlas.update(gl);

        // Now safe to register
        for (const item of this.items) {
            register(item);
        }

        this.items = [];
    }

    get count(): number {
        return this.items.length;
    }
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

    /** Combined palette texture for palettized atlas rendering */
    private _paletteManager: PaletteTextureManager;

    constructor(fileManager: FileManager, textureUnit: number) {
        this.fileManager = fileManager;
        this.textureUnit = textureUnit;
        this.spriteLoader = new SpriteLoader(fileManager);
        this._paletteManager = new PaletteTextureManager(TEXTURE_UNIT_PALETTE);
    }

    /** Get the palette texture manager for binding during render */
    get paletteManager(): PaletteTextureManager {
        return this._paletteManager;
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
        const animated = this._spriteRegistry?.getAnimatedEntity(EntityType.Building, type) ?? null;
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
        const animated = this._spriteRegistry?.getAnimatedEntity(EntityType.MapObject, type) ?? null;
        return {
            static: staticSprite,
            animated,
        };
    }

    /**
     * Extract a sprite region from the atlas as RGBA ImageData.
     * Handles palette lookup internally — callers don't need to know about palettes.
     */
    public extractSpriteAsImageData(region: import('./entity-texture-atlas').AtlasRegion): ImageData | null {
        if (!this._spriteAtlas) return null;
        const paletteData = this._paletteManager.getPaletteData() ?? undefined;
        return this._spriteAtlas.extractRegion(region, paletteData);
    }

    /**
     * Clean up GPU resources. Call when switching races or destroying.
     */
    public cleanup(): void {
        this._spriteRegistry?.clear();
        this._spriteAtlas = null;
        if (this.glContext) {
            this._paletteManager.destroy(this.glContext);
        }
        this._paletteManager = new PaletteTextureManager(TEXTURE_UNIT_PALETTE);
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

        // Convert cached Uint8Array bytes back to Uint16Array for R16UI atlas
        const imgData16 = new Uint16Array(
            cached.imgData.buffer,
            cached.imgData.byteOffset,
            cached.imgData.byteLength / 2
        );

        // Restore atlas from cached data (multi-layer)
        const atlas = EntityTextureAtlas.fromCache(
            imgData16,
            cached.layerCount,
            cached.maxLayers,
            cached.slots,
            cached.textureUnit
        );

        // Restore registry from serialized data
        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);

        // Upload atlas to GPU
        atlas.update(gl);

        // Restore palette texture from cache
        if (cached.paletteData && cached.paletteOffsets && cached.paletteTotalColors) {
            this._paletteManager.restoreFromCache(
                cached.paletteData,
                cached.paletteOffsets,
                cached.paletteTotalColors
            );
            this._paletteManager.upload(gl);
        }

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
            atlasSize: `${atlas.layerCount}x${atlas.width}x${atlas.height}`,
            spriteCount: registry.getBuildingCount() + registry.getMapObjectCount() +
                registry.getResourceCount() + registry.getUnitCount(),
            cacheHit: true,
            cacheSource: source,
        });

        const sourceLabel = source === 'module' ? 'module cache (HMR)' : 'IndexedDB (refresh)';
        SpriteRenderManager.log.debug(
            `Restored sprites from ${sourceLabel} for ${Race[cached.race]} in ${elapsed.toFixed(1)}ms ` +
            `(${atlas.layerCount} layers, ${registry.getBuildingCount()} buildings)`
        );
    }

    /**
     * Save current atlas and registry to both cache tiers.
     */
    private async saveToCache(race: Race): Promise<void> {
        if (!this._spriteAtlas || !this._spriteRegistry) {
            return;
        }

        // Skip saving if caching is disabled
        if (isCacheDisabled()) {
            SpriteRenderManager.log.debug('Cache disabled, skipping save');
            return;
        }

        const cacheData: CachedAtlasData = {
            imgData: this._spriteAtlas.getImageDataBytes(),
            layerCount: this._spriteAtlas.layerCount,
            maxLayers: this._spriteAtlas.getMaxLayers(),
            slots: this._spriteAtlas.getSlots(),
            registryData: this._spriteRegistry.serialize(),
            race,
            textureUnit: this.textureUnit,
            timestamp: Date.now(),
            paletteOffsets: this._paletteManager.getFileBaseOffsets(),
            paletteTotalColors: this._paletteManager.colorCount,
            paletteData: this._paletteManager.getPaletteData() ?? undefined,
        };

        // Save to module cache (sync, for HMR)
        setAtlasCache(race, cacheData);

        // Save to IndexedDB (async, for page refresh) - don't await to avoid blocking
        setIndexedDBCache(race, cacheData).catch(e => {
            SpriteRenderManager.log.debug(`IndexedDB save failed (non-fatal): ${e}`);
        });
    }

    /**
     * Try to restore from cache (module or IndexedDB).
     * Returns true if restored successfully.
     */
    private async tryRestoreFromCache(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        if (isCacheDisabled()) {
            SpriteRenderManager.log.debug('Cache disabled via settings, loading from files');
            return false;
        }

        // Tier 1: Try module-level cache (instant, survives HMR)
        if (this.tryRestoreFromModuleCache(gl, race)) {
            return true;
        }

        // Tier 2: Try IndexedDB cache (fast, survives page refresh)
        return this.tryRestoreFromIndexedDB(gl, race);
    }

    /**
     * Record sprite loading timings to debug stats.
     */
    private recordLoadTimings(
        timings: {
            filePreload: number; atlasAlloc: number; buildings: number;
            mapObjects: number; resources: number; units: number; gpuUpload: number;
        },
        timer: ReturnType<typeof createTimer>,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): void {
        Object.assign(debugStats.state.loadTimings, {
            ...timings,
            totalSprites: timer.total(),
            atlasSize: `${atlas.layerCount}x${atlas.width}x${atlas.height}`,
            spriteCount: registry.getBuildingCount() + registry.getMapObjectCount() +
                registry.getResourceCount() + registry.getUnitCount(),
            cacheHit: false,
            cacheSource: null,
        });

        SpriteRenderManager.log.debug(
            `Sprite loading (ms): preload=${timings.filePreload}, buildings=${timings.buildings}, ` +
            `mapObj=${timings.mapObjects}, resources=${timings.resources}, units=${timings.units}, ` +
            `gpu=${timings.gpuUpload}, TOTAL=${timer.total()}, workers=${getDecoderPool().getDecodeCount()}`
        );
    }

    /**
     * Register palettes from loaded file sets into the combined palette texture.
     */
    private async registerPalettesForFiles(fileIds: string[]): Promise<void> {
        for (const fileId of fileIds) {
            const fileSet = await this.spriteLoader.loadFileSet(fileId);
            if (fileSet) {
                const paletteData = fileSet.paletteCollection.getPalette().getData();
                this._paletteManager.registerPalette(fileId, paletteData);
            }
        }
    }

    /** Get the palette base offset for a file, defaulting to 0 if unregistered. */
    private getPaletteBaseOffset(fileId: string): number {
        const offset = this._paletteManager.getBaseOffset(fileId);
        return offset >= 0 ? offset : 0;
    }

    /**
     * Load sprites for a specific race.
     */
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        // Try cache first
        if (await this.tryRestoreFromCache(gl, race)) {
            return true;
        }

        // Full load from files
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

        // Preload all files and warm up workers in parallel
        const allFileIds = [
            ...Array.from(buildingFiles).map(String),
            `${GFX_FILE_NUMBERS.MAP_OBJECTS}`,
            `${GFX_FILE_NUMBERS.RESOURCES}`,
            `${SETTLER_FILE_NUMBERS[race]}`,
        ];
        await Promise.all([
            ...allFileIds.map(id => this.spriteLoader.loadFileSet(id)),
            warmUpDecoderPool(),
        ]);

        await this.registerPalettesForFiles(allFileIds);
        const filePreload = t.lap();

        // Create atlas and registry
        // MAX_ARRAY_TEXTURE_LAYERS is typically 256-2048 in WebGL2
        const maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
        const atlas = new EntityTextureAtlas(Math.min(64, maxArrayLayers), this.textureUnit);
        const atlasAlloc = t.lap();
        const registry = new SpriteMetadataRegistry();

        // Expose for progressive rendering
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        // Load all sprite categories
        let loadedAny = false;
        for (const fileNum of buildingFiles) {
            if (await this.loadBuildingSprites(fileNum, atlas, registry, spriteMap, gl)) {
                loadedAny = true;
            }
        }
        const buildings = t.lap();

        const mapObjectsLoaded = await this.loadMapObjectSprites(gl, atlas, registry);
        const mapObjects = t.lap();

        const resourcesLoaded = await this.loadResourceSprites(atlas, registry, gl);
        const resources = t.lap();

        const unitsLoaded = await this.loadUnitSprites(race, atlas, registry, gl);
        const units = t.lap();

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded && !unitsLoaded) {
            return false;
        }

        atlas.update(gl);

        // Upload palette texture to GPU
        this._paletteManager.upload(gl);

        const gpuUpload = t.lap();

        this.saveToCache(race);
        this.recordLoadTimings({ filePreload, atlasAlloc, buildings, mapObjects, resources, units, gpuUpload }, t, atlas, registry);

        return registry.hasBuildingSprites() || registry.hasMapObjectSprites() ||
            registry.hasResourceSprites() || registry.hasUnitSprites();
    }

    /**
     * Load building sprites from a GFX file set.
     * Uses SafeLoadBatch to ensure GPU upload before registration.
     */
    private async loadBuildingSprites(
        fileNum: number,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        spriteMap: Partial<Record<BuildingType, { file: number; index: number }>>,
        gl: WebGL2RenderingContext
    ): Promise<boolean> {
        const fileId = `${fileNum}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet?.jilReader || !fileSet?.dilReader) {
            SpriteRenderManager.log.debug(`GFX/JIL/DIL files not available for ${fileNum}`);
            return false;
        }

        const paletteBase = this.getPaletteBaseOffset(fileId);

        try {
            type BuildingData = {
                buildingType: BuildingType;
                constructionEntry: SpriteEntry | null;
                completedEntry: SpriteEntry | null;
                animationFrames: SpriteEntry[] | null;
            };

            const batch = new SafeLoadBatch<BuildingData>();

            // Load all buildings for this file
            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info || info.file !== fileNum) continue;
                const buildingType = Number(typeStr) as BuildingType;

                const constructionSprite = await this.spriteLoader.loadJobSprite(
                    fileSet, { jobIndex: info.index, directionIndex: BUILDING_DIRECTION.CONSTRUCTION }, atlas, paletteBase
                );

                const frameCount = this.spriteLoader.getFrameCount(fileSet, info.index, BUILDING_DIRECTION.COMPLETED);
                let completedSprite = null;
                let animationFrames: SpriteEntry[] | null = null;

                if (frameCount > 1) {
                    const anim = await this.spriteLoader.loadJobAnimation(
                        fileSet, info.index, BUILDING_DIRECTION.COMPLETED, atlas, paletteBase
                    );
                    if (anim?.frames.length) {
                        animationFrames = anim.frames.map(f => f.entry);
                        completedSprite = anim.frames[0];
                    }
                } else {
                    completedSprite = await this.spriteLoader.loadJobSprite(
                        fileSet, { jobIndex: info.index, directionIndex: BUILDING_DIRECTION.COMPLETED }, atlas, paletteBase
                    );
                }

                batch.add({
                    buildingType,
                    constructionEntry: constructionSprite?.entry ?? null,
                    completedEntry: completedSprite?.entry ?? null,
                    animationFrames,
                });
            }

            // Finalize: GPU upload → register
            batch.finalize(atlas, gl, (data) => {
                if (!data.constructionEntry && !data.completedEntry) return;

                if (data.animationFrames) {
                    const frames = new Map([[BUILDING_DIRECTION.COMPLETED, data.animationFrames]]);
                    registry.registerAnimatedEntity(
                        EntityType.Building, data.buildingType, frames,
                        ANIMATION_DEFAULTS.FRAME_DURATION_MS, true
                    );
                }
                registry.registerBuilding(data.buildingType, data.constructionEntry, data.completedEntry);
            });

            return batch.count > 0;
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

        const paletteBase5 = this.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`);

        // Load trees using JIL-based structure
        const treeCount = await this.loadTreeSprites(fileSet5, atlas, registry, gl, paletteBase5);
        loadCount += treeCount;

        // Load resource map objects (coal, iron, etc.) using direction-based structure
        if (fileSet3) {
            const paletteBase3 = this.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.RESOURCES}`);
            const resourceCount = await this.loadResourceMapObjects(fileSet3, atlas, registry, paletteBase3);
            loadCount += resourceCount;
        }

        SpriteRenderManager.log.debug(`MapObject sprite loading complete: ${loadCount} sprites`);
        return loadCount > 0;
    }

    /**
     * Load tree sprites using JIL/DIL structure.
     * Trees have: D0-D2 = growth stages, D3 = normal (with sway animation), D4 = falling, D5 = canopy disappearing
     *
     * Loading is done progressively per tree type:
     * 1. Load all stages for one tree type
     * 2. Upload to GPU (atlas.update)
     * 3. Register sprites (now safe to render)
     * 4. Repeat for next tree type
     */
    private async loadTreeSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        if (!fileSet.jilReader || !fileSet.dilReader) {
            SpriteRenderManager.log.debug('Tree JIL/DIL not available, skipping tree loading');
            return 0;
        }

        type TreeStageData = {
            treeType: MapObjectType;
            offset: number;
            firstFrame: SpriteEntry;
            allFrames: SpriteEntry[] | null;
        };

        let totalLoaded = 0;

        // Process each tree type progressively (using SafeLoadBatch)
        for (const [typeStr, baseJobIndex] of Object.entries(TREE_JOB_INDICES)) {
            if (baseJobIndex === undefined) continue;
            const treeType = Number(typeStr) as MapObjectType;

            const batch = new SafeLoadBatch<TreeStageData>();

            // Load all 11 stages for this tree type
            for (let offset = 0; offset <= 10; offset++) {
                const anim = await this.spriteLoader.loadJobAnimation(
                    fileSet, baseJobIndex + offset, 0, atlas, paletteBaseOffset
                );
                if (anim?.frames.length) {
                    batch.add({
                        treeType,
                        offset,
                        firstFrame: anim.frames[0].entry,
                        allFrames: offset === TREE_JOB_OFFSET.NORMAL ? anim.frames.map(f => f.entry) : null,
                    });
                }
            }

            // GPU upload → register this tree type
            batch.finalize(atlas, gl, (data) => {
                registry.registerMapObject(data.treeType, data.firstFrame, data.offset);
                if (data.allFrames) {
                    registry.registerAnimatedEntity(
                        EntityType.MapObject, data.treeType,
                        new Map([[0, data.allFrames]]),
                        ANIMATION_DEFAULTS.FRAME_DURATION_MS, true
                    );
                }
                totalLoaded++;
            });

            // Yield to allow rendering before next tree type
            await new Promise(r => setTimeout(r, 0));
        }

        SpriteRenderManager.log.debug(`Loaded ${totalLoaded} tree sprites`);
        return totalLoaded;
    }

    /**
     * Load resource map objects (coal, iron, gold, stone, sulfur deposits).
     */
    private async loadResourceMapObjects(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        paletteBaseOffset: number
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
                    atlas,
                    paletteBaseOffset
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
     * Load resource sprites using SafeLoadBatch pattern.
     */
    private async loadResourceSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext
    ): Promise<boolean> {
        const fileId = `${GFX_FILE_NUMBERS.RESOURCES}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        const paletteBase = this.getPaletteBaseOffset(fileId);

        type ResourceData = { type: EMaterialType; dir: number; entry: SpriteEntry };
        const batch = new SafeLoadBatch<ResourceData>();

        for (const [typeStr, info] of Object.entries(getResourceSpriteMap())) {
            if (!info) continue;
            const type = Number(typeStr) as EMaterialType;

            for (let dir = 0; dir < 8; dir++) {
                const sprite = await this.spriteLoader.loadJobSprite(
                    fileSet, { jobIndex: info.index, directionIndex: dir, frameIndex: 0 }, atlas, paletteBase
                );
                if (sprite) {
                    batch.add({ type, dir, entry: sprite.entry });
                }
            }
        }

        batch.finalize(atlas, gl, (data) => {
            registry.registerResource(data.type, data.dir, data.entry);
        });

        return batch.count > 0;
    }

    /**
     * Load unit sprites with all animation frames using SafeLoadBatch pattern.
     */
    private async loadUnitSprites(
        race: Race,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext
    ): Promise<boolean> {
        const fileId = `${SETTLER_FILE_NUMBERS[race]}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet?.jilReader || !fileSet?.dilReader) return false;

        const paletteBase = this.getPaletteBaseOffset(fileId);

        type UnitData = { unitType: UnitType; directionFrames: Map<number, SpriteEntry[]> };
        const batch = new SafeLoadBatch<UnitData>();

        for (const [typeStr, info] of Object.entries(getUnitSpriteMap(race))) {
            if (!info) continue;
            const unitType = Number(typeStr) as UnitType;

            const loadedDirs = await this.spriteLoader.loadJobAllDirections(fileSet, info.index, atlas, paletteBase);
            if (!loadedDirs) {
                SpriteRenderManager.log.debug(`Job ${info.index} not found for unit ${UnitType[unitType]}`);
                continue;
            }

            const directionFrames = new Map<number, SpriteEntry[]>();
            for (const [dir, sprites] of loadedDirs) {
                directionFrames.set(dir, sprites.map(s => s.entry));
            }

            if (directionFrames.size > 0) {
                batch.add({ unitType, directionFrames });
            }
        }

        batch.finalize(atlas, gl, (data) => {
            registry.registerAnimatedEntity(
                EntityType.Unit, data.unitType, data.directionFrames,
                ANIMATION_DEFAULTS.FRAME_DURATION_MS, true
            );
            for (const [dir, frames] of data.directionFrames) {
                if (frames.length > 0) {
                    registry.registerUnit(data.unitType, dir, frames[0]);
                }
            }
        });

        SpriteRenderManager.log.debug(`Loaded ${batch.count} animated units for ${Race[race]}`);

        // Load carrier variants and worker animations (also need safe pattern)
        await this.loadCarrierVariants(fileSet, atlas, registry, gl, paletteBase);
        await this.loadWorkerAnimations(fileSet, atlas, registry, gl, paletteBase);

        return batch.count > 0;
    }

    /**
     * Load carrier sprite variants for each material type using SafeLoadBatch.
     */
    private async loadCarrierVariants(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        type CarrierData = { materialType: EMaterialType; directionFrames: Map<number, SpriteEntry[]> };
        const batch = new SafeLoadBatch<CarrierData>();

        for (const [typeStr, jobIndex] of Object.entries(CARRIER_MATERIAL_JOB_INDICES)) {
            if (jobIndex === undefined) continue;
            const materialType = Number(typeStr) as EMaterialType;

            const loadedDirs = await this.spriteLoader.loadJobAllDirections(fileSet, jobIndex, atlas, paletteBaseOffset);
            if (!loadedDirs) {
                SpriteRenderManager.log.debug(`Carrier job ${jobIndex} not found for ${EMaterialType[materialType]}`);
                continue;
            }

            const directionFrames = new Map<number, SpriteEntry[]>();
            for (const [dir, sprites] of loadedDirs) {
                directionFrames.set(dir, sprites.map(s => s.entry));
            }

            if (directionFrames.size > 0) {
                batch.add({ materialType, directionFrames });
            }
        }

        batch.finalize(atlas, gl, (data) => {
            // Register carry animations for all unit types that can carry materials
            const carryingUnitTypes = [UnitType.Carrier, UnitType.Woodcutter];
            for (const unitType of carryingUnitTypes) {
                registry.registerAnimationSequence(
                    EntityType.Unit, unitType, carrySequenceKey(data.materialType),
                    data.directionFrames, ANIMATION_DEFAULTS.FRAME_DURATION_MS, true
                );
            }
        });

        if (batch.count > 0) {
            SpriteRenderManager.log.debug(`Loaded ${batch.count} carrier material variants`);
        }
        return batch.count;
    }

    /**
     * Mapping from WORKER_JOB_INDICES keys to UnitType.
     * Used by loadWorkerAnimations to register work sequences.
     */
    private static readonly WORKER_KEY_TO_UNIT_TYPE: Record<string, UnitType> = {
        carrier: UnitType.Carrier,
        digger: UnitType.Digger,
        smith: UnitType.Smith,
        builder: UnitType.Builder,
        woodcutter: UnitType.Woodcutter,
        miner: UnitType.Miner,
        forester: UnitType.Forester,
        farmer: UnitType.Farmer,
        priest: UnitType.Priest,
        geologist: UnitType.Geologist,
        pioneer: UnitType.Pioneer,
        swordsman_1: UnitType.Swordsman,
        swordsman_2: UnitType.Swordsman,
        swordsman_3: UnitType.Swordsman,
        bowman_1: UnitType.Bowman,
        bowman_2: UnitType.Bowman,
        bowman_3: UnitType.Bowman,
    };

    /**
     * Load worker-specific animation sequences using SafeLoadBatch.
     */
    private async loadWorkerAnimations(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<void> {
        type WorkAnimData = {
            unitType: UnitType;
            seqKey: string;
            frames: Map<number, SpriteEntry[]>;
        };

        const batch = new SafeLoadBatch<WorkAnimData>();

        for (const [workerKey, workerData] of Object.entries(WORKER_JOB_INDICES)) {
            if (!('work' in workerData)) continue;

            const unitType = SpriteRenderManager.WORKER_KEY_TO_UNIT_TYPE[workerKey];
            if (unitType === undefined) continue;

            const workJobIndices = workerData.work as readonly number[];

            for (let workIndex = 0; workIndex < workJobIndices.length; workIndex++) {
                const jobIndex = workJobIndices[workIndex];
                const dirCount = this.spriteLoader.getDirectionCount(fileSet, jobIndex);
                if (dirCount === 0) continue;

                const frames = new Map<number, SpriteEntry[]>();
                for (let dir = 0; dir < dirCount; dir++) {
                    const anim = await this.spriteLoader.loadJobAnimation(fileSet, jobIndex, dir, atlas, paletteBaseOffset);
                    if (anim?.frames.length) {
                        frames.set(dir, anim.frames.map(f => f.entry));
                    }
                }

                if (frames.size > 0) {
                    batch.add({
                        unitType,
                        seqKey: workSequenceKey(workIndex),
                        frames,
                    });
                }
            }
        }

        let loadedCount = 0;
        batch.finalize(atlas, gl, (data) => {
            registry.registerAnimationSequence(
                EntityType.Unit, data.unitType, data.seqKey,
                data.frames, ANIMATION_DEFAULTS.FRAME_DURATION_MS, true
            );
            loadedCount++;
        });

        if (loadedCount > 0) {
            SpriteRenderManager.log.debug(`Loaded ${loadedCount} worker animation sequences`);
        }
    }

}
