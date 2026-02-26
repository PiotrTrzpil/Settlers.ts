import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { PaletteTextureManager } from './palette-texture';
import { TEXTURE_UNIT_PALETTE } from './entity-renderer-constants';
import { debugStats } from '@/game/debug-stats';
import {
    SpriteMetadataRegistry,
    SpriteEntry,
    Race,
    getBuildingSpriteMap,
    GFX_FILE_NUMBERS,
    getMapObjectSpriteMap,
    getResourceSpriteMap,
    BUILDING_DIRECTION,
    AnimatedSpriteEntry,
    SETTLER_FILE_NUMBERS,
    TREE_JOB_OFFSET,
    TREE_JOB_INDICES,
    AVAILABLE_RACES,
    type BuildingSpriteInfo,
} from './sprite-metadata';
import { MAP_OBJECT_SPRITES } from './sprite-metadata/gil-indices';
import { STONE_DEPLETION_STAGES } from '../features/stones/stone-system';
import { SpriteLoader, type LoadedGfxFileSet } from './sprite-loader';
import { destroyDecoderPool, getDecoderPool, warmUpDecoderPool } from './sprite-decoder-pool';
import { yieldToEventLoop } from './batch-loader';
import { BuildingType, MapObjectType, UnitType, EntityType } from '../entity';
import { isBuildingAvailableForRace } from '../race-availability';
import { ANIMATION_DEFAULTS, AnimationData } from '../animation';
import { AnimationDataProvider } from '../systems/animation';
import { EMaterialType } from '../economy';
import { buildDecorationSpriteMap, type DecorationSpriteRef } from '../systems/map-objects';
import { TEAM_COLOR_PALETTES } from '@/resources/gfx/team-colors';
import { loadUnitSpritesForRace, type UnitLoadContext } from './sprite-unit-loader';
import {
    getAtlasCache,
    setAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    isCacheDisabled,
    type CachedAtlasData,
} from './sprite-cache';

// Module-level prefetch: started early (during map load) to overlap IDB read with game construction.
let earlyPrefetch: Promise<CachedAtlasData | null> | null = null;

/**
 * Start prefetching the sprite atlas from IndexedDB as early as possible.
 * Call at the start of map load so the IDB read overlaps with game construction,
 * not just landscape init. The SpriteRenderManager picks this up automatically.
 * No-op if a prefetch is already in flight.
 */
export function prefetchSpriteCache(): void {
    if (!earlyPrefetch && !isCacheDisabled()) {
        earlyPrefetch = getIndexedDBCache(Race.Roman);
    }
}

/** Simple timer for measuring phases */
function createTimer() {
    const start = performance.now();
    let last = start;
    return {
        lap: () => {
            const now = performance.now();
            const elapsed = Math.round(now - last);
            last = now;
            return elapsed;
        },
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
    finalize(atlas: EntityTextureAtlas, gl: WebGL2RenderingContext, register: (item: T) => void): void {
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
    // OK: nullable - null until init() loads sprites, allows graceful fallback to procedural rendering
    private _spriteAtlas: EntityTextureAtlas | null = null;
    private _spriteRegistry: SpriteMetadataRegistry | null = null;
    private _currentRace: Race = Race.Roman;

    /** Combined palette texture for palettized atlas rendering */
    private _paletteManager: PaletteTextureManager;

    /** Prefetched IndexedDB cache promise (started before GL is ready) */
    private _prefetchedCache: Promise<CachedAtlasData | null> | null = null;

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
     * Drain pending atlas GPU uploads, spreading work across frames.
     * Call once per frame from the render loop to keep uploads non-blocking.
     *
     * @param gl WebGL context
     * @param maxLayers Maximum dirty layers to upload this frame (default 3)
     */
    public drainPendingUploads(gl: WebGL2RenderingContext, maxLayers = 3): void {
        if (this._spriteAtlas?.hasPendingUploads) {
            this._spriteAtlas.uploadBudgeted(gl, maxLayers);
        }
    }

    /**
     * Adopt the module-level early prefetch (started during map load), or start
     * a new IDB read if no early prefetch is available.
     */
    public prefetchCache(): void {
        if (isCacheDisabled()) return;
        if (earlyPrefetch) {
            this._prefetchedCache = earlyPrefetch;
            earlyPrefetch = null;
        } else {
            this._prefetchedCache = getIndexedDBCache(this._currentRace);
        }
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
     * Get a building sprite entry by type and race (completed state).
     */
    public getBuilding(type: BuildingType, race?: number): SpriteEntry | null {
        return this._spriteRegistry?.getBuilding(type, race ?? this._currentRace) ?? null;
    }

    /**
     * Get a building construction sprite entry by type and race.
     */
    public getBuildingConstruction(type: BuildingType, race?: number): SpriteEntry | null {
        return this._spriteRegistry?.getBuildingConstruction(type, race ?? this._currentRace) ?? null;
    }

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
    public getAnimatedEntity(entityType: EntityType, subType: number, race?: number): AnimatedSpriteEntry | null {
        return this._spriteRegistry?.getAnimatedEntity(entityType, subType, race) ?? null;
    }

    /**
     * Check if any entity type has animation frames. O(1) lookup.
     */
    public hasAnimation(entityType: EntityType, subType: number, race?: number): boolean {
        return this._spriteRegistry?.hasAnimation(entityType, subType, race) ?? false;
    }

    /**
     * Get animation data for any entity type. O(1) lookup.
     */
    public getAnimationData(entityType: EntityType, subType: number, race?: number): AnimationData | null {
        const entry = this._spriteRegistry?.getAnimatedEntity(entityType, subType, race);
        return entry?.animationData ?? null;
    }

    /**
     * Returns this manager as an AnimationDataProvider.
     * Implements the unified interface for the animation system.
     */
    public asAnimationProvider(): AnimationDataProvider {
        return {
            getAnimationData: (entityType: EntityType, subType: number, race?: number) =>
                this.getAnimationData(entityType, subType, race),
            hasAnimation: (entityType: EntityType, subType: number, race?: number) =>
                this.hasAnimation(entityType, subType, race),
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
    public getUnit(type: UnitType, direction: number = 0, race?: number): SpriteEntry | null {
        return this._spriteRegistry?.getUnit(type, direction, race) ?? null;
    }

    /**
     * Get a flag sprite frame for a player index and animation frame.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-23)
     */
    public getFlag(playerIndex: number, frame: number): SpriteEntry | null {
        return this._spriteRegistry?.getFlag(playerIndex, frame) ?? null;
    }

    /** Number of flag animation frames for a player color. */
    public getFlagFrameCount(playerIndex: number): number {
        return this._spriteRegistry?.getFlagFrameCount(playerIndex) ?? 0;
    }

    /** Get the territory dot sprite for a player index (0-7). */
    public getTerritoryDot(playerIndex: number): SpriteEntry | null {
        return this._spriteRegistry?.getTerritoryDot(playerIndex) ?? null;
    }

    /**
     * Get loaded overlay sprite frames by GFX file reference.
     * Returns null if the overlay sprites haven't been loaded yet.
     */
    public getOverlayFrames(gfxFile: number, jobIndex: number, directionIndex = 0): readonly SpriteEntry[] | null {
        return this._spriteRegistry?.getOverlayFrames(gfxFile, jobIndex, directionIndex) ?? null;
    }

    /**
     * Extract a sprite region from the atlas as RGBA ImageData.
     * Handles palette lookup internally — callers don't need to know about palettes.
     */
    public extractSpriteAsImageData(
        region: import('./entity-texture-atlas').AtlasRegion,
        paletteBaseOffset = 0
    ): ImageData | null {
        if (!this._spriteAtlas) return null;
        const paletteData = this._paletteManager.getPaletteData() ?? undefined;
        return this._spriteAtlas.extractRegion(region, paletteData, paletteBaseOffset);
    }

    /**
     * Load overlay sprites into the atlas.
     *
     * Call after building sprites are loaded (setRace / init). Accepts a manifest
     * of (gfxFile, jobIndex, directionIndex) tuples — typically produced by
     * OverlayRegistry.getSpriteManifest().
     *
     * @returns Number of overlay sprite sets successfully loaded.
     */
    public async loadOverlaySprites(
        manifest: readonly { gfxFile: number; jobIndex: number; directionIndex?: number }[]
    ): Promise<number> {
        const gl = this.glContext;
        const atlas = this._spriteAtlas;
        const registry = this._spriteRegistry;
        if (!gl || !atlas || !registry) return 0;

        // Deduplicate by key
        const seen = new Set<string>();
        const unique: { gfxFile: number; jobIndex: number; directionIndex: number }[] = [];
        for (const entry of manifest) {
            const dir = entry.directionIndex ?? 0;
            const key = `${entry.gfxFile}:${entry.jobIndex}:${dir}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push({ gfxFile: entry.gfxFile, jobIndex: entry.jobIndex, directionIndex: dir });
        }

        let loaded = 0;
        for (const entry of unique) {
            const fileSet = await this.spriteLoader.loadFileSet(String(entry.gfxFile));
            if (!fileSet) continue;

            const paletteBase = this._paletteManager.getBaseOffset(String(entry.gfxFile));
            const anim = await this.spriteLoader.loadJobAnimation(
                fileSet,
                entry.jobIndex,
                entry.directionIndex,
                atlas,
                paletteBase
            );
            if (anim && anim.frames.length > 0) {
                const frames = anim.frames.map(f => f.entry);
                registry.registerOverlayFrames(entry.gfxFile, entry.jobIndex, entry.directionIndex, frames);
                loaded++;
            } else {
                // Try single frame
                const sprite = await this.spriteLoader.loadJobSprite(
                    fileSet,
                    { jobIndex: entry.jobIndex, directionIndex: entry.directionIndex },
                    atlas,
                    paletteBase
                );
                if (sprite) {
                    registry.registerOverlayFrames(entry.gfxFile, entry.jobIndex, entry.directionIndex, [sprite.entry]);
                    loaded++;
                }
            }
        }

        if (loaded > 0) {
            atlas.update(gl);
        }

        return loaded;
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
        // Use prefetched result if available (started during landscape init), otherwise fetch now
        const t0 = performance.now();
        const cached = await (this._prefetchedCache ?? getIndexedDBCache(race));
        debugStats.state.loadTimings.cacheWait = Math.round(performance.now() - t0);
        this._prefetchedCache = null;
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
        const t = createTimer();

        // Phase 1: Uint16Array view + atlas setup
        const imgData16 = new Uint16Array(
            cached.imgData.buffer,
            cached.imgData.byteOffset,
            cached.imgData.byteLength / 2
        );

        const atlas = EntityTextureAtlas.fromCache(
            imgData16,
            cached.layerCount,
            cached.maxLayers,
            cached.slots,
            cached.textureUnit
        );

        // Phase 2: Registry deserialize
        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);
        const deserialize = t.lap();

        // Phase 3: GPU upload — upload ALL layers at once for instant visibility on cache hit
        atlas.update(gl);
        const gpuUpload = t.lap();

        // Phase 4: Palette restore
        if (cached.paletteData && cached.paletteOffsets && cached.paletteTotalColors) {
            this._paletteManager.restoreFromCache(
                cached.paletteData,
                cached.paletteOffsets,
                cached.paletteTotalColors,
                cached.paletteRows
            );
            this._paletteManager.upload(gl);
        }

        // Set as active
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        const total = t.total();

        // Record cache hit in debug stats
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload: 0,
            atlasAlloc: 0,
            buildings: 0,
            mapObjects: 0,
            resources: 0,
            units: 0,
            deserialize,
            gpuUpload,
            totalSprites: total,
            atlasSize: `${atlas.layerCount}x${atlas.width}x${atlas.height}`,
            spriteCount:
                registry.getBuildingCount() +
                registry.getMapObjectCount() +
                registry.getResourceCount() +
                registry.getUnitCount(),
            cacheHit: true,
            cacheSource: source,
        });

        const sourceLabel = source === 'module' ? 'module cache (HMR)' : 'IndexedDB (refresh)';
        SpriteRenderManager.log.debug(
            `Restored from ${sourceLabel} in ${total}ms (deserialize=${deserialize}, gpu=${gpuUpload}, ` +
                `${atlas.layerCount} layers, ${registry.getBuildingCount()} buildings)`
        );
    }

    /**
     * Save current atlas and registry to both cache tiers.
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- cache save is fire-and-forget
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
            paletteRows: this._paletteManager.rowCount,
        };

        // Save to module cache (sync, for HMR)
        setAtlasCache(race, cacheData);

        // Save to IndexedDB (async, for page refresh) - don't await to avoid blocking
        setIndexedDBCache(race, cacheData).catch((e: unknown) => {
            SpriteRenderManager.log.warn(`IndexedDB cache save failed (non-fatal): ${e}`);
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
            filePreload: number;
            atlasAlloc: number;
            buildings: number;
            mapObjects: number;
            resources: number;
            units: number;
            unitsByRace: Record<string, number>;
            gpuUpload: number;
        },
        timer: ReturnType<typeof createTimer>,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): void {
        Object.assign(debugStats.state.loadTimings, {
            ...timings,
            deserialize: 0,
            totalSprites: timer.total(),
            atlasSize: `${atlas.layerCount}x${atlas.width}x${atlas.height}`,
            spriteCount:
                registry.getBuildingCount() +
                registry.getMapObjectCount() +
                registry.getResourceCount() +
                registry.getUnitCount(),
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
     * Only settler/unit files get team color slot registration — buildings use
     * separate flag sprites for team colors, not palette substitution.
     */
    private async registerPalettesForFiles(fileIds: string[], teamColorFileIds: Set<string>): Promise<void> {
        for (const fileId of fileIds) {
            const fileSet = await this.spriteLoader.loadFileSet(fileId);
            if (fileSet) {
                const paletteData = fileSet.paletteCollection.getPalette().getData();
                const baseOffset = this._paletteManager.registerPalette(fileId, paletteData);

                if (teamColorFileIds.has(fileId)) {
                    const uniqueOffsets = fileSet.paletteCollection.getUniquePaletteOffsets();
                    this._paletteManager.registerTeamColorSlots(baseOffset, uniqueOffsets);
                }
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
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity -- multi-race sprite loading requires sequential file I/O
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        // Try cache first — combined atlas keyed by `race` (always Roman on init).
        // TODO: cache per-race separately to enable prioritized loading (current player race first)
        if (await this.tryRestoreFromCache(gl, race)) {
            return true;
        }

        // Full load from files
        const t = createTimer();

        // Load buildings and units for ALL available races (race-specific)
        // Map objects and resources are shared across races
        const racesToLoad = AVAILABLE_RACES;

        // Collect all building GFX files across all races
        const buildingFiles = new Set<number>();
        const spriteMapsPerRace = new Map<Race, Partial<Record<BuildingType, BuildingSpriteInfo>>>();
        for (const r of racesToLoad) {
            const spriteMap = getBuildingSpriteMap(r);
            spriteMapsPerRace.set(r, spriteMap);
            for (const info of Object.values(spriteMap)) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial values
                if (info) buildingFiles.add(info.file);
            }
        }

        if (buildingFiles.size === 0) {
            SpriteRenderManager.log.debug('No building sprites configured');
            return false;
        }

        // Preload all files for all races and warm up workers in parallel
        const allFileIds = [
            ...Array.from(buildingFiles).map(String),
            `${GFX_FILE_NUMBERS.MAP_OBJECTS}`,
            `${GFX_FILE_NUMBERS.RESOURCES}`,
            ...racesToLoad.map(r => `${SETTLER_FILE_NUMBERS[r]}`),
        ];
        await Promise.all([...allFileIds.map(id => this.spriteLoader.loadFileSet(id)), warmUpDecoderPool()]);

        const teamColorFileIds = new Set(racesToLoad.map(r => `${SETTLER_FILE_NUMBERS[r]}`));
        await this.registerPalettesForFiles(allFileIds, teamColorFileIds);
        const filePreload = t.lap();

        // Create atlas and registry with larger capacity for multi-race sprites
        const maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
        const atlas = new EntityTextureAtlas(Math.min(256, maxArrayLayers), this.textureUnit);
        const atlasAlloc = t.lap();
        const registry = new SpriteMetadataRegistry();

        // Expose for progressive rendering
        this._spriteAtlas = atlas;
        this._spriteRegistry = registry;

        // Load building sprites for every race, yielding between races
        let loadedAny = false;
        for (const r of racesToLoad) {
            const spriteMap = spriteMapsPerRace.get(r)!;
            for (const fileNum of buildingFiles) {
                if (await this.loadBuildingSprites(fileNum, atlas, registry, spriteMap, gl, r)) {
                    loadedAny = true;
                }
            }
            await yieldToEventLoop();
        }
        const buildings = t.lap();

        const mapObjectsLoaded = await this.loadMapObjectSprites(gl, atlas, registry);
        const mapObjects = t.lap();

        const resourcesLoaded = await this.loadResourceSprites(atlas, registry, gl);
        const resources = t.lap();

        // Load unit sprites for every race, yielding between races
        let unitsLoaded = false;
        const unitRaceTimings: Record<string, number> = {};
        for (const r of racesToLoad) {
            const raceStart = performance.now();
            if (await loadUnitSpritesForRace(r, atlas, registry, gl, this.unitLoadContext)) {
                unitsLoaded = true;
            }
            unitRaceTimings[Race[r]] = Math.round(performance.now() - raceStart);
            await yieldToEventLoop();
        }
        const units = t.lap();

        if (!loadedAny && !mapObjectsLoaded && !resourcesLoaded && !unitsLoaded) {
            return false;
        }

        atlas.update(gl);

        // Create per-player palette rows with S4 team color substitution, then upload to GPU
        await this._paletteManager.createPlayerPalettes(TEAM_COLOR_PALETTES.length);
        this._paletteManager.upload(gl);

        const gpuUpload = t.lap();

        void this.saveToCache(race);
        this.recordLoadTimings(
            {
                filePreload,
                atlasAlloc,
                buildings,
                mapObjects,
                resources,
                units,
                unitsByRace: unitRaceTimings,
                gpuUpload,
            },
            t,
            atlas,
            registry
        );

        return (
            registry.hasBuildingSprites() ||
            registry.hasMapObjectSprites() ||
            registry.hasResourceSprites() ||
            registry.hasUnitSprites()
        );
    }

    /** Load sprites for a single building into a batch entry. Returns null if the building has no sprite data. */
    private async loadOneBuildingSprites(
        fileSet: LoadedGfxFileSet,
        buildingType: BuildingType,
        info: BuildingSpriteInfo,
        atlas: EntityTextureAtlas,
        paletteBase: number,
        race: Race
    ): Promise<{
        constructionEntry: SpriteEntry | null;
        completedEntry: SpriteEntry | null;
        animationFrames: SpriteEntry[] | null;
    } | null> {
        // Some buildings store construction/completed as separate JIL jobs
        // (e.g., SunflowerFarmerHut uses JIL #109 for construction, #110 for completed)
        const hasSplitJobs = info.constructionIndex !== undefined;
        const constructionJobIndex = info.constructionIndex ?? info.index;
        const constructionDirIndex = hasSplitJobs ? 0 : BUILDING_DIRECTION.CONSTRUCTION;
        const completedDirIndex = hasSplitJobs ? 0 : BUILDING_DIRECTION.COMPLETED;

        const dirCount = this.spriteLoader.getDirectionCount(fileSet, constructionJobIndex);
        if (dirCount === 0) {
            SpriteRenderManager.log.warn(
                `No sprite directions for ${BuildingType[buildingType]} (job ${constructionJobIndex}) in ${Race[race]} file`
            );
            return null;
        }

        const constructionSprite = await this.spriteLoader.loadJobSprite(
            fileSet,
            { jobIndex: constructionJobIndex, directionIndex: constructionDirIndex },
            atlas,
            paletteBase
        );

        const frameCount = this.spriteLoader.getFrameCount(fileSet, info.index, completedDirIndex);
        let completedSprite = null;
        let animationFrames: SpriteEntry[] | null = null;

        if (frameCount > 1) {
            const anim = await this.spriteLoader.loadJobAnimation(
                fileSet,
                info.index,
                completedDirIndex,
                atlas,
                paletteBase
            );
            if (anim?.frames.length) {
                animationFrames = anim.frames.map(f => f.entry);
                completedSprite = anim.frames[0];
            }
        } else {
            completedSprite = await this.spriteLoader.loadJobSprite(
                fileSet,
                { jobIndex: info.index, directionIndex: completedDirIndex },
                atlas,
                paletteBase
            );
        }

        return {
            constructionEntry: constructionSprite?.entry ?? null,
            completedEntry: completedSprite?.entry ?? null,
            animationFrames,
        };
    }

    /**
     * Load building sprites from a GFX file set.
     * Uses SafeLoadBatch to ensure GPU upload before registration.
     */
    private async loadBuildingSprites(
        fileNum: number,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        spriteMap: Partial<Record<BuildingType, BuildingSpriteInfo>>,
        gl: WebGL2RenderingContext,
        race: Race
    ): Promise<boolean> {
        const fileId = `${fileNum}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet?.jilReader || !fileSet.dilReader) {
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

            // Load all buildings for this file (skip buildings unavailable to this race)
            for (const [typeStr, info] of Object.entries(spriteMap)) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined
                if (!info || info.file !== fileNum) continue;
                const buildingType = Number(typeStr) as BuildingType;
                if (!isBuildingAvailableForRace(buildingType, race)) continue;

                const sprites = await this.loadOneBuildingSprites(
                    fileSet,
                    buildingType,
                    info,
                    atlas,
                    paletteBase,
                    race
                );
                if (sprites) batch.add({ buildingType, ...sprites });
            }

            // Finalize: GPU upload → register
            batch.finalize(atlas, gl, data => {
                if (!data.constructionEntry && !data.completedEntry) return;

                if (data.animationFrames) {
                    const frames = new Map([[BUILDING_DIRECTION.COMPLETED, data.animationFrames]]);
                    registry.registerAnimatedEntity(
                        EntityType.Building,
                        data.buildingType,
                        frames,
                        ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                        true,
                        race
                    );
                }
                registry.registerBuilding(data.buildingType, data.constructionEntry, data.completedEntry, race);
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
            this.spriteLoader.loadFileSet(`${GFX_FILE_NUMBERS.RESOURCES}`),
        ]);

        if (!fileSet5) return false;

        const paletteBase5 = this.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.MAP_OBJECTS}`);

        const treeCount = await this.loadTreeSprites(fileSet5, atlas, registry, gl, paletteBase5);
        const stoneCount = await this.loadStoneSprites(fileSet5, atlas, registry, gl, paletteBase5);
        const decoCount = await this.loadDecorationSprites(fileSet5, atlas, registry, gl, paletteBase5);
        const flagCount = await this.loadFlagSprites(fileSet5, atlas, registry, gl, paletteBase5);
        const dotCount = await this.loadTerritoryDotSprites(fileSet5, atlas, registry, gl, paletteBase5);

        let resourceCount = 0;
        if (fileSet3) {
            const paletteBase3 = this.getPaletteBaseOffset(`${GFX_FILE_NUMBERS.RESOURCES}`);
            resourceCount = await this.loadResourceMapObjects(fileSet3, atlas, registry, paletteBase3);
        }

        const total = treeCount + stoneCount + decoCount + flagCount + dotCount + resourceCount;
        SpriteRenderManager.log.debug(
            `MapObjects: ${treeCount} trees, ${stoneCount} stones, ${decoCount} decorations, ${flagCount} flags, ` +
                `${dotCount} territory dots, ${resourceCount} resources (${total} total)`
        );
        return total > 0;
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
            const treeType = Number(typeStr) as MapObjectType;

            const batch = new SafeLoadBatch<TreeStageData>();

            // Load all 11 stages for this tree type
            for (let offset = 0; offset <= 10; offset++) {
                const anim = await this.spriteLoader.loadJobAnimation(
                    fileSet,
                    baseJobIndex + offset,
                    0,
                    atlas,
                    paletteBaseOffset
                );
                if (anim?.frames.length) {
                    batch.add({
                        treeType,
                        offset,
                        firstFrame: anim.frames[0]!.entry,
                        allFrames: offset === TREE_JOB_OFFSET.NORMAL ? anim.frames.map(f => f.entry) : null,
                    });
                }
            }

            // GPU upload → register this tree type
            batch.finalize(atlas, gl, data => {
                registry.registerMapObject(data.treeType, data.firstFrame, data.offset);
                if (data.allFrames) {
                    registry.registerAnimatedEntity(
                        EntityType.MapObject,
                        data.treeType,
                        new Map([[0, data.allFrames]]),
                        ANIMATION_DEFAULTS.FRAME_DURATION_MS,
                        true
                    );
                }
                totalLoaded++;
            });

            // Yield to allow rendering before next tree type
            await new Promise(r => setTimeout(r, 0));
        }

        return totalLoaded;
    }

    /**
     * Load harvestable stone depletion sprites from direct GIL indices.
     * 2 variants (A, B) × 13 stages = 26 sprites for ResourceStone.
     * Variation layout: variant * 13 + stage (A: 0-12, B: 13-25).
     */
    private async loadStoneSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        type StoneStageData = { variation: number; entry: SpriteEntry };
        const batch = new SafeLoadBatch<StoneStageData>();

        const variants = [MAP_OBJECT_SPRITES.STONE_STAGES_A, MAP_OBJECT_SPRITES.STONE_STAGES_B];

        for (let v = 0; v < variants.length; v++) {
            const range = variants[v]!;
            for (let stage = 0; stage < range.count; stage++) {
                const gilIndex = range.start + stage;
                const sprite = await this.spriteLoader.loadDirectSprite(
                    fileSet,
                    gilIndex,
                    null,
                    atlas,
                    paletteBaseOffset
                );
                if (sprite) {
                    batch.add({ variation: v * STONE_DEPLETION_STAGES + stage, entry: sprite.entry });
                }
            }
        }

        let loaded = 0;
        batch.finalize(atlas, gl, data => {
            registry.registerMapObject(MapObjectType.ResourceStone, data.entry, data.variation);
            loaded++;
        });

        return loaded;
    }

    /**
     * Load decoration sprites (non-tree map objects) using direct GIL indices.
     * Deduplicates by GIL index so each unique sprite is loaded once,
     * then registered for all raw byte values that share it.
     */
    private async loadDecorationSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        const decoMap = buildDecorationSpriteMap();

        // Deduplicate: group raw values by gilIndex to avoid loading the same sprite multiple times
        const byGilIndex = new Map<number, { ref: DecorationSpriteRef; rawValues: number[] }>();
        for (const [raw, ref] of decoMap) {
            const existing = byGilIndex.get(ref.gilIndex);
            if (existing) {
                existing.rawValues.push(raw);
            } else {
                byGilIndex.set(ref.gilIndex, { ref, rawValues: [raw] });
            }
        }

        type DecoData = { rawValues: number[]; firstFrame: SpriteEntry; allFrames: SpriteEntry[] | null };
        const batch = new SafeLoadBatch<DecoData>();

        for (const { ref, rawValues } of byGilIndex.values()) {
            const loaded = await this.loadDecoEntry(fileSet, ref, atlas, paletteBaseOffset);
            if (loaded) batch.add({ rawValues, ...loaded });
        }

        let totalRegistered = 0;
        batch.finalize(atlas, gl, data => {
            for (const raw of data.rawValues) {
                registry.registerMapObject(raw as MapObjectType, data.firstFrame);
                totalRegistered++;
            }
        });

        return totalRegistered;
    }

    /** Load a single decoration sprite (first frame only, no animation for now) */
    private async loadDecoEntry(
        fileSet: LoadedGfxFileSet,
        ref: DecorationSpriteRef,
        atlas: EntityTextureAtlas,
        paletteBaseOffset: number
    ): Promise<{ firstFrame: SpriteEntry; allFrames: null } | null> {
        const sprite = await this.spriteLoader.loadDirectSprite(fileSet, ref.gilIndex, null, atlas, paletteBaseOffset);
        return sprite ? { firstFrame: sprite.entry, allFrames: null } : null;
    }

    /**
     * Load small animated flag sprites (8 player colors × 24 frames).
     * Flags are loaded from MAP_OBJECT_SPRITES in the landscape GFX file (5.gfx).
     */
    private async loadFlagSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        const FLAG_RANGES = [
            MAP_OBJECT_SPRITES.FLAG_SMALL_RED,
            MAP_OBJECT_SPRITES.FLAG_SMALL_BLUE,
            MAP_OBJECT_SPRITES.FLAG_SMALL_GREEN,
            MAP_OBJECT_SPRITES.FLAG_SMALL_YELLOW,
            MAP_OBJECT_SPRITES.FLAG_SMALL_PURPLE,
            MAP_OBJECT_SPRITES.FLAG_SMALL_ORANGE,
            MAP_OBJECT_SPRITES.FLAG_SMALL_TEAL,
            MAP_OBJECT_SPRITES.FLAG_SMALL_WHITE,
        ];

        type FlagData = { playerIndex: number; frame: number; entry: SpriteEntry };
        const batch = new SafeLoadBatch<FlagData>();

        for (let playerIndex = 0; playerIndex < FLAG_RANGES.length; playerIndex++) {
            const range = FLAG_RANGES[playerIndex]!;
            for (let frame = 0; frame < range.count; frame++) {
                const gilIndex = range.start + frame;
                const sprite = await this.spriteLoader.loadDirectSprite(
                    fileSet,
                    gilIndex,
                    null,
                    atlas,
                    paletteBaseOffset
                );
                if (sprite) {
                    batch.add({ playerIndex, frame, entry: sprite.entry });
                }
            }
        }

        let loaded = 0;
        batch.finalize(atlas, gl, data => {
            registry.registerFlag(data.playerIndex, data.frame, data.entry);
            loaded++;
        });

        return loaded;
    }

    /**
     * Load territory dot sprites (8 player colors) from direct GIL indices.
     */
    private async loadTerritoryDotSprites(
        fileSet: LoadedGfxFileSet,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        gl: WebGL2RenderingContext,
        paletteBaseOffset: number
    ): Promise<number> {
        const DOT_GIL_INDICES = [
            MAP_OBJECT_SPRITES.TERRITORY_DOT_RED,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_BLUE,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_GREEN,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_YELLOW,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_PURPLE,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_ORANGE,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_TEAL,
            MAP_OBJECT_SPRITES.TERRITORY_DOT_GRAY,
        ];

        type DotData = { playerIndex: number; entry: SpriteEntry };
        const batch = new SafeLoadBatch<DotData>();

        for (let playerIndex = 0; playerIndex < DOT_GIL_INDICES.length; playerIndex++) {
            const gilIndex = DOT_GIL_INDICES[playerIndex]!;
            const sprite = await this.spriteLoader.loadDirectSprite(fileSet, gilIndex, null, atlas, paletteBaseOffset);
            if (sprite) {
                batch.add({ playerIndex, entry: sprite.entry });
            }
        }

        let loaded = 0;
        batch.finalize(atlas, gl, data => {
            registry.registerTerritoryDot(data.playerIndex, data.entry);
            loaded++;
        });

        return loaded;
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
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
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
        if (!fileSet?.jilReader || !fileSet.dilReader) return false;

        const paletteBase = this.getPaletteBaseOffset(fileId);

        type ResourceData = { type: EMaterialType; dir: number; entry: SpriteEntry };
        const batch = new SafeLoadBatch<ResourceData>();

        for (const [typeStr, info] of Object.entries(getResourceSpriteMap())) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial<Record> values may be undefined at runtime
            if (!info) continue;
            const type = Number(typeStr) as EMaterialType;

            const loadedDirs = await this.spriteLoader.loadJobAllDirections(fileSet, info.index, atlas, paletteBase);
            if (!loadedDirs) continue;

            for (const [dir, sprites] of loadedDirs) {
                if (sprites.length > 0) {
                    batch.add({ type, dir, entry: sprites[0]!.entry });
                }
            }
        }

        batch.finalize(atlas, gl, data => {
            registry.registerResource(data.type, data.dir, data.entry);
        });

        return batch.count > 0;
    }

    /** Unit loading context for the extracted sprite-unit-loader module. */
    private get unitLoadContext(): UnitLoadContext {
        return {
            spriteLoader: this.spriteLoader,
            getPaletteBaseOffset: (fileId: string) => this.getPaletteBaseOffset(fileId),
        };
    }
}
