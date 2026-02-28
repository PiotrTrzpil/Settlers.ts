/**
 * Two-tier cache for sprite atlas data:
 *
 * 1. Module-level cache (Map) - Persists across Vue HMR
 *    - Instant restore (~0ms)
 *    - Lost on full page refresh
 *
 * 2. Cache API + Worker pool - Persists across page refresh
 *    - Data split into N chunks, each compressed independently with lz4
 *    - Pool of N Web Workers created eagerly at module load (WASM pre-compiled)
 *    - All chunks read + decompressed in parallel across workers
 *    - ~120ms wall-clock decompress vs ~480ms single-threaded
 *    - Results transferred via zero-copy ArrayBuffer, assembled on main thread
 *    - Invalidated on server restart (build version embedded in URL)
 */

import { LogHandler } from '@/utilities/log-handler';
import { Race, SpriteMetadataRegistry } from '../sprite-metadata';
import type { CacheReadRequest, CacheReadResponse } from './cache-read-worker';

const log = new LogHandler('SpriteAtlasCache');

/** Build timestamp injected by Vite - changes on server restart */
declare const __BUILD_TIME__: string;

/**
 * Schema version for cache invalidation.
 * Bump this when animation sequence names or sprite data format changes.
 */
const CACHE_SCHEMA_VERSION = 15; // v15: chunked parallel decompress (4 workers)

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
    /** Raw atlas image data bytes (Uint16Array stored as Uint8Array) */
    imgData: Uint8Array;
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
    log.debug(
        `Module cache: stored ${Race[race]} (${data.layerCount} layers, ${(data.imgData.length / 1024 / 1024).toFixed(1)}MB)`
    );
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
// Data is split into CHUNK_COUNT chunks, each compressed independently.
// A pool of Web Workers reads + decompresses all chunks in parallel.
// This turns a sequential 480ms decompress into ~120ms (4× parallel).
//
// Binary layout per chunk: [tag:u8][compressed_payload...]
//   tag 0x00 = uncompressed, 0x01 = lz4, 0x02 = gzip
// The assembled payload: [metaLen:u32][imgLen:u32][metaJSON][imgData][paletteData?]
// =============================================================================

const CACHE_NAME = 'settlers-atlas-v5';

/** Number of chunks to split data into for parallel read/decompress */
const CHUNK_COUNT = 4;

/** Compression tag byte prepended to each chunk */
const enum CompTag {
    None = 0x00,
    Lz4 = 0x01,
    Gzip = 0x02,
}

/** Cache URL for a given chunk. Version in URL = stale entries simply miss. */
function chunkUrl(race: Race, index: number): string {
    return `/_settlers_atlas_/${Race[race]}/c${index}?v=${BUILD_VERSION}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// =============================================================================
// Eager Web Worker pool (created at module load → WASM compiles while game loads)
// =============================================================================

import CacheReadWorker from './cache-read-worker?worker';

let workerPoolFailed = false;
const workerPool: Worker[] = [];
let nextRequestId = 0;
const pendingReads = new Map<
    number,
    {
        resolve: (resp: CacheReadResponse) => void;
        reject: (err: Error) => void;
    }
>();

function onWorkerMessage(e: MessageEvent<CacheReadResponse>): void {
    const pending = pendingReads.get(e.data.id);
    if (pending) {
        pendingReads.delete(e.data.id);
        pending.resolve(e.data);
    }
}

/** Reject all pending reads and tear down all workers */
function failWorkerPool(reason: string): void {
    workerPoolFailed = true;
    for (const w of workerPool) w.terminate();
    workerPool.length = 0;
    log.warn(`Worker pool failed: ${reason}. Falling back to main-thread reads.`);
    for (const [, pending] of pendingReads) {
        pending.reject(new Error(reason));
    }
    pendingReads.clear();
}

// Create pool eagerly — workers start loading lz4-wasm WASM immediately.
// By the time we need to decompress, WASM is already compiled.
if (typeof window !== 'undefined') {
    for (let i = 0; i < CHUNK_COUNT; i++) {
        try {
            const w = new CacheReadWorker();
            w.onmessage = onWorkerMessage;
            w.onerror = e => {
                e.preventDefault();
                failWorkerPool(e.message || 'worker error');
            };
            workerPool.push(w);
        } catch (e) {
            workerPoolFailed = true;
            for (const existing of workerPool) existing.terminate();
            workerPool.length = 0;
            log.warn(`Failed to create worker pool: ${e}. Falling back to main-thread reads.`);
            break;
        }
    }
}

/** Send parallel read requests to the worker pool (one chunk per worker) */
function parallelWorkerRead(race: Race): Promise<CacheReadResponse[]> {
    if (workerPoolFailed || workerPool.length === 0) return Promise.resolve([]);
    return Promise.all(
        workerPool.map((w, i) => {
            const id = nextRequestId++;
            return new Promise<CacheReadResponse>((resolve, reject) => {
                pendingReads.set(id, { resolve, reject });
                w.postMessage({
                    type: 'read',
                    id,
                    cacheName: CACHE_NAME,
                    cacheUrl: chunkUrl(race, i),
                } satisfies CacheReadRequest);
            });
        })
    );
}

// =============================================================================
// Main-thread fallback for reads (used if Workers unavailable)
// =============================================================================

/** Pre-open the cache handle at module level (re-opened after clearAllCaches) */
let cacheHandlePromise: Promise<Cache> =
    typeof caches !== 'undefined' ? caches.open(CACHE_NAME) : Promise.reject(new Error('Cache API not available'));

/** Main-thread fallback: read all chunks sequentially, decompress, assemble */
async function mainThreadRead(race: Race): Promise<{ buffer: ArrayBuffer | null; rawSize: number }> {
    try {
        const cache = await cacheHandlePromise;
        const buffers: ArrayBuffer[] = [];
        let totalRawSize = 0;

        for (let i = 0; i < CHUNK_COUNT; i++) {
            const resp = await cache.match(chunkUrl(race, i));
            if (!resp) return { buffer: null, rawSize: 0 };

            const raw = await resp.arrayBuffer();
            if (raw.byteLength === 0) return { buffer: null, rawSize: 0 };
            totalRawSize += raw.byteLength;

            const tag = new Uint8Array(raw, 0, 1)[0];
            const payload = raw.slice(1);

            if (tag === CompTag.Lz4) {
                const lz4 = await import('lz4-wasm');
                const decompressed = lz4.decompress(new Uint8Array(payload));
                buffers.push(decompressed.buffer as ArrayBuffer);
            } else if (tag === CompTag.Gzip) {
                const ds = new DecompressionStream('gzip');
                const writer = ds.writable.getWriter();
                void writer.write(payload);
                void writer.close();
                buffers.push(await new Response(ds.readable).arrayBuffer());
            } else {
                buffers.push(payload);
            }
        }

        // Assemble chunks into contiguous buffer
        const totalSize = buffers.reduce((s, b) => s + b.byteLength, 0);
        const assembled = new Uint8Array(totalSize);
        let offset = 0;
        for (const buf of buffers) {
            assembled.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
        }

        return { buffer: assembled.buffer, rawSize: totalRawSize };
    } catch (e) {
        log.debug(`Main-thread cache read failed: ${e}`);
        return { buffer: null, rawSize: 0 };
    }
}

// =============================================================================
// Public read API
// =============================================================================

/** Result from cache chunk reads (worker or main-thread). */
interface ChunkReadResult {
    buffer: ArrayBuffer | null;
    rawSize: number;
    compressionType: string;
    chunkTimings: CacheReadResponse['timings'][];
    assemblyMs: number;
}

/** Build a single-entry timing for main-thread fallback reads. */
function mainThreadTimingEntry(elapsedMs: number): CacheReadResponse['timings'] {
    return {
        workerStartup: 0,
        cacheOpen: 0,
        cacheMatch: 0,
        cacheRead: elapsedMs,
        wasmInit: 0,
        decompress: 0,
        total: elapsedMs,
    };
}

/** Read all chunks via worker pool, falling back to main thread on error. */
async function readChunks(race: Race): Promise<ChunkReadResult> {
    if (!workerPoolFailed && workerPool.length > 0) {
        try {
            const responses = await parallelWorkerRead(race);
            if (responses.some(r => !r.buffer || r.error)) {
                log.debug(`Cache API: miss for ${Race[race]} (chunk miss or error)`);
                return { buffer: null, rawSize: 0, compressionType: 'none', chunkTimings: [], assemblyMs: 0 };
            }
            let rawSize = 0;
            for (const r of responses) rawSize += r.rawSize;

            const tAssembly = performance.now();
            let totalSize = 0;
            for (const r of responses) totalSize += r.buffer!.byteLength;
            const assembled = new Uint8Array(totalSize);
            let offset = 0;
            for (const r of responses) {
                assembled.set(new Uint8Array(r.buffer!), offset);
                offset += r.buffer!.byteLength;
            }
            return {
                buffer: assembled.buffer,
                rawSize,
                compressionType: responses[0]!.compressionType,
                chunkTimings: responses.map(r => r.timings),
                assemblyMs: Math.round(performance.now() - tAssembly),
            };
        } catch (e) {
            log.debug(`Worker pool read rejected: ${e}, falling back to main thread`);
        }
    }
    const t0 = performance.now();
    const result = await mainThreadRead(race);
    return {
        buffer: result.buffer,
        rawSize: result.rawSize,
        compressionType: 'none',
        chunkTimings: [mainThreadTimingEntry(Math.round(performance.now() - t0))],
        assemblyMs: 0,
    };
}

/** Log cache read diagnostics. */
function logCacheDiagnostics(
    race: Race,
    compressionType: string,
    rawSize: number,
    imgLen: number,
    timestamp: number,
    chunkTimings: CacheReadResponse['timings'][],
    assemblyMs: number
): void {
    const sizeMB = (imgLen / 1024 / 1024).toFixed(1);
    const rawMB = (rawSize / 1024 / 1024).toFixed(1);
    const ageMins = Math.round((Date.now() - timestamp) / 60000);

    if (chunkTimings.length > 1) {
        const maxTotal = Math.max(...chunkTimings.map(t => t.total));
        const maxRead = Math.max(...chunkTimings.map(t => t.cacheRead));
        const maxDecomp = Math.max(...chunkTimings.map(t => t.decompress));
        const startup = chunkTimings[0]!.workerStartup;
        console.log(
            `[cache] loaded ${Race[race]}: ${CHUNK_COUNT} chunks, ${compressionType} ${rawMB}MB→${sizeMB}MB, age: ${ageMins}m`
        );
        for (let i = 0; i < chunkTimings.length; i++) {
            const t = chunkTimings[i]!;
            console.log(
                `[cache]   chunk${i}: read=${t.cacheRead} wasm=${t.wasmInit} decomp=${t.decompress} total=${t.total}ms`
            );
        }
        console.log(
            `[cache]   wall-clock: startup=${startup} maxRead=${maxRead} maxDecomp=${maxDecomp} maxTotal=${maxTotal} assembly=${assemblyMs}ms`
        );
    } else if (chunkTimings.length === 1) {
        const t = chunkTimings[0]!;
        console.log(
            `[cache] loaded ${Race[race]}: ${compressionType} ${rawMB}MB→${sizeMB}MB | read=${t.cacheRead} total=${t.total}ms, age: ${ageMins}m [main-thread fallback]`
        );
    }
}

/** Get cached atlas from Cache API via parallel Worker reads (null on miss) */
export async function getIndexedDBCache(race: Race): Promise<CachedAtlasData | null> {
    try {
        const { buffer, rawSize, compressionType, chunkTimings, assemblyMs } = await readChunks(race);
        if (!buffer) {
            log.debug(`Cache API: no cache for ${Race[race]}`);
            return null;
        }

        const view = new DataView(buffer);
        const metaLen = view.getUint32(0, true);
        const imgLen = view.getUint32(4, true);
        const headerSize = 8;

        const metaBytes = new Uint8Array(buffer, headerSize, metaLen);
        const meta = JSON.parse(decoder.decode(metaBytes)) as CachedAtlasBase;
        const imgData = new Uint8Array(buffer, headerSize + metaLen, imgLen);
        const paletteOffset = headerSize + metaLen + imgLen;
        const paletteData = paletteOffset < buffer.byteLength ? new Uint8Array(buffer, paletteOffset) : undefined;

        logCacheDiagnostics(race, compressionType, rawSize, imgLen, meta.timestamp, chunkTimings, assemblyMs);

        return {
            imgData,
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
// Write API (main thread, fire-and-forget)
// =============================================================================

/** LZ4 WASM — loaded lazily on first compress */
let lz4Module: typeof import('lz4-wasm') | null = null;

async function getLz4(): Promise<typeof import('lz4-wasm')> {
    if (!lz4Module) {
        lz4Module = await import('lz4-wasm');
    }
    return lz4Module;
}

/** Compress using gzip via CompressionStream */
async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    void writer.write(data as unknown as Uint8Array<ArrayBuffer>);
    void writer.close();
    const blob = await new Response(cs.readable).blob();
    return new Uint8Array(await blob.arrayBuffer());
}

/** Get configured compression mode */
function getCompressionMode(): 'none' | 'lz4' | 'gzip' {
    if (isCacheCompressionDisabled()) return 'none';
    try {
        const stored = localStorage.getItem('settlers_game_settings');
        if (stored) {
            const settings = JSON.parse(stored);
            if (settings.cacheCompressionMode === 'gzip') return 'gzip';
        }
    } catch {
        /* use default */
    }
    return 'lz4';
}

/** Save atlas data via Cache API — splits into CHUNK_COUNT compressed chunks */
export async function setIndexedDBCache(race: Race, data: CachedAtlasData): Promise<void> {
    const sizeMB = (data.imgData.length / 1024 / 1024).toFixed(1);
    const mode = getCompressionMode();
    log.debug(
        `Cache API: saving ${Race[race]} (${data.layerCount} layers, ${sizeMB}MB,` +
            ` ${mode}, ${CHUNK_COUNT} chunks, version=${BUILD_VERSION})`
    );

    try {
        const cache = await cacheHandlePromise;

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

        // Pack: [metaLen:u32][imgLen:u32][metaJSON][imgData][paletteData?]
        const metaBytes = encoder.encode(JSON.stringify(meta));
        const imgBytes = data.imgData;
        const palBytes = data.paletteData;

        const payloadSize = 8 + metaBytes.length + imgBytes.length + (palBytes ? palBytes.length : 0);
        const payload = new Uint8Array(payloadSize);
        const payloadView = new DataView(payload.buffer);
        payloadView.setUint32(0, metaBytes.length, true);
        payloadView.setUint32(4, imgBytes.length, true);
        payload.set(metaBytes, 8);
        payload.set(imgBytes, 8 + metaBytes.length);
        if (palBytes) {
            payload.set(palBytes, 8 + metaBytes.length + imgBytes.length);
        }

        // Split into equal chunks and compress each independently
        const chunkSize = Math.ceil(payload.length / CHUNK_COUNT);
        const t0 = performance.now();
        let totalCompressedSize = 0;

        for (let i = 0; i < CHUNK_COUNT; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, payload.length);
            const chunk = payload.subarray(start, end);

            let tag: number;
            let compressed: Uint8Array;

            if (mode === 'lz4') {
                const lz4 = await getLz4();
                compressed = lz4.compress(chunk);
                tag = CompTag.Lz4;
            } else if (mode === 'gzip') {
                compressed = await compressGzip(chunk);
                tag = CompTag.Gzip;
            } else {
                compressed = chunk;
                tag = CompTag.None;
            }

            // Prepend tag byte
            const tagged = new Uint8Array(1 + compressed.length);
            tagged[0] = tag;
            tagged.set(compressed, 1);
            totalCompressedSize += tagged.length;

            await cache.put(chunkUrl(race, i), new Response(new Blob([tagged], { type: 'application/octet-stream' })));
        }

        const compressMs = Math.round(performance.now() - t0);
        const compMB = (totalCompressedSize / 1024 / 1024).toFixed(1);
        const ratio =
            mode !== 'none' ? ` (${((1 - totalCompressedSize / payloadSize) * 100).toFixed(0)}% reduction)` : '';
        log.debug(`Cache API: ${mode} ${sizeMB}MB → ${compMB}MB${ratio} in ${compressMs}ms (${CHUNK_COUNT} chunks)`);
    } catch (e) {
        log.warn(`Cache API save failed: ${e}`);
    }
}

/** Clear cache for a specific race */
export async function clearIndexedDBCache(race: Race): Promise<void> {
    try {
        const cache = await cacheHandlePromise;
        await Promise.all(Array.from({ length: CHUNK_COUNT }, (_, i) => cache.delete(chunkUrl(race, i))));
        log.debug(`Cache API: cleared ${Race[race]}`);
    } catch (e) {
        log.debug(`Cache API clear failed: ${e}`);
    }
}

/** Clear all cache entries */
export async function clearAllIndexedDBCache(): Promise<void> {
    try {
        await caches.delete(CACHE_NAME);
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

/** Check if cache compression is disabled via settings (for A/B comparison) */
export function isCacheCompressionDisabled(): boolean {
    try {
        const stored = localStorage.getItem('settlers_game_settings');
        if (!stored) return false; // default is compression enabled
        const settings = JSON.parse(stored);
        return settings.cacheCompressionEnabled === false;
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
        totalBytes += entry.data.imgData.length;
    }

    return { races, totalMemoryMB: totalBytes / 1024 / 1024 };
}

/** Get current build version (for debugging) */
export function getBuildVersion(): string {
    return BUILD_VERSION;
}
