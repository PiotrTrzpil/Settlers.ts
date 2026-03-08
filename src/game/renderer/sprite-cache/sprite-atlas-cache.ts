/**
 * Two-tier cache for sprite atlas data:
 *
 * 1. Module-level cache (Map) - Persists across Vue HMR
 *    - Instant restore (~0ms)
 *    - Lost on full page refresh
 *
 * 2. Cache API with per-layer storage - Persists across page refresh
 *    - Metadata + palette stored as one entry (small)
 *    - Each atlas layer stored as its own Cache entry (32MB each)
 *    - All entries read in parallel via Promise.all (no assembly needed)
 *    - Invalidated on server restart (build version embedded in URL)
 */

import { LogHandler } from '@/utilities/log-handler';
import { Race, SpriteMetadataRegistry } from '../sprite-metadata';

const log = new LogHandler('SpriteAtlasCache');

/** Build timestamp injected by Vite - changes on server restart */
declare const __BUILD_TIME__: string;

/**
 * Schema version for cache invalidation.
 * Bump this when animation sequence names or sprite data format changes.
 */
const CACHE_SCHEMA_VERSION = 18; // v18: per-layer cache storage

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
interface CachedAtlasBase {
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
    if (!entry) return null;

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
//
// Per-layer storage: each atlas layer is its own Cache entry.
// Metadata + palette stored in a separate entry.
// All reads happen in parallel via Promise.all — no assembly step.
// =============================================================================

const CACHE_NAME = 'settlers-atlas-v6';

/** Maximum layers we'll attempt to delete when clearing a race's cache */
const MAX_CLEAR_LAYERS = 64;

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
// Read API — worker-based (all I/O off main thread)
// =============================================================================

import type { CacheBatchReadRequest, CacheBatchReadResponse } from './cache-read-worker';
import CacheReadWorker from './cache-read-worker?worker';

/** Maximum layer count to generate URLs for (must cover any valid atlas) */
const MAX_LAYER_URLS = 64;

/** Read all cache entries via a Web Worker — zero main-thread I/O. */
function readViaWorker(race: Race): Promise<CacheBatchReadResponse> {
    return new Promise((resolve, reject) => {
        const worker = new CacheReadWorker();

        // Pre-generate layer URLs for max possible count.
        // The worker reads meta first, but we need to provide layer URLs up-front.
        // Extra URLs that don't match just return null (cache miss) — no harm.
        const layerUrls: string[] = [];
        for (let i = 0; i < MAX_LAYER_URLS; i++) {
            layerUrls.push(layerUrl(race, i));
        }

        const req: CacheBatchReadRequest = {
            type: 'batch-read',
            cacheName: CACHE_NAME,
            metaUrl: metaUrl(race),
            layerUrls,
            paletteUrl: paletteUrl(race),
        };

        worker.onmessage = (e: MessageEvent<CacheBatchReadResponse>) => {
            worker.terminate();
            resolve(e.data);
        };
        worker.onerror = e => {
            worker.terminate();
            reject(new Error(`Cache worker error: ${e.message}`));
        };
        worker.postMessage(req);
    });
}

/** Get cached atlas from Cache API via worker (null on miss) */
export async function getIndexedDBCache(race: Race): Promise<CachedAtlasData | null> {
    try {
        const t0 = performance.now();
        const resp = await readViaWorker(race);
        const tDone = performance.now();

        if (!resp.metaJson) {
            log.debug(`Cache API: no cache for ${Race[race]}`);
            return null;
        }

        if (resp.error) {
            log.debug(`Cache API worker error: ${resp.error}`);
            return null;
        }

        const meta = JSON.parse(resp.metaJson) as CachedAtlasBase;

        // Trim layer buffers to actual layer count and validate
        const layerBuffers: ArrayBuffer[] = [];
        for (let i = 0; i < meta.layerCount; i++) {
            const buf = resp.layerBuffers[i];
            if (!buf) {
                log.debug(`Cache API: missing layer ${i} for ${Race[race]}`);
                return null;
            }
            layerBuffers.push(buf);
        }

        const paletteData = resp.paletteBuffer ? new Uint8Array(resp.paletteBuffer) : undefined;

        const totalMB = layerBuffers.reduce((sum, b) => sum + b.byteLength, 0) / 1024 / 1024;
        const palMB = paletteData ? paletteData.byteLength / 1024 / 1024 : 0;
        const ageMins = Math.round((Date.now() - meta.timestamp) / 60000);
        const wt = resp.timings;
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] loaded ${Race[race]}: ${meta.layerCount} layers (${totalMB.toFixed(1)}MB) + pal ${palMB.toFixed(1)}MB, age: ${ageMins}m\n` +
                `  worker: cacheOpen=${wt.cacheOpen}ms meta=${wt.metaRead}ms layers=${wt.layerRead}ms workerTotal=${wt.total}ms\n` +
                `  mainThread: wallTime=${Math.round(tDone - t0)}ms (blocked=~0ms, all I/O in worker)`
        );

        return {
            layerBuffers,
            paletteData,
            layerCount: meta.layerCount,
            maxLayers: meta.maxLayers,
            slots: meta.slots,
            registryData: meta.registryData,
            race: meta.race,
            textureUnit: meta.textureUnit,
            timestamp: meta.timestamp,
            paletteOffsets: meta.paletteOffsets,
            paletteTotalColors: meta.paletteTotalColors,
            paletteRows: meta.paletteRows,
        };
    } catch (e) {
        log.debug(`Cache API read failed: ${e}`);
        return null;
    }
}

// =============================================================================
// Write API
// =============================================================================

/** Save atlas data via Cache API — one entry per layer + metadata + palette */
export async function setIndexedDBCache(race: Race, data: CachedAtlasData): Promise<void> {
    const totalMB = data.layerBuffers.reduce((sum, b) => sum + b.byteLength, 0) / 1024 / 1024;
    log.debug(
        `Cache API: saving ${Race[race]} (${data.layerCount} layers, ${totalMB.toFixed(1)}MB, version=${BUILD_VERSION})`
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

        // Write metadata + all layers + palette in parallel
        const writes: Promise<void>[] = [];
        writes.push(cache.put(metaUrl(race), new Response(new Blob([metaBytes], { type: 'application/json' }))));

        for (let i = 0; i < data.layerCount; i++) {
            const buf = data.layerBuffers[i]!;
            writes.push(
                cache.put(layerUrl(race, i), new Response(new Blob([buf], { type: 'application/octet-stream' })))
            );
        }

        if (data.paletteData) {
            writes.push(
                cache.put(
                    paletteUrl(race),
                    new Response(new Blob([data.paletteData as BlobPart], { type: 'application/octet-stream' }))
                )
            );
        }

        await Promise.all(writes);

        const saveMs = Math.round(performance.now() - t0);
        log.debug(`Cache API: saved ${data.layerCount + 2} entries in ${saveMs}ms`);
    } catch (e) {
        log.warn(`Cache API save failed: ${e}`);
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
        log.debug(`Cache API clear failed: ${e}`);
    }
}

/** Clear all cache entries */
export async function clearAllIndexedDBCache(): Promise<void> {
    try {
        await caches.delete(CACHE_NAME);
        // Also delete old cache store from previous format
        await caches.delete('settlers-atlas-v5');
        log.debug('Cache API: cleared all');
    } catch (e) {
        log.debug(`Cache API clear-all failed: ${e}`);
    }
}

// =============================================================================
// Combined cache operations
// =============================================================================

/** Check if caching is disabled via settings */
export function isCacheDisabled(): boolean {
    try {
        const stored = localStorage.getItem('settlers_game_settings');
        if (!stored) return false;
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
