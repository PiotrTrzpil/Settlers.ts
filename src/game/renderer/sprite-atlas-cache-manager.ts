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
import { debugStats } from '@/game/debug/debug-stats';
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
// Prefetch state
// =============================================================================

let prefetchPromise: Promise<CachedAtlasData | null> | null = null;
let prefetchStartedAt = 0;
let prefetchResolvedAt = 0;

/**
 * Invalidate any in-flight or resolved prefetch.
 * Called by clearAllCaches() so a stale prefetch doesn't resurrect cleared data.
 */
export function invalidatePrefetch(): void {
    prefetchPromise = null;
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
    /**
     * Start a cache prefetch for the given race. Call as early as possible
     * (before GL is ready) so the Cache API reads overlap with landscape init.
     */
    public prefetch(race: Race): void {
        if (isCacheDisabled() || prefetchPromise) return;
        prefetchStartedAt = performance.now();
        prefetchPromise = getIndexedDBCache(race).then(v => {
            prefetchResolvedAt = performance.now();
            return v;
        });
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
            layerBuffers: atlas.getLayerBuffers(),
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
        const hadPrefetch = !!prefetchPromise;
        const t0 = performance.now();
        const cached = await (prefetchPromise ?? getIndexedDBCache(race));
        const now = performance.now();
        prefetchPromise = null;
        debugStats.state.loadTimings.cacheWait = Math.round(now - t0);

        const alreadyResolved = prefetchResolvedAt > 0 && prefetchResolvedAt <= t0;
        const headStart = prefetchStartedAt > 0 ? Math.round(t0 - prefetchStartedAt) : 0;
        const ioTime = prefetchResolvedAt > 0 ? Math.round(prefetchResolvedAt - prefetchStartedAt) : 0;
        const resolvedLabel = alreadyResolved ? 'YES' : 'no';
        const detail = hadPrefetch
            ? `, I/O=${ioTime}ms, headStart=${headStart}ms, resolved=${resolvedLabel}`
            : ' (no prefetch)';
        console.log(`[${now.toFixed(0)}ms] [cache] prefetch=${hadPrefetch}, waited=${Math.round(now - t0)}ms${detail}`);
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

        // Phase 1: Atlas restore from per-layer buffers (zero-copy Uint16Array views)
        const atlas = EntityTextureAtlas.fromCache(
            cached.layerBuffers,
            cached.layerCount,
            cached.maxLayers,
            cached.slots,
            textureUnit
        );
        const atlasRestore = Math.round(performance.now() - t0);

        // Phase 2: Registry deserialize — JSON→Maps reconstruction
        const tRegistry = performance.now();
        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);
        const registryDeserialize = Math.round(performance.now() - tRegistry);

        const t1 = performance.now();
        const deserialize = Math.round(t1 - t0);

        // Phase 3: GPU — allocate texture memory, defer pixel upload to render loop
        atlas.allocateDeferred(gl);
        const gpuAlloc = Math.round(performance.now() - t1);

        // Phase 4: Palette restore (CPU) + GPU upload — must be synchronous for shaders
        const tPalRestore = performance.now();
        let palRestoreMs = 0;
        let palUploadMs = 0;
        if (cached.paletteData && cached.paletteOffsets && cached.paletteTotalColors) {
            paletteManager.restoreFromCache(
                cached.paletteData,
                cached.paletteOffsets,
                cached.paletteTotalColors,
                cached.paletteRows
            );
            palRestoreMs = Math.round(performance.now() - tPalRestore);

            const tPalUpload = performance.now();
            paletteManager.upload(gl);
            palUploadMs = Math.round(performance.now() - tPalUpload);
        }
        const paletteUpload = palRestoreMs + palUploadMs;
        const gpuUpload = gpuAlloc;

        const total = Math.round(performance.now() - t0);

        // Detailed diagnostics
        const imgMB = cached.layerBuffers.reduce((sum, b) => sum + b.byteLength, 0) / 1024 / 1024;
        const palKB = cached.paletteData ? (cached.paletteData.byteLength / 1024).toFixed(1) : '0';
        console.log(
            `[${performance.now().toFixed(0)}ms] [restore] source=${source} total=${total}ms (atlas upload deferred)\n` +
                `  atlas: ${atlasRestore}ms (${cached.layerCount} layers)\n` +
                `  registry: ${registryDeserialize}ms\n` +
                `  gpu alloc: ${gpuAlloc}ms (${cached.layerCount} layers deferred)\n` +
                `  palette: restore=${palRestoreMs}ms upload=${palUploadMs}ms (${palKB}KB)\n` +
                `  total: ${imgMB.toFixed(1)}MB atlas, deserialize=${deserialize}ms palette=${paletteUpload}ms`
        );

        // Record cache hit in debug stats
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload: 0,
            atlasAlloc: 0,
            buildings: 0,
            mapObjects: 0,
            goods: 0,
            units: 0,
            deserialize,
            atlasRestore,
            registryDeserialize,
            paletteUpload,
            gpuUpload,
            gpuLayers: atlas.layerCount,
            totalSprites: total,
            atlasSize: `${atlas.layerCount}x${atlas.width}x${atlas.height}`,
            spriteCount:
                registry.getBuildingCount() +
                registry.getMapObjectCount() +
                registry.getGoodCount() +
                registry.getUnitCount(),
            cacheHit: true,
            cacheSource: source,
        });

        return { atlas, registry, source };
    }
}
