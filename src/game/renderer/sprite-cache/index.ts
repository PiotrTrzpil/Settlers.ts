/**
 * Sprite Cache Module
 *
 * Two-tier caching system for sprite atlas data:
 * - Tier 1: Module-level Map (survives HMR, lost on refresh)
 * - Tier 2: IndexedDB (survives refresh, invalidated on build version change)
 *
 * Public API:
 * - Types: CachedSlot, CachedAtlasData
 * - Module cache: getAtlasCache, setAtlasCache, clearAtlasCache, clearAllAtlasCache
 * - IndexedDB cache: getIndexedDBCache, setIndexedDBCache, clearIndexedDBCache, clearAllIndexedDBCache
 * - Utilities: isCacheDisabled, clearAllCaches, getAtlasCacheStats, getBuildVersion
 *
 * @module renderer/sprite-cache
 */
export {
    type CachedSlot,
    type CachedAtlasData,
    getAtlasCache,
    setAtlasCache,
    clearAtlasCache,
    clearAllAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    clearIndexedDBCache,
    clearAllIndexedDBCache,
    isCacheDisabled,
    clearAllCaches,
    getAtlasCacheStats,
    getBuildVersion,
} from './sprite-atlas-cache';
