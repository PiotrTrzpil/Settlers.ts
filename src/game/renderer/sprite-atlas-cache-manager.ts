/**
 * Sprite Atlas Cache Manager — three-tier caching for atlas data.
 *
 * Tier 1: Module-level Map (survives HMR, lost on page refresh).
 * Tier 2: IndexedDB (survives page refresh, invalidated on build version change).
 *
 * Extracted from SpriteRenderManager to separate caching concerns.
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { PaletteTextureManager } from './palette-texture';
import { SpriteMetadataRegistry, Race } from './sprite-metadata';
import { debugStats } from '@/game/debug-stats';
import {
    getAtlasCache,
    setAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    isCacheDisabled,
    type CachedAtlasData,
} from './sprite-cache';

const log = new LogHandler('SpriteAtlasCacheManager');

// =============================================================================
// Eager module-level prefetch
// =============================================================================
// Starts the IndexedDB cache read the moment this module is imported.
// By the time the main thread needs the result (~263ms later), the read is usually done.

const PREFETCH_T0 = performance.now();
let prefetchResolvedAt = 0;
let earlyPrefetch: Promise<CachedAtlasData | null> | null = isCacheDisabled()
    ? null
    : getIndexedDBCache(Race.Roman).then(v => {
        prefetchResolvedAt = performance.now();
        return v;
    });

/**
 * Re-trigger prefetch if the early one was already consumed (e.g., second map load).
 * No-op if a prefetch is already in flight.
 */
export function prefetchSpriteCache(): void {
    if (!earlyPrefetch && !isCacheDisabled()) {
        earlyPrefetch = getIndexedDBCache(Race.Roman);
    }
}

// =============================================================================
// Restore result
// =============================================================================

export interface CacheRestoreResult {
    atlas: EntityTextureAtlas;
    registry: SpriteMetadataRegistry;
    source: 'module' | 'indexeddb';
}

// =============================================================================
// SpriteAtlasCacheManager
// =============================================================================

/**
 * Manages three-tier sprite atlas caching: module Map, IndexedDB, and Cache API.
 * Responsible for restoring and saving atlas + registry + palette data.
 */
export class SpriteAtlasCacheManager {
    /** Prefetched IndexedDB cache promise (started before GL is ready) */
    private _prefetchedCache: Promise<CachedAtlasData | null> | null = null;

    /**
     * Adopt the module-level early prefetch (started during map load), or start
     * a new IDB read if no early prefetch is available.
     */
    public adoptPrefetch(race: Race): void {
        if (isCacheDisabled()) return;
        if (earlyPrefetch) {
            this._prefetchedCache = earlyPrefetch;
            earlyPrefetch = null;
        } else {
            this._prefetchedCache = getIndexedDBCache(race);
        }
    }

    /**
     * Try to restore atlas + registry from cache (module or IndexedDB).
     * Returns a CacheRestoreResult if successful, null if cache miss.
     */
    public async tryRestore(
        gl: WebGL2RenderingContext,
        race: Race,
        textureUnit: number,
        paletteManager: PaletteTextureManager
    ): Promise<CacheRestoreResult | null> {
        if (isCacheDisabled()) {
            log.debug('Cache disabled via settings, loading from files');
            return null;
        }

        // Tier 1: module-level cache (instant, survives HMR)
        const moduleCached = getAtlasCache(race);
        if (moduleCached) {
            const result = this.restoreFromCachedData(gl, moduleCached, 'module', textureUnit, paletteManager);
            return result;
        }

        // Tier 2: IndexedDB (fast, survives page refresh)
        return this.tryRestoreFromIndexedDB(gl, race, textureUnit, paletteManager);
    }

    /**
     * Save current atlas, registry, and palette to both cache tiers (fire-and-forget).
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- cache save is fire-and-forget
    public async save(
        race: Race,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        textureUnit: number,
        paletteManager: PaletteTextureManager
    ): Promise<void> {
        if (isCacheDisabled()) {
            log.debug('Cache disabled, skipping save');
            return;
        }

        const cacheData: CachedAtlasData = {
            imgData: atlas.getImageDataBytes(),
            layerCount: atlas.layerCount,
            maxLayers: atlas.getMaxLayers(),
            slots: atlas.getSlots(),
            registryData: registry.serialize(),
            race,
            textureUnit,
            timestamp: Date.now(),
            paletteOffsets: paletteManager.getFileBaseOffsets(),
            paletteTotalColors: paletteManager.colorCount,
            paletteData: paletteManager.getPaletteData() ?? undefined,
            paletteRows: paletteManager.rowCount,
        };

        // Save to module cache (sync, for HMR)
        setAtlasCache(race, cacheData);

        // Save to IndexedDB (async, for page refresh) — don't await to avoid blocking
        setIndexedDBCache(race, cacheData).catch((e: unknown) => {
            log.warn(`IndexedDB cache save failed (non-fatal): ${e}`);
        });
    }

    // ==========================================================================
    // Private helpers
    // ==========================================================================

    private async tryRestoreFromIndexedDB(
        gl: WebGL2RenderingContext,
        race: Race,
        textureUnit: number,
        paletteManager: PaletteTextureManager
    ): Promise<CacheRestoreResult | null> {
        const prefetch = earlyPrefetch ?? this._prefetchedCache;
        const hadPrefetch = !!prefetch;
        earlyPrefetch = null;
        const t0 = performance.now();
        const cached = await (prefetch ?? getIndexedDBCache(race));
        const now = performance.now();
        debugStats.state.loadTimings.cacheWait = Math.round(now - t0);
        const resolvedStatus =
            prefetchResolvedAt <= t0 ? 'YES' : 'no, late by ' + Math.round(prefetchResolvedAt - t0) + 'ms';
        const prefetchDetail =
            prefetchResolvedAt > 0
                ? ', I/O=' +
                  Math.round(prefetchResolvedAt - PREFETCH_T0) +
                  'ms, head start=' +
                  Math.round(t0 - PREFETCH_T0) +
                  'ms, already resolved=' +
                  resolvedStatus
                : ', prefetch did not resolve (miss or no prefetch)';
        console.log(
            '[cache] prefetch=' + hadPrefetch + ', waited=' + Math.round(now - t0) + 'ms at await' + prefetchDetail
        );
        this._prefetchedCache = null;
        if (!cached) return null;

        const result = this.restoreFromCachedData(gl, cached, 'indexeddb', textureUnit, paletteManager);

        // Also populate module cache for future HMR hits
        setAtlasCache(race, cached);

        return result;
    }

    /** Common restore logic for both cache tiers. Returns atlas + registry. */
    private restoreFromCachedData(
        gl: WebGL2RenderingContext,
        cached: CachedAtlasData,
        source: 'module' | 'indexeddb',
        textureUnit: number,
        paletteManager: PaletteTextureManager
    ): CacheRestoreResult {
        const t0 = performance.now();

        // Phase 1: Uint16Array view + atlas setup
        let imgData16: Uint16Array;
        if (cached.imgData.byteOffset % 2 === 0) {
            imgData16 = new Uint16Array(
                cached.imgData.buffer,
                cached.imgData.byteOffset,
                cached.imgData.byteLength / 2
            );
        } else {
            // byteOffset is not 2-byte aligned — copy into an aligned buffer
            const aligned = new Uint8Array(cached.imgData.byteLength);
            aligned.set(cached.imgData);
            imgData16 = new Uint16Array(aligned.buffer);
        }

        const atlas = EntityTextureAtlas.fromCache(
            imgData16,
            cached.layerCount,
            cached.maxLayers,
            cached.slots,
            textureUnit
        );

        // Phase 2: Registry deserialize
        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);
        const t1 = performance.now();
        const deserialize = Math.round(t1 - t0);

        // Phase 3: GPU upload — upload ALL layers at once for instant visibility on cache hit
        atlas.update(gl);
        const gpuUpload = Math.round(performance.now() - t1);

        // Phase 4: Palette restore
        if (cached.paletteData && cached.paletteOffsets && cached.paletteTotalColors) {
            paletteManager.restoreFromCache(
                cached.paletteData,
                cached.paletteOffsets,
                cached.paletteTotalColors,
                cached.paletteRows
            );
            paletteManager.upload(gl);
        }

        const total = Math.round(performance.now() - t0);

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
        log.debug(
            `Restored from ${sourceLabel} in ${total}ms (deserialize=${deserialize}, gpu=${gpuUpload}, ` +
                `${atlas.layerCount} layers, ${registry.getBuildingCount()} buildings)`
        );

        return { atlas, registry, source };
    }
}
