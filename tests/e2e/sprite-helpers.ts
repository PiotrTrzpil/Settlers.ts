/**
 * Sprite loading and cache helpers for e2e tests.
 *
 * Standalone functions that operate on a Playwright Page via `page.evaluate()`.
 * GamePage delegates to these; tests can also import them directly.
 */
import type { Page } from '@playwright/test';

// ── Return types ────────────────────────────────────────────────

export interface LoadTimings {
    totalSprites: number;
    cacheHit: boolean;
    cacheSource: 'module' | 'indexeddb' | null;
}

export interface LoadedUnitSprites {
    currentRace: string | null;
    loadedByType: Record<number, boolean>;
    loadedCount: number;
}

export interface JilLookupResult {
    totalJobs: number;
    results: Record<number, { exists: boolean; offset?: number; length?: number }>;
}

// ── Sprite queries ──────────────────────────────────────────────

/** Check if the entity renderer has sprites loaded. */
export async function hasSpritesLoaded(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const renderer = window.__settlers__?.entityRenderer;
        if (!renderer) return false;
        const spriteManager = (renderer as any).spriteManager;
        return spriteManager?.hasSprites === true;
    });
}

/**
 * Query loaded unit sprites from the sprite registry.
 * Returns which unit types (0-8) have loaded sprites.
 */
export async function getLoadedUnitSprites(page: Page): Promise<LoadedUnitSprites | null> {
    return page.evaluate(() => {
        const renderer = window.__settlers__?.entityRenderer;
        if (!renderer) return null;
        const spriteManager = (renderer as any).spriteManager;
        if (!spriteManager) return null;
        const loadedByType: Record<number, boolean> = {};
        for (let unitType = 0; unitType <= 8; unitType++) {
            const sprite = spriteManager.getUnit(unitType, 0);
            loadedByType[unitType] = sprite !== null;
        }
        return {
            currentRace: spriteManager.currentRace ?? null,
            loadedByType,
            loadedCount: Object.values(loadedByType).filter(Boolean).length,
        };
    });
}

/** Get the unit sprite registry size. */
export async function getSpriteRegistrySize(page: Page): Promise<number> {
    return page.evaluate(() => {
        const renderer = window.__settlers__?.entityRenderer;
        const registry = (renderer as any)?.spriteManager?._spriteRegistry;
        return (registry?.getBuildingCount?.() ?? 0) + (registry?.getUnitCount?.() ?? 0);
    });
}

/**
 * Test JIL index lookup for specific job indices.
 * Returns info about which job indices exist in the JIL file.
 */
export async function testJilLookup(page: Page, fileId: string, jobIndices: number[]): Promise<JilLookupResult | null> {
    return page.evaluate(
        async ({ fid, indices }) => {
            const renderer = window.__settlers__?.entityRenderer;
            const spriteLoader = (renderer as any)?.spriteManager?.spriteLoader;
            if (!spriteLoader) return null;
            const fileSet = await spriteLoader.loadFileSet(fid);
            if (!fileSet?.jilReader) return null;
            const totalJobs = fileSet.jilReader.length;
            const results: Record<number, { exists: boolean; offset?: number; length?: number }> = {};
            for (const idx of indices) {
                const item = fileSet.jilReader.getItem(idx);
                results[idx] = item ? { exists: true, offset: item.offset, length: item.length } : { exists: false };
            }
            return { totalJobs, results };
        },
        { fid: fileId, indices: jobIndices }
    );
}

// ── Race switching ──────────────────────────────────────────────

/**
 * Switch the sprite renderer to a different race, reloading all sprites.
 * Returns true if sprites loaded successfully for the new race.
 */
export async function switchSpriteRace(page: Page, race: number): Promise<boolean> {
    return page.evaluate(async r => {
        const sm = window.__settlers__?.entityRenderer?.spriteManager;
        if (!sm) return false;
        return sm.setRace(r);
    }, race);
}

// ── Sprite coverage ─────────────────────────────────────────────

export interface MissingSpriteInfo {
    entityId: number;
    entityType: number;
    entityTypeName: string;
    subType: number | string;
    subTypeName: string;
    race: number;
}

/**
 * Find all entities currently in the game state that have no textured sprite.
 * Queries the SpriteRenderManager directly for each entity.
 * Filters out Decoration and None entity types (they never have sprites).
 */
export async function getEntitiesWithoutSprites(page: Page): Promise<MissingSpriteInfo[]> {
    return page.evaluate(() => {
        const game = window.__settlers__?.game;
        const renderer = window.__settlers__?.entityRenderer;
        if (!game || !renderer) return [];

        const sm = renderer.spriteManager;
        if (!sm) return [];

        // EntityType enum values (inlined to avoid import boundary)
        const ET_UNIT = 1;
        const ET_BUILDING = 2;
        const ET_MAP_OBJECT = 3;
        const ET_STACKED_PILE = 4;

        const entityTypeNames: Record<number, string> = {
            0: 'None',
            1: 'Unit',
            2: 'Building',
            3: 'MapObject',
            4: 'StackedPile',
            5: 'Decoration',
        };

        const missing: Array<{
            entityId: number;
            entityType: number;
            entityTypeName: string;
            subType: number | string;
            subTypeName: string;
            race: number;
        }> = [];

        const spriteCheckers: Record<number, (e: any) => boolean> = {
            [ET_UNIT]: (e: any) => sm.getUnit(e.subType, 0, e.race) !== null,
            [ET_BUILDING]: (e: any) => sm.getBuilding(e.subType, e.race) !== null,
            [ET_MAP_OBJECT]: (e: any) => sm.getMapObject(e.subType) !== null,
            [ET_STACKED_PILE]: (e: any) => sm.getGoodSprite(e.subType) !== null,
        };

        for (const entity of game.state.entities) {
            const checker = spriteCheckers[entity.type];
            if (!checker) continue;

            if (!checker(entity)) {
                missing.push({
                    entityId: entity.id,
                    entityType: entity.type,
                    entityTypeName: entityTypeNames[entity.type] ?? `Unknown(${entity.type})`,
                    subType: entity.subType,
                    subTypeName: `${entity.subType}`,
                    race: entity.race,
                });
            }
        }

        return missing;
    });
}

// ── Cache helpers ───────────────────────────────────────────────

/** Get sprite load timings from debug state. */
export async function getLoadTimings(page: Page): Promise<LoadTimings> {
    return page.evaluate(() => {
        const d = window.__settlers__?.debug;
        return {
            totalSprites: d?.loadTimings?.totalSprites ?? 0,
            cacheHit: d?.loadTimings?.cacheHit ?? false,
            cacheSource: d?.loadTimings?.cacheSource ?? null,
        };
    });
}

/** Clear the IndexedDB sprite atlas cache. */
export async function clearSpriteCache(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const DB_NAME = 'settlers-atlas-cache';
        return new Promise<void>(resolve => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
        });
    });
}
