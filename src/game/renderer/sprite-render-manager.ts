/**
 * Manages sprite loading, atlas packing, and race switching for entity rendering.
 * Thin orchestrator — delegates to category loaders and cache manager.
 * Extracted from EntityRenderer to separate concerns.
 */

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
    GFX_FILE_NUMBERS,
    AnimatedSpriteEntry,
    SETTLER_FILE_NUMBERS,
    AVAILABLE_RACES,
    getBuildingSpriteMap,
} from './sprite-metadata';
import { SpriteLoader } from './sprite-loader';
import { destroyDecoderPool, getDecoderPool, warmUpDecoderPool } from './sprite-decoder-pool';
import { yieldToEventLoop } from './batch-loader';
import { BuildingType, UnitType, EntityType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { AnimationData } from '../animation';
import { AnimationDataProvider } from './animation-helpers';
import { EMaterialType } from '../economy';
import type { AtlasRegion } from './entity-texture-atlas';
import { TEAM_COLOR_PALETTES } from '@/resources/gfx/team-colors';
import { loadUnitSpritesForRace } from './sprite-unit-loader';
import { SpriteAtlasCacheManager, prefetchSpriteCache } from './sprite-atlas-cache-manager';
import {
    loadGilManifest,
    loadBuildingSprites,
    loadMapObjectSprites,
    loadGoodSprites,
    loadOverlaySprites,
} from './sprite-loaders';
import { type SpriteLoadContext } from './sprite-load-context';
import { SELECTION_INDICATOR_MANIFEST } from './selection-indicator';

export { prefetchSpriteCache };

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
    private cacheManager: SpriteAtlasCacheManager;

    // Sprite atlas and metadata
    // OK: nullable - null until init() loads sprites, allows graceful fallback to procedural rendering
    private _spriteAtlas: EntityTextureAtlas | null = null;
    private _spriteRegistry: SpriteMetadataRegistry | null = null;
    // OK: null until setInitialRace() or setRace() is called before init()
    private _currentRace: Race | null = null;

    /** Combined palette texture for palettized atlas rendering */
    private _paletteManager: PaletteTextureManager;

    constructor(fileManager: FileManager, textureUnit: number) {
        this.fileManager = fileManager;
        this.textureUnit = textureUnit;
        this.spriteLoader = new SpriteLoader(fileManager);
        this._paletteManager = new PaletteTextureManager(TEXTURE_UNIT_PALETTE);
        this.cacheManager = new SpriteAtlasCacheManager();
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

    /** Get the current race (null if not yet set via setInitialRace / setRace). */
    get currentRace(): Race | null {
        return this._currentRace;
    }

    /** Check if sprites are available for rendering */
    get hasSprites(): boolean {
        return this._spriteAtlas !== null && this._spriteRegistry !== null;
    }

    /**
     * Set the initial race before GL is available. Must be called before prefetchCache() and init().
     * No-op if race is already set (prevents overwriting during HMR).
     */
    public setInitialRace(race: Race): void {
        if (this._currentRace !== null) return;
        this._currentRace = race;
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
     * No-op if the race has not been set yet.
     */
    public prefetchCache(): void {
        if (this._currentRace === null) return;
        this.cacheManager.adoptPrefetch(this._currentRace);
    }

    /**
     * Initialize sprite loading. Call once after GL context is available.
     */
    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.glContext = gl;
        if (this._currentRace === null) {
            throw new Error('SpriteRenderManager.init: race not set — call setInitialRace() before init()');
        }
        return this.loadSpritesForRace(gl, this._currentRace);
    }

    /**
     * Switch to a different race and reload sprites.
     * Returns true if sprites were loaded successfully.
     */
    public async setRace(race: Race): Promise<boolean> {
        const currentLabel = this._currentRace !== null ? Race[this._currentRace] : 'none';
        SpriteRenderManager.log.debug(`setRace called: ${Race[race]} (current: ${currentLabel})`);

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
        const resolvedRace = race ?? this._currentRace;
        if (resolvedRace === null) return null;
        return this._spriteRegistry?.getBuilding(type, resolvedRace) ?? null;
    }

    /**
     * Get a building construction sprite entry by type and race.
     */
    public getBuildingConstruction(type: BuildingType, race?: number): SpriteEntry | null {
        const resolvedRace = race ?? this._currentRace;
        if (resolvedRace === null) return null;
        return this._spriteRegistry?.getBuildingConstruction(type, resolvedRace) ?? null;
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
    public getGoodSprite(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        return this._spriteRegistry?.getGoodSprite(type, direction) ?? null;
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
    public extractSpriteAsImageData(region: AtlasRegion, paletteBaseOffset = 0): ImageData | null {
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

        return loadOverlaySprites(manifest, {
            spriteLoader: this.spriteLoader,
            atlas,
            registry,
            gl,
            paletteManager: this._paletteManager,
        });
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

    // ==========================================================================
    // Private — core loading pipeline
    // ==========================================================================

    /**
     * Load sprites for a specific race.
     */
    private async loadSpritesForRace(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        // Try cache first — combined atlas keyed by `race` (always Roman on init).
        const cached = await this.cacheManager.tryRestore(gl, race, this.textureUnit, this._paletteManager);
        if (cached) {
            this._spriteAtlas = cached.atlas;
            this._spriteRegistry = cached.registry;
            // Load selection indicators on top of cached atlas (not included in cache)
            const ctx: SpriteLoadContext = {
                spriteLoader: this.spriteLoader,
                atlas: cached.atlas,
                registry: cached.registry,
                gl,
                paletteManager: this._paletteManager,
            };
            await this.loadSelectionIndicators(ctx);
            return true;
        }

        // Full load from files
        return this.loadSpritesFromFiles(gl, race);
    }

    /** Load selection indicator sprites from GFX file 7 into the current atlas. */
    private async loadSelectionIndicators(ctx: SpriteLoadContext): Promise<void> {
        await loadGilManifest(SELECTION_INDICATOR_MANIFEST, ctx);
    }

    /**
     * Full load from GFX files. Called on cache miss.
     */
    private async loadSpritesFromFiles(gl: WebGL2RenderingContext, race: Race): Promise<boolean> {
        const t = createTimer();
        const racesToLoad = AVAILABLE_RACES;

        // Preload all files for all races and warm up workers in parallel
        const buildingFiles = this.collectBuildingFileIds(racesToLoad);
        const allFileIds = [
            ...buildingFiles,
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

        const ctx: SpriteLoadContext = {
            spriteLoader: this.spriteLoader,
            atlas,
            registry,
            gl,
            paletteManager: this._paletteManager,
        };

        const mapObjectsLoaded = await loadMapObjectSprites(ctx);
        const mapObjects = t.lap();

        const { loaded: buildingsLoaded } = await loadBuildingSprites(ctx);
        const buildings = t.lap();

        const goodsLoaded = await loadGoodSprites(ctx);
        const goods = t.lap();

        let unitsLoaded = false;
        const unitRaceTimings: Record<string, number> = {};
        for (const r of racesToLoad) {
            const raceStart = performance.now();
            if (await loadUnitSpritesForRace(r, ctx)) {
                unitsLoaded = true;
            }
            unitRaceTimings[Race[r]] = Math.round(performance.now() - raceStart);
            await yieldToEventLoop();
        }
        const units = t.lap();

        // Load selection indicator sprites from GFX file 7 (HUD overlays)
        await this.loadSelectionIndicators(ctx);

        if (!buildingsLoaded && !mapObjectsLoaded && !goodsLoaded && !unitsLoaded) {
            return false;
        }

        atlas.update(gl);

        // Create per-player palette rows with S4 team color substitution, then upload to GPU
        await this._paletteManager.createPlayerPalettes(TEAM_COLOR_PALETTES.length);
        this._paletteManager.upload(gl);

        const gpuUpload = t.lap();

        void this.cacheManager.save(race, atlas, registry, this.textureUnit, this._paletteManager);
        this.recordLoadTimings(
            {
                filePreload,
                atlasAlloc,
                buildings,
                mapObjects,
                goods,
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
            registry.hasGoodSprites() ||
            registry.hasUnitSprites()
        );
    }

    /** Collect GFX file IDs needed for buildings across all races. */
    private collectBuildingFileIds(racesToLoad: readonly Race[]): string[] {
        const files = new Set<number>();
        for (const r of racesToLoad) {
            const spriteMap = getBuildingSpriteMap(r);
            for (const info of Object.values(spriteMap)) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Partial values
                if (info) files.add(info.file);
            }
        }
        return Array.from(files).map(String);
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

    /**
     * Record sprite loading timings to debug stats.
     */
    private recordLoadTimings(
        timings: {
            filePreload: number;
            atlasAlloc: number;
            buildings: number;
            mapObjects: number;
            goods: number;
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
                registry.getGoodCount() +
                registry.getUnitCount(),
            cacheHit: false,
            cacheSource: null,
        });

        SpriteRenderManager.log.debug(
            `Sprite loading (ms): preload=${timings.filePreload}, buildings=${timings.buildings}, ` +
                `mapObj=${timings.mapObjects}, goods=${timings.goods}, units=${timings.units}, ` +
                `gpu=${timings.gpuUpload}, TOTAL=${timer.total()}, workers=${getDecoderPool().getDecodeCount()}`
        );
    }
}
