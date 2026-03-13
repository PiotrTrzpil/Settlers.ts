/**
 * Sprite Atlas Cache Manager — orchestrates streaming cache restore.
 *
 * Three-tier restore:
 * 1. Module-level Map (instant, survives HMR)
 * 2. Cache API via streaming worker:
 *    a. Read metadata + palette first (fast, ~5ms)
 *    b. Compute layer priority from nearby game entities
 *    c. Stream layers one by one in priority order
 *    d. Fire onEssentialReady when common sprites are loaded
 *    e. Continue streaming remaining layers in background
 */

import { LogHandler } from '@/utilities/log-handler';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { PaletteTextureManager } from './palette-texture';
import { SpriteMetadataRegistry, Race } from './sprite-metadata';
import { debugStats } from '@/game/debug/debug-stats';
import {
    getAtlasCache,
    setAtlasCache,
    isCacheDisabled,
    startStreamingRead,
    type CachedAtlasData,
    type CachedAtlasBase,
    type CacheStreamMeta,
} from './sprite-cache';
import { consumeEarlyPrefetch, type EarlyPrefetchHandle } from './sprite-cache/early-prefetch';
import type { Entity } from '@/game/entity';
import { BuildingType, UnitType } from '@/game/entity';

const log = new LogHandler('SpriteAtlasCacheManager');

// =============================================================================
// Prefetch state
// =============================================================================

let prefetchRace: Race | null = null;
let prefetchMetaPromise: Promise<CacheStreamMeta | null> | null = null;
let prefetchSendPriority: ((order: number[]) => void) | null = null;
let prefetchSetPaletteCb: ((fn: (paletteData: Uint8Array | null) => void) => void) | null = null;
let prefetchSetLayerCb: ((fn: (index: number, buffer: ArrayBuffer) => void) => void) | null = null;
let prefetchSetDoneCb: ((fn: (timings: { layerRead: number; total: number }) => void) => void) | null = null;

/**
 * Invalidate any in-flight or resolved prefetch.
 * Called by clearAllCaches() so a stale prefetch doesn't resurrect cleared data.
 */
export function invalidatePrefetch(): void {
    prefetchRace = null;
    prefetchMetaPromise = null;
    prefetchSendPriority = null;
    prefetchSetPaletteCb = null;
    prefetchSetLayerCb = null;
    prefetchSetDoneCb = null;
}

/**
 * Adopt the early-prefetch handle (started from main.ts before Vue loaded).
 * Converts the raw early handle into the typed prefetch state used by tryStreamingRestore.
 */
function adoptEarlyPrefetch(handle: EarlyPrefetchHandle): void {
    prefetchRace = handle.race;
    prefetchSendPriority = handle.sendPriority;
    prefetchSetPaletteCb = handle.setPaletteCb;
    prefetchSetLayerCb = handle.setLayerCb;
    prefetchSetDoneCb = handle.setDoneCb;

    // Convert the raw meta promise (metaJson string) into a typed CacheStreamMeta
    prefetchMetaPromise = handle.metaPromise.then(raw => {
        if (!raw) {
            return null;
        }
        const meta = JSON.parse(raw.metaJson) as CachedAtlasBase;
        return { meta, timings: raw.timings } as CacheStreamMeta;
    });
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
// Layer priority computation
// =============================================================================

/**
 * Compute layer load order based on which sprites are most common near the player start.
 * Returns all layer indices sorted by priority (most important first).
 */
export function computeLayerPriority(
    registry: SpriteMetadataRegistry,
    nearbyEntities: Entity[],
    playerRace: number,
    totalLayers: number
): { layerOrder: number[]; essentialCount: number } {
    // Count entity subtypes by entity type
    const mapObjectTypes = new Set<number>();
    const buildingTypes = new Set<BuildingType>();
    const unitTypes = new Set<UnitType>();
    const layerScore = new Map<number, number>();

    for (const entity of nearbyEntities) {
        const entityType = entity.type as number;
        if (entityType === 3 /* MapObject */) {
            mapObjectTypes.add(entity.subType as number);
        } else if (entityType === 2 /* Building */) {
            buildingTypes.add(entity.subType as BuildingType);
        } else if (entityType === 1 /* Unit */) {
            unitTypes.add(entity.subType as UnitType);
        }
    }

    // Score layers by how many nearby entities need sprites from them
    const addScore = (layers: Set<number>, weight: number) => {
        for (const layer of layers) {
            layerScore.set(layer, (layerScore.get(layer) ?? 0) + weight);
        }
    };

    // Map objects (trees, stones) are the most common visible elements
    addScore(registry.getLayersForMapObjects(mapObjectTypes), 3);
    // Buildings are next most important
    addScore(registry.getLayersForBuildings(buildingTypes, playerRace), 2);
    // Units
    addScore(registry.getLayersForUnits(unitTypes, playerRace), 1);

    // Sort by score (highest first), then by index for stability
    const allLayers = Array.from({ length: totalLayers }, (_, i) => i);
    allLayers.sort((a, b) => {
        const scoreA = layerScore.get(a) ?? 0;
        const scoreB = layerScore.get(b) ?? 0;
        if (scoreB !== scoreA) {
            return scoreB - scoreA;
        }
        return a - b;
    });

    // Essential = layers that have any score (contain nearby entity sprites)
    const essentialCount = allLayers.filter(l => (layerScore.get(l) ?? 0) > 0).length;

    log.debug(
        `Layer priority: ${essentialCount} essential of ${totalLayers} total ` +
            `(${mapObjectTypes.size} mapObj types, ${buildingTypes.size} building types, ${unitTypes.size} unit types)`
    );

    return { layerOrder: allLayers, essentialCount };
}

// =============================================================================
// SpriteAtlasCacheManager
// =============================================================================

/** Callback for when essential sprites are ready (common sprites near player start) */
export type EssentialSpritesCallback = () => void;

/**
 * Manages sprite atlas caching with progressive streaming.
 */
export class SpriteAtlasCacheManager {
    /**
     * Start a streaming cache prefetch for the given race.
     * First tries to adopt the early-prefetch handle (started from main.ts before Vue loaded).
     * Falls back to starting a fresh streaming read if no early prefetch is available.
     */
    public prefetch(race: Race): void {
        if (isCacheDisabled() || prefetchMetaPromise) {
            return;
        }

        // Try to adopt the early prefetch (started at module-init time in main.ts)
        const earlyHandle = consumeEarlyPrefetch();
        if (earlyHandle) {
            if (earlyHandle.race === race) {
                console.log(`[${performance.now().toFixed(0)}ms] [cache] adopting early prefetch for ${Race[race]}`);
                adoptEarlyPrefetch(earlyHandle);
                return;
            }
            // Race mismatch — discard early prefetch, start fresh
            console.log(
                `[${performance.now().toFixed(0)}ms] [cache] early prefetch race mismatch ` +
                    `(early=${Race[earlyHandle.race]}, need=${Race[race]}), starting fresh`
            );
            earlyHandle.worker.terminate();
        }

        // No early prefetch or race mismatch — start fresh
        console.log(`[${performance.now().toFixed(0)}ms] [cache] prefetch started for ${Race[race]}`);

        let paletteCb: (paletteData: Uint8Array | null) => void = () => {};
        let layerCb: (index: number, buffer: ArrayBuffer) => void = () => {};
        let doneCb: (timings: { layerRead: number; total: number }) => void = () => {};

        const { metaPromise, sendPriority } = startStreamingRead(
            race,
            pd => paletteCb(pd),
            (index, buffer) => layerCb(index, buffer),
            timings => doneCb(timings)
        );

        prefetchRace = race;
        prefetchMetaPromise = metaPromise;
        prefetchSendPriority = sendPriority;
        prefetchSetPaletteCb = fn => {
            paletteCb = fn;
        };
        prefetchSetLayerCb = fn => {
            layerCb = fn;
        };
        prefetchSetDoneCb = fn => {
            doneCb = fn;
        };
    }

    /**
     * Try to restore atlas + registry from cache.
     * For module cache: instant restore (all layers available).
     * For IndexedDB: starts streaming restore — returns immediately with atlas shell,
     * then streams layers progressively.
     *
     * @param onEssentialReady Called when enough layers for common sprites are loaded
     * @param nearbyEntities Entities near player start (for computing layer priority)
     * @param playerRace Current player's race
     */
    public async tryRestore(
        gl: WebGL2RenderingContext,
        race: Race,
        textureUnit: number,
        paletteManager: PaletteTextureManager,
        onEssentialReady: EssentialSpritesCallback,
        nearbyEntities: Entity[],
        playerRace: number
    ): Promise<CacheRestoreResult | null> {
        if (isCacheDisabled()) {
            log.debug('Cache disabled via settings, loading from files');
            return null;
        }

        // Tier 1: module-level cache (instant, survives HMR)
        const moduleCached = getAtlasCache(race);
        if (moduleCached) {
            const result = this.restoreFromModuleCache(gl, moduleCached, textureUnit, paletteManager);
            onEssentialReady();
            return result;
        }

        // Tier 2: streaming restore from Cache API
        return this.tryStreamingRestore(
            gl,
            race,
            textureUnit,
            paletteManager,
            onEssentialReady,
            nearbyEntities,
            playerRace
        );
    }

    /**
     * Save current atlas, registry, and palette to both cache tiers (fire-and-forget).
     */
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

        const { setIndexedDBCache } = await import('./sprite-cache');

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

        // Save to Cache API (async, for page refresh) — don't await to avoid blocking
        setIndexedDBCache(race, cacheData).catch((e: unknown) => {
            console.error(`[cache] save FAILED:`, e);
        });
    }

    // ==========================================================================
    // Private helpers
    // ==========================================================================

    /** Restore from module cache (all layers available immediately). */
    private restoreFromModuleCache(
        gl: WebGL2RenderingContext,
        cached: CachedAtlasData,
        textureUnit: number,
        paletteManager: PaletteTextureManager
    ): CacheRestoreResult {
        const t0 = performance.now();

        const atlas = EntityTextureAtlas.fromCache(
            cached.layerBuffers,
            cached.layerCount,
            cached.maxLayers,
            cached.slots,
            textureUnit
        );

        const registry = SpriteMetadataRegistry.deserialize(cached.registryData);

        atlas.allocateDeferred(gl);

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
        console.log(`[${performance.now().toFixed(0)}ms] [restore] source=module total=${total}ms`);

        this.recordDebugStats(cached, atlas, registry, total, 'module');
        return { atlas, registry, source: 'module' };
    }

    /** Streaming restore from Cache API via worker. */
    private async tryStreamingRestore(
        gl: WebGL2RenderingContext,
        race: Race,
        textureUnit: number,
        paletteManager: PaletteTextureManager,
        onEssentialReady: EssentialSpritesCallback,
        nearbyEntities: Entity[],
        playerRace: number
    ): Promise<CacheRestoreResult | null> {
        const t0 = performance.now();

        // Use prefetched stream if available, otherwise start fresh
        let metaPromise: Promise<CacheStreamMeta | null>;
        let sendPriority: (order: number[]) => void;
        let setPaletteCb: (fn: (paletteData: Uint8Array | null) => void) => void;
        let setLayerCb: (fn: (index: number, buffer: ArrayBuffer) => void) => void;
        let setDoneCb: (fn: (timings: { layerRead: number; total: number }) => void) => void;

        if (prefetchMetaPromise && prefetchSendPriority && prefetchRace === race) {
            metaPromise = prefetchMetaPromise;
            sendPriority = prefetchSendPriority;
            setPaletteCb = prefetchSetPaletteCb!;
            setLayerCb = prefetchSetLayerCb!;
            setDoneCb = prefetchSetDoneCb!;
            // Clear prefetch state
            invalidatePrefetch();
        } else {
            // Race mismatch or no prefetch — discard stale prefetch and start fresh
            if (prefetchMetaPromise && prefetchRace !== race) {
                console.log(
                    `[${performance.now().toFixed(0)}ms] [cache] prefetch race mismatch ` +
                        `(prefetched=${prefetchRace !== null ? Race[prefetchRace] : 'none'}, need=${Race[race]}), starting fresh`
                );
                invalidatePrefetch();
            }
            // No prefetch — start fresh streaming read
            let paletteCb: (paletteData: Uint8Array | null) => void = () => {};
            let layerCb: (index: number, buffer: ArrayBuffer) => void = () => {};
            let doneCb: (timings: { layerRead: number; total: number }) => void = () => {};

            const stream = startStreamingRead(
                race,
                pd => paletteCb(pd),
                (index, buffer) => layerCb(index, buffer),
                timings => doneCb(timings)
            );
            metaPromise = stream.metaPromise;
            sendPriority = stream.sendPriority;
            setPaletteCb = fn => {
                paletteCb = fn;
            };
            setLayerCb = fn => {
                layerCb = fn;
            };
            setDoneCb = fn => {
                doneCb = fn;
            };
        }

        // Wait for metadata (palette arrives separately — don't wait for it)
        const streamMeta = await metaPromise;
        debugStats.state.loadTimings.cacheWait = Math.round(performance.now() - t0);

        if (!streamMeta) {
            return null;
        }

        const { meta } = streamMeta;

        // Phase 1: Restore registry (fast, ~2ms) — no palette wait needed
        const tRegistry = performance.now();
        const registry = SpriteMetadataRegistry.deserialize(meta.registryData);
        const registryMs = Math.round(performance.now() - tRegistry);

        // Phase 2: Create atlas shell (empty layers, zero-filled)
        const atlas = EntityTextureAtlas.fromCacheShell(meta.layerCount, meta.maxLayers, meta.slots, textureUnit);
        atlas.allocateDeferred(gl);

        // Phase 3: Compute layer priority from nearby entities
        const tPriority = performance.now();
        const { layerOrder, essentialCount } = computeLayerPriority(
            registry,
            nearbyEntities,
            playerRace,
            meta.layerCount
        );
        const priorityMs = Math.round(performance.now() - tPriority);

        const metaWaitMs = Math.round(performance.now() - t0);
        console.log(
            `[${performance.now().toFixed(0)}ms] [restore] streaming: metaWait=${metaWaitMs}ms registry=${registryMs}ms ` +
                `priority=${priorityMs}ms essential=${essentialCount}/${meta.layerCount} layers ` +
                `nearby=${nearbyEntities.length} entities`
        );

        // Phase 4+5: Wire up palette and layer callbacks.
        // Essential ready requires BOTH: enough layers AND palette uploaded.
        let paletteData: Uint8Array | undefined;
        let paletteReady = false;
        let layersReceived = 0;
        let essentialFired = false;
        const layerBuffersForModuleCache: ArrayBuffer[] = Array.from({ length: meta.layerCount });

        const tryFireEssential = () => {
            if (essentialFired) {
                return;
            }
            if (!paletteReady || layersReceived < essentialCount) {
                return;
            }
            essentialFired = true;
            const tEssential = performance.now();
            console.log(
                `[${tEssential.toFixed(0)}ms] [restore] essential sprites ready ` +
                    `(${essentialCount} layers in ${Math.round(tEssential - t0)}ms)`
            );
            onEssentialReady();
        };

        setPaletteCb((pd: Uint8Array | null) => {
            if (pd && meta.paletteOffsets && meta.paletteTotalColors) {
                paletteData = pd;
                paletteManager.restoreFromCache(pd, meta.paletteOffsets, meta.paletteTotalColors, meta.paletteRows);
                paletteManager.upload(gl);
                console.log(`[${performance.now().toFixed(0)}ms] [restore] palette uploaded`);
            }
            paletteReady = true;
            tryFireEssential();
        });

        setLayerCb((index: number, buffer: ArrayBuffer) => {
            // Store for module cache population later
            layerBuffersForModuleCache[index] = buffer;

            // Set layer data on atlas (marks dirty for GPU upload)
            atlas.setLayerData(index, buffer);
            layersReceived++;
            tryFireEssential();
        });

        setDoneCb(() => {
            // If essential wasn't fired (e.g. 0 essential layers), fire now
            if (!essentialFired) {
                essentialFired = true;
                onEssentialReady();
            }

            console.log(
                `[${performance.now().toFixed(0)}ms] [restore] all done, total=${Math.round(performance.now() - t0)}ms ` +
                    `(${layersReceived} layers received)`
            );

            // Populate module cache with all layers for future HMR hits
            const moduleCacheData: CachedAtlasData = {
                ...meta,
                layerBuffers: layerBuffersForModuleCache,
                paletteData,
            };
            setAtlasCache(race, moduleCacheData);

            this.recordDebugStats(moduleCacheData, atlas, registry, Math.round(performance.now() - t0), 'indexeddb');
        });

        // Phase 6: Send priority order to worker — starts layer delivery
        console.log(
            `[${performance.now().toFixed(0)}ms] [cache] sending priority to worker ` +
                `(${Math.round(performance.now() - t0)}ms after restore start)`
        );
        sendPriority(layerOrder);

        return { atlas, registry, source: 'indexeddb' };
    }

    /** Record cache hit in debug stats. */
    private recordDebugStats(
        cached:
            | CachedAtlasData
            | (CacheStreamMeta['meta'] & { layerBuffers?: ArrayBuffer[]; paletteData?: Uint8Array }),
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        total: number,
        source: 'module' | 'indexeddb'
    ): void {
        const lt = debugStats.state.loadTimings;
        Object.assign(lt, {
            filePreload: 0,
            atlasAlloc: 0,
            buildings: 0,
            mapObjects: 0,
            goods: 0,
            units: 0,
            deserialize: 0,
            atlasRestore: 0,
            registryDeserialize: 0,
            paletteUpload: 0,
            gpuUpload: 0,
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
    }
}
