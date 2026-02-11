/**
 * Two-tier cache for sprite atlas data:
 *
 * 1. Module-level cache (Map) - Persists across Vue HMR
 *    - Instant restore (~0ms)
 *    - Lost on full page refresh
 *
 * 2. IndexedDB cache - Persists across page refresh
 *    - Fast restore (~100-200ms)
 *    - Invalidated on server restart (build version changes)
 *
 * This reduces sprite loading from ~3-5s to:
 * - HMR: ~50ms (GPU upload only)
 * - Browser refresh: ~150ms (IndexedDB read + GPU upload)
 */

import { LogHandler } from '@/utilities/log-handler';
import { Race, SpriteMetadataRegistry } from './sprite-metadata';

const log = new LogHandler('SpriteAtlasCache');

/** Build timestamp injected by Vite - changes on server restart */
declare const __BUILD_TIME__: string;

/**
 * Schema version for cache invalidation.
 * Bump this when animation sequence names or sprite data format changes.
 */
const CACHE_SCHEMA_VERSION = 7;  // v7: 2x sprite scale (PIXELS_TO_WORLD = 1/32)

/** Current build version for cache invalidation */
const BUILD_VERSION = typeof __BUILD_TIME__ !== 'undefined'
    ? `${__BUILD_TIME__}-v${CACHE_SCHEMA_VERSION}`
    : `dev-v${CACHE_SCHEMA_VERSION}`;

/** IndexedDB constants */
const DB_NAME = 'settlers-atlas-cache';
const STORE_NAME = 'atlases';
const DB_VERSION = 1;

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

/** Base cached atlas data (shared between memory and IndexedDB) */
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

/** IndexedDB entry (ArrayBuffer for IDB compatibility, includes version) */
interface IndexedDBAtlasEntry extends CachedAtlasBase {
    imgData: ArrayBuffer;
    paletteBuffer?: ArrayBuffer;
    version: string;
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
        log.debug(`Module cache: version mismatch for ${Race[race]} (cached: ${entry.version}, current: ${BUILD_VERSION})`);
        moduleCache.delete(race);
        return null;
    }

    return entry.data;
}

/** Store atlas data in the module-level cache */
export function setAtlasCache(race: Race, data: CachedAtlasData): void {
    moduleCache.set(race, { version: BUILD_VERSION, data });
    log.debug(`Module cache: stored ${Race[race]} (${data.layerCount} layers, ${(data.imgData.length / 1024 / 1024).toFixed(1)}MB)`);
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
// IndexedDB cache (Tier 2 - survives page refresh)
// =============================================================================

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open IndexedDB connection (cached) */
function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            log.error(`IndexedDB open failed: ${request.error}`);
            dbPromise = null;
            reject(request.error);
        };

        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'race' });
                log.debug('IndexedDB: created object store');
            }
        };
    });

    return dbPromise;
}

/** Helper to run an IndexedDB store operation */
async function withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
    try {
        const db = await openDB();
        const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
        return new Promise((resolve) => {
            const request = operation(store);
            request.onerror = () => {
                log.debug(`IndexedDB operation failed: ${request.error}`);
                resolve(null);
            };
            request.onsuccess = () => resolve(request.result);
        });
    } catch (e) {
        log.error(`IndexedDB error: ${e}`);
        return null;
    }
}

/** Get cached atlas from IndexedDB (null if not found or version mismatch) */
export async function getIndexedDBCache(race: Race): Promise<CachedAtlasData | null> {
    const entry = await withStore<IndexedDBAtlasEntry>('readonly', store => store.get(race));

    if (!entry) {
        log.debug(`IndexedDB: no cache for ${Race[race]}`);
        return null;
    }

    if (entry.version !== BUILD_VERSION) {
        log.debug(`IndexedDB: version mismatch for ${Race[race]} (cached: ${entry.version}, current: ${BUILD_VERSION})`);
        return null;
    }

    const data: CachedAtlasData = {
        imgData: new Uint8Array(entry.imgData),
        layerCount: entry.layerCount,
        maxLayers: entry.maxLayers,
        slots: entry.slots,
        registryData: entry.registryData,
        race: entry.race,
        textureUnit: entry.textureUnit,
        timestamp: entry.timestamp,
        paletteOffsets: entry.paletteOffsets,
        paletteTotalColors: entry.paletteTotalColors,
        paletteData: entry.paletteBuffer ? new Uint8Array(entry.paletteBuffer) : undefined,
        paletteRows: entry.paletteRows,
    };

    const ageMins = Math.round((Date.now() - entry.timestamp) / 60000);
    log.debug(`IndexedDB: loaded ${Race[race]} (${data.layerCount} layers, age: ${ageMins}m)`);

    return data;
}

/** Maximum size for IndexedDB storage (256MB) - larger atlases are skipped */
const MAX_INDEXEDDB_SIZE = 256 * 1024 * 1024;

/** Save atlas data to IndexedDB, clearing old caches on memory pressure */
export async function setIndexedDBCache(race: Race, data: CachedAtlasData): Promise<void> {
    // Skip atlases that are too large for IndexedDB
    if (data.imgData.length > MAX_INDEXEDDB_SIZE) {
        const sizeMB = (data.imgData.length / 1024 / 1024).toFixed(0);
        log.debug(`IndexedDB: skipping ${Race[race]} (${sizeMB}MB > 256MB limit)`);
        return;
    }

    const entry: IndexedDBAtlasEntry = {
        race,
        version: BUILD_VERSION,
        imgData: (data.imgData.buffer as ArrayBuffer).slice(
            data.imgData.byteOffset,
            data.imgData.byteOffset + data.imgData.byteLength
        ),
        layerCount: data.layerCount,
        maxLayers: data.maxLayers,
        slots: data.slots,
        registryData: data.registryData,
        textureUnit: data.textureUnit,
        timestamp: data.timestamp,
        paletteOffsets: data.paletteOffsets,
        paletteTotalColors: data.paletteTotalColors,
        paletteBuffer: data.paletteData ? (data.paletteData.buffer as ArrayBuffer).slice(
            data.paletteData.byteOffset,
            data.paletteData.byteOffset + data.paletteData.byteLength
        ) : undefined,
        paletteRows: data.paletteRows,
    };

    const sizeMB = (data.imgData.length / 1024 / 1024).toFixed(1);

    // Try to save, clearing old caches on memory errors
    const result = await tryPutWithRetry(entry);

    if (result !== null) {
        log.debug(`IndexedDB: saved ${Race[race]} (${data.layerCount} layers, ${sizeMB}MB)`);
    } else {
        log.warn(`IndexedDB: failed to save ${Race[race]} (${sizeMB}MB) - cache disabled`);
    }
}

/** Try to put entry, clearing old caches if we hit memory limits */
async function tryPutWithRetry(entry: IndexedDBAtlasEntry): Promise<IDBValidKey | null> {
    try {
        const db = await openDB();
        const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);

        return await new Promise((resolve) => {
            const request = store.put(entry);

            request.onerror = async() => {
                const error = request.error;
                const isMemoryError = error?.name === 'DataCloneError' ||
                    error?.message?.includes('out of memory') ||
                    error?.name === 'QuotaExceededError';

                if (isMemoryError) {
                    log.debug('IndexedDB: memory pressure detected, clearing old caches...');
                    // Clear all other race caches to free space
                    await clearOtherRaceCaches(entry.race);
                    // Retry once
                    const retryResult = await withStore<IDBValidKey>('readwrite', s => s.put(entry));
                    resolve(retryResult);
                } else {
                    log.debug(`IndexedDB put failed: ${error}`);
                    resolve(null);
                }
            };

            request.onsuccess = () => resolve(request.result);
        });
    } catch (e) {
        log.debug(`IndexedDB error during save: ${e}`);
        return null;
    }
}

/** Clear caches for all races except the specified one */
async function clearOtherRaceCaches(keepRace: Race): Promise<void> {
    const allRaces = [Race.Roman, Race.Viking, Race.Mayan, Race.DarkTribe, Race.Trojan];
    for (const race of allRaces) {
        if (race !== keepRace) {
            await clearIndexedDBCache(race);
        }
    }
}

/** Clear IndexedDB cache for a specific race */
export async function clearIndexedDBCache(race: Race): Promise<void> {
    const result = await withStore<undefined>('readwrite', store => store.delete(race));
    if (result !== null) {
        log.debug(`IndexedDB: cleared ${Race[race]}`);
    }
}

/** Clear all IndexedDB cache entries */
export async function clearAllIndexedDBCache(): Promise<void> {
    const result = await withStore<undefined>('readwrite', store => store.clear());
    if (result !== null) {
        log.debug('IndexedDB: cleared all');
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

/** Clear all caches (both module and IndexedDB) */
export async function clearAllCaches(): Promise<void> {
    clearAllAtlasCache();
    await clearAllIndexedDBCache();
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
