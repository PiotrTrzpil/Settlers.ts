/**
 * Two-tier cache for sprite atlas data:
 *
 * 1. Module-level cache (Map) - Persists across Vue HMR
 *    - Instant restore (~0ms)
 *    - Lost on full page refresh
 *
 * 2. Cache API with per-layer streaming via Web Worker
 *    - Metadata + palette read first (small, fast)
 *    - Layers streamed one by one in priority order (trees/buildings first)
 *    - All I/O runs in a worker — zero main-thread blocking
 *    - Invalidated on server restart (build version embedded in URL)
 */

import { LogHandler } from '@/utilities/log-handler';
import { Race, SpriteMetadataRegistry } from '../sprite-metadata';
import type { CacheStreamRequest, CacheSetPriorityRequest, WorkerOutboundMessage } from './cache-read-worker';
import CacheReadWorker from './cache-read-worker?worker';

const log = new LogHandler('SpriteAtlasCache');

/** Build timestamp injected by Vite - changes on server restart */
declare const __BUILD_TIME__: string;

/**
 * Schema version for cache invalidation.
 * Bump this when animation sequence names or sprite data format changes.
 */
const CACHE_SCHEMA_VERSION = 20; // v20: split meta/palette protocol — meta arrives first for faster priority computation

/** Current build version for cache invalidation */
const BUILD_VERSION =
    typeof __BUILD_TIME__ !== 'undefined'
        ? `${__BUILD_TIME__}-v${CACHE_SCHEMA_VERSION}`
        : `dev-v${CACHE_SCHEMA_VERSION}`;

// =============================================================================
// Types
// =============================================================================

/** Slot state for restoring atlas packing layout */
export interface CachedSlot {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Base cached atlas data (shared between memory and Cache API) */
export interface CachedAtlasBase {
    /** Number of layers in the texture array */
    layerCount: number;
    /** Maximum number of layers allowed */
    maxLayers: number;
    /** Per-layer slot packing state */
    slots: CachedSlot[][];
    registryData: ReturnType<SpriteMetadataRegistry['serialize']>;
    race: Race;
    textureUnit: number;
    timestamp: number;
    /** Palette data: file base offsets for combined palette texture */
    paletteOffsets?: Record<string, number>;
    /** Total number of colors in palette texture */
    paletteTotalColors?: number;
    /** Number of palette rows (1=neutral, 5=neutral+4 players) */
    paletteRows?: number;
}

/** Cached atlas data for in-memory use */
export interface CachedAtlasData extends CachedAtlasBase {
    /** Per-layer pixel data (each ArrayBuffer is LAYER_SIZE*LAYER_SIZE*2 bytes) */
    layerBuffers: ArrayBuffer[];
    /** Raw palette RGBA data */
    paletteData?: Uint8Array;
}

/** Metadata from the streaming read (before layers arrive). Palette arrives separately. */
export interface CacheStreamMeta {
    meta: CachedAtlasBase;
    timings: {
        cacheOpen: number;
        metaMatch: number;
        metaRead: number;
        layerKickoff: number;
        metaBytes: number;
        layerCount: number;
    };
}

// =============================================================================
// Module-level cache (Tier 1 - survives HMR)
// =============================================================================

interface ModuleCacheEntry {
    version: string;
    data: CachedAtlasData;
}

const moduleCache = new Map<Race, ModuleCacheEntry>();

/** Get cached atlas data from module cache (null if not found or version mismatch) */
export function getAtlasCache(race: Race): CachedAtlasData | null {
    const entry = moduleCache.get(race);
    if (!entry) {
        return null;
    }

    // Version check - invalidate if schema changed
    if (entry.version !== BUILD_VERSION) {
        log.debug(
            `Module cache: version mismatch for ${Race[race]} (cached: ${entry.version}, current: ${BUILD_VERSION})`
        );
        moduleCache.delete(race);
        return null;
    }

    return entry.data;
}

/** Store atlas data in the module-level cache */
export function setAtlasCache(race: Race, data: CachedAtlasData): void {
    moduleCache.set(race, { version: BUILD_VERSION, data });
    const totalMB = data.layerBuffers.reduce((sum, b) => sum + b.byteLength, 0) / 1024 / 1024;
    log.debug(`Module cache: stored ${Race[race]} (${data.layerCount} layers, ${totalMB.toFixed(1)}MB)`);
}

/** Clear cached atlas from module cache */
export function clearAtlasCache(race: Race): void {
    if (moduleCache.delete(race)) {
        log.debug(`Module cache: cleared ${Race[race]}`);
    }
}

/** Clear all module cache entries */
export function clearAllAtlasCache(): void {
    const count = moduleCache.size;
    moduleCache.clear();
    if (count > 0) {
        log.debug(`Module cache: cleared all (${count} entries)`);
    }
}

// =============================================================================
// Cache API persistence (Tier 2 - survives page refresh)
// =============================================================================

const CACHE_NAME = 'settlers-atlas-v7';

/** Maximum layers we'll attempt to delete when clearing a race's cache */
const MAX_CLEAR_LAYERS = 64;

/** Maximum layer count to generate URLs for */
const MAX_LAYER_URLS = 64;

function metaUrl(race: Race): string {
    return `/_settlers_atlas_/${Race[race]}/meta?v=${BUILD_VERSION}`;
}

function layerUrl(race: Race, index: number): string {
    return `/_settlers_atlas_/${Race[race]}/L${index}?v=${BUILD_VERSION}`;
}

function paletteUrl(race: Race): string {
    return `/_settlers_atlas_/${Race[race]}/pal?v=${BUILD_VERSION}`;
}

const encoder = new TextEncoder();

/** Pre-open the cache handle at module level (re-opened after clearAllCaches) */
let cacheHandlePromise: Promise<Cache> =
    typeof caches !== 'undefined' ? caches.open(CACHE_NAME) : Promise.reject(new Error('Cache API not available'));

// =============================================================================
// Streaming Read API — worker-based (all I/O off main thread)
// =============================================================================

/**
 * Start a streaming cache read via Web Worker.
 * Meta arrives first (fast) — palette arrives separately via callback.
 * Layers stream one by one after sendPriority() is called.
 *
 * @param race The race to read cache for
 * @param onPalette Called when palette data arrives (separate from meta)
 * @param onLayer Called for each layer as it arrives (in priority order)
 * @param onDone Called when all layers have been delivered
 */
export function startStreamingRead(
    race: Race,
    onPalette: (paletteData: Uint8Array | null) => void,
    onLayer: (index: number, buffer: ArrayBuffer) => void,
    onDone: (timings: { layerRead: number; total: number }) => void
): { metaPromise: Promise<CacheStreamMeta | null>; sendPriority: (layerOrder: number[]) => void } {
    const worker = new CacheReadWorker();
    const t0 = performance.now();

    // Generate layer URLs for all possible layers
    const layerUrls: string[] = [];
    for (let i = 0; i < MAX_LAYER_URLS; i++) {
        layerUrls.push(layerUrl(race, i));
    }

    let resolveMeta: (value: CacheStreamMeta | null) => void;
    const metaPromise = new Promise<CacheStreamMeta | null>(resolve => {
        resolveMeta = resolve;
    });

    let layerCount = 0;
    let gotPalette = false;
    let gotDone = false;

    /** Terminate worker only after both palette and done are received */
    const maybeTerminate = () => {
        if (gotPalette && gotDone) {
            worker.terminate();
        }
    };

    worker.onmessage = (e: MessageEvent<WorkerOutboundMessage>) => {
        const msg = e.data;
        if (msg.type === 'meta') {
            if (!msg.metaJson || msg.error) {
                if (msg.error) {
                    log.debug(`Cache worker error: ${msg.error}`);
                }
                worker.terminate();
                resolveMeta(null);
                return;
            }

            const meta = JSON.parse(msg.metaJson) as CachedAtlasBase;
            layerCount = meta.layerCount;

            const tMeta = performance.now();
            const t = msg.timings;
            const metaKB = Math.round(t.metaBytes / 1024);
            console.log(
                `[${tMeta.toFixed(0)}ms] [cache] meta for ${Race[race]} in ${Math.round(tMeta - t0)}ms ` +
                    `(worker: open=${t.cacheOpen}ms match=${t.metaMatch}ms metaRead=${t.metaRead}ms ` +
                    `layerKickoff=${t.layerKickoff}ms) meta=${metaKB}KB layers=${t.layerCount}`
            );

            resolveMeta({ meta, timings: msg.timings });
        } else if (msg.type === 'palette') {
            const paletteData = msg.paletteBuffer ? new Uint8Array(msg.paletteBuffer) : null;
            const palKB = Math.round(msg.paletteBytes / 1024);
            console.log(
                `[${performance.now().toFixed(0)}ms] [cache] palette for ${Race[race]}: ${palKB}KB in ${msg.readMs}ms`
            );
            gotPalette = true;
            onPalette(paletteData);
            maybeTerminate();
        } else if (msg.type === 'layer') {
            onLayer(msg.index, msg.buffer);
        } else {
            const tDone = performance.now();
            const layerMB = (msg.timings.layerBytes / 1024 / 1024).toFixed(1);
            console.log(
                `[${tDone.toFixed(0)}ms] [cache] all ${layerCount} layers streamed in ${Math.round(tDone - t0)}ms ` +
                    `(worker: firstLayer=${msg.timings.firstLayerMs}ms read=${msg.timings.layerRead}ms ` +
                    `${layerMB}MB total)`
            );
            gotDone = true;
            onDone(msg.timings);
            maybeTerminate();
        }
    };

    worker.onerror = e => {
        log.debug(`Cache worker error: ${e.message}`);
        worker.terminate();
        resolveMeta(null);
    };

    // Send start request
    const req: CacheStreamRequest = {
        type: 'start',
        cacheName: CACHE_NAME,
        metaUrl: metaUrl(race),
        layerUrls,
        paletteUrl: paletteUrl(race),
    };
    worker.postMessage(req);

    // Return handle for sending priority after meta is processed
    const sendPriority = (layerOrder: number[]) => {
        const msg: CacheSetPriorityRequest = { type: 'set-priority', layerOrder };
        worker.postMessage(msg);
    };

    return { metaPromise, sendPriority };
}

// =============================================================================
// Legacy batch read (kept for module-cache population on save)
// =============================================================================

/** Get cached atlas from Cache API — used only as fallback when streaming is not applicable */
export async function getIndexedDBCache(race: Race): Promise<CachedAtlasData | null> {
    // Use streaming internally but collect everything into a single result
    return new Promise<CachedAtlasData | null>(resolve => {
        const layerBuffers: ArrayBuffer[] = [];
        let layerCount = 0;
        let paletteData: Uint8Array | undefined;

        const { metaPromise, sendPriority } = startStreamingRead(
            race,
            pd => {
                paletteData = pd ?? undefined;
            },
            (index, buffer) => {
                layerBuffers[index] = buffer;
            },
            () => {
                // Validate all layers arrived
                for (let i = 0; i < layerCount; i++) {
                    if (!layerBuffers[i]) {
                        log.debug(`Cache API: missing layer ${i} for ${Race[race]}`);
                        resolve(null);
                        return;
                    }
                }

                void metaPromise.then(streamMeta => {
                    if (!streamMeta) {
                        resolve(null);
                        return;
                    }
                    resolve({
                        ...streamMeta.meta,
                        layerBuffers,
                        paletteData,
                    });
                });
            }
        );

        void metaPromise.then(streamMeta => {
            if (!streamMeta) {
                resolve(null);
                return;
            }
            layerCount = streamMeta.meta.layerCount;
            // Sequential order — no priority optimization for legacy path
            const order = Array.from({ length: layerCount }, (_, i) => i);
            sendPriority(order);
        });
    });
}

// =============================================================================
// Write API
// =============================================================================

/** Save atlas data via Cache API — one entry per layer + metadata + palette */
export async function setIndexedDBCache(race: Race, data: CachedAtlasData): Promise<void> {
    const totalMB = data.layerBuffers.reduce((sum, b) => sum + b.byteLength, 0) / 1024 / 1024;
    console.log(
        `[${performance.now().toFixed(0)}ms] [cache] save started: ${Race[race]} ` +
            `${data.layerCount} layers, ${totalMB.toFixed(1)}MB, version=${BUILD_VERSION}`
    );

    try {
        const cache = await cacheHandlePromise;
        const t0 = performance.now();

        // Metadata entry (JSON — small)
        const meta: CachedAtlasBase = {
            layerCount: data.layerCount,
            maxLayers: data.maxLayers,
            slots: data.slots,
            registryData: data.registryData,
            race: data.race,
            textureUnit: data.textureUnit,
            timestamp: data.timestamp,
            paletteOffsets: data.paletteOffsets,
            paletteTotalColors: data.paletteTotalColors,
            paletteRows: data.paletteRows,
        };
        const metaBytes = encoder.encode(JSON.stringify(meta));

        // Write metadata + palette first (small, fast)
        console.log(`[${performance.now().toFixed(0)}ms] [cache] writing meta (${metaBytes.byteLength} bytes)...`);
        await cache.put(metaUrl(race), new Response(new Blob([metaBytes], { type: 'application/json' })));
        console.log(`[${performance.now().toFixed(0)}ms] [cache] meta written OK`);

        if (data.paletteData) {
            console.log(
                `[${performance.now().toFixed(0)}ms] [cache] writing palette (${data.paletteData.byteLength} bytes)...`
            );
            await cache.put(
                paletteUrl(race),
                new Response(new Blob([data.paletteData as BlobPart], { type: 'application/octet-stream' }))
            );
            console.log(`[${performance.now().toFixed(0)}ms] [cache] palette written OK`);
        }
        const tSmall = performance.now();

        // Write layers sequentially — large blobs can fail with concurrent writes
        for (let i = 0; i < data.layerCount; i++) {
            const buf = data.layerBuffers[i]!;
            await cache.put(layerUrl(race, i), new Response(new Blob([buf], { type: 'application/octet-stream' })));
            if (i === 0 || i === data.layerCount - 1) {
                console.log(
                    `[${performance.now().toFixed(0)}ms] [cache] layer ${i}/${data.layerCount} written (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`
                );
            }
        }

        const saveMs = Math.round(performance.now() - t0);
        const smallMs = Math.round(tSmall - t0);
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] save complete: ${data.layerCount + 2} entries ` +
                `in ${saveMs}ms (meta+pal=${smallMs}ms)`
        );
    } catch (e) {
        console.error(`[cache] save FAILED:`, e);
        throw e;
    }
}

/** Clear cache for a specific race */
export async function clearIndexedDBCache(race: Race): Promise<void> {
    try {
        const cache = await cacheHandlePromise;
        const deletes: Promise<boolean>[] = [cache.delete(metaUrl(race)), cache.delete(paletteUrl(race))];
        for (let i = 0; i < MAX_CLEAR_LAYERS; i++) {
            deletes.push(cache.delete(layerUrl(race, i)));
        }
        await Promise.all(deletes);
        log.debug(`Cache API: cleared ${Race[race]}`);
    } catch (e) {
        log.debug(`Cache API clear failed: ${String(e)}`);
    }
}

/** Clear all cache entries */
export async function clearAllIndexedDBCache(): Promise<void> {
    try {
        await caches.delete(CACHE_NAME);
        // Also delete old cache stores from previous formats
        await caches.delete('settlers-atlas-v6');
        await caches.delete('settlers-atlas-v5');
        log.debug('Cache API: cleared all');
    } catch (e) {
        log.debug(`Cache API clear-all failed: ${String(e)}`);
    }
}

// =============================================================================
// Combined cache operations
// =============================================================================

/** Check if caching is disabled via settings */
export function isCacheDisabled(): boolean {
    try {
        const stored = localStorage.getItem('settlers_game_settings');
        if (!stored) {
            return false;
        }
        const settings = JSON.parse(stored);
        return settings.cacheDisabled === true;
    } catch {
        return false;
    }
}

/** Clear all caches (both module and Cache API) and invalidate prefetches */
export async function clearAllCaches(): Promise<void> {
    clearAllAtlasCache();
    await clearAllIndexedDBCache();
    // Re-open the cache handle so subsequent saves go to the new (empty) store
    // instead of the orphaned handle from the deleted cache.
    if (typeof caches !== 'undefined') {
        cacheHandlePromise = caches.open(CACHE_NAME);
    }
    // Invalidate any in-flight or already-resolved prefetch so stale data
    // doesn't resurrect the cache on the next tryRestore() call.
    const { invalidatePrefetch } = await import('../sprite-atlas-cache-manager');
    invalidatePrefetch();
    log.info('All caches cleared');
}

// =============================================================================
// Debug utilities
// =============================================================================

/** Get cache statistics for debugging */
export function getAtlasCacheStats(): { races: string[]; totalMemoryMB: number } {
    const races: string[] = [];
    let totalBytes = 0;

    for (const [race, entry] of moduleCache) {
        races.push(Race[race]);
        totalBytes += entry.data.layerBuffers.reduce((sum, b) => sum + b.byteLength, 0);
    }

    return { races, totalMemoryMB: totalBytes / 1024 / 1024 };
}

/** Get current build version (for debugging) */
export function getBuildVersion(): string {
    return BUILD_VERSION;
}
