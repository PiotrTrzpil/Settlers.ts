/**
 * Sprite Cache Module
 *
 * Two-tier caching system for sprite atlas data:
 * - Tier 1: Module-level Map (survives HMR, lost on refresh)
 * - Tier 2: Cache API with per-layer storage (survives refresh, invalidated on build version change)
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
