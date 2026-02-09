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

/** Current build version for cache invalidation */
const BUILD_VERSION = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';

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
    width: number;
    height: number;
    maxSize: number;
    slots: CachedSlot[];
    registryData: ReturnType<SpriteMetadataRegistry['serialize']>;
    race: Race;
    textureUnit: number;
    timestamp: number;
}

/** Cached atlas data for in-memory use */
export interface CachedAtlasData extends CachedAtlasBase {
    imgData: Uint8Array;
}

/** IndexedDB entry (ArrayBuffer for IDB compatibility, includes version) */
interface IndexedDBAtlasEntry extends CachedAtlasBase {
    imgData: ArrayBuffer;
    version: string;
}

// =============================================================================
// Module-level cache (Tier 1 - survives HMR)
// =============================================================================

const moduleCache = new Map<Race, CachedAtlasData>();

/** Get cached atlas data from module cache (null if not found) */
export function getAtlasCache(race: Race): CachedAtlasData | null {
    return moduleCache.get(race) ?? null;
}

/** Store atlas data in the module-level cache */
export function setAtlasCache(race: Race, data: CachedAtlasData): void {
    moduleCache.set(race, data);
    log.debug(`Module cache: stored ${Race[race]} (${data.width}x${data.height}, ${(data.imgData.length / 1024 / 1024).toFixed(1)}MB)`);
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
        width: entry.width,
        height: entry.height,
        maxSize: entry.maxSize,
        slots: entry.slots,
        registryData: entry.registryData,
        race: entry.race,
        textureUnit: entry.textureUnit,
        timestamp: entry.timestamp,
    };

    const ageMins = Math.round((Date.now() - entry.timestamp) / 60000);
    log.debug(`IndexedDB: loaded ${Race[race]} (${data.width}x${data.height}, age: ${ageMins}m)`);

    return data;
}

/** Save atlas data to IndexedDB */
export async function setIndexedDBCache(race: Race, data: CachedAtlasData): Promise<void> {
    const entry: IndexedDBAtlasEntry = {
        race,
        version: BUILD_VERSION,
        imgData: data.imgData.buffer.slice(
            data.imgData.byteOffset,
            data.imgData.byteOffset + data.imgData.byteLength
        ),
        width: data.width,
        height: data.height,
        maxSize: data.maxSize,
        slots: data.slots,
        registryData: data.registryData,
        textureUnit: data.textureUnit,
        timestamp: data.timestamp,
    };

    const result = await withStore<IDBValidKey>('readwrite', store => store.put(entry));
    if (result !== null) {
        const sizeMB = (data.imgData.length / 1024 / 1024).toFixed(1);
        log.debug(`IndexedDB: saved ${Race[race]} (${data.width}x${data.height}, ${sizeMB}MB)`);
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
// Debug utilities
// =============================================================================

/** Get cache statistics for debugging */
export function getAtlasCacheStats(): { races: string[]; totalMemoryMB: number } {
    const races: string[] = [];
    let totalBytes = 0;

    for (const [race, data] of moduleCache) {
        races.push(Race[race]);
        totalBytes += data.imgData.length;
    }

    return { races, totalMemoryMB: totalBytes / 1024 / 1024 };
}

/** Get current build version (for debugging) */
export function getBuildVersion(): string {
    return BUILD_VERSION;
}
