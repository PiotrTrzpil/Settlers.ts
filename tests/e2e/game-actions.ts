/**
 * Game action and query helpers for e2e tests.
 *
 * Standalone functions that operate on a Playwright Page via `page.evaluate()`.
 * GamePage delegates to these; tests can also import them directly.
 */
import type { Page } from '@playwright/test';

// ── Return types ────────────────────────────────────────────────

export interface GameState {
    mode: string;
    placeBuildingType: number;
    entityCount: number;
    entities: EntityInfo[];
    mapWidth: number;
    mapHeight: number;
}

export interface EntityInfo {
    id: number;
    type: number;
    subType: number;
    x: number;
    y: number;
    player: number;
}

export interface BuildingResult {
    id: number;
    type: number;
    subType: number;
    x: number;
    y: number;
    player: number;
}

export interface ResourceResult {
    id: number;
    type: number;
    subType: number;
    x: number;
    y: number;
    amount: number;
}

export interface UnitResult {
    id: number;
    type: number;
    subType: number;
    x: number;
    y: number;
}

export interface TerrainInfo {
    groundType: number;
    isPassable: boolean;
    isWater: boolean;
}

export interface PlacementPreview {
    indicatorsEnabled: boolean;
    previewBuildingType: number | null;
    previewMaterialType: number | null;
    placementPreview: { entityType: string; subType: number } | null;
}

export interface BatchBuildingResult {
    placedCount: number;
    positions: Array<{ x: number; y: number }>;
    totalBuildings: number;
}

export interface BatchResourceResult {
    placedCount: number;
    totalResources: number;
}

export interface EntityFilter {
    type?: number;
    subType?: number;
    player?: number;
}

// ── Game state reads ────────────────────────────────────────────

/** Read structured game state including entities and map size. */
export async function getGameState(page: Page): Promise<GameState | null> {
    return page.evaluate(() => {
        const game = (window as any).__settlers_game__;
        if (!game) return null;
        return {
            mode: game.mode,
            placeBuildingType: game.placeBuildingType,
            entityCount: game.state.entities.length,
            entities: game.state.entities.map((e: any) => ({
                id: e.id,
                type: e.type,
                subType: e.subType,
                x: e.x,
                y: e.y,
                player: e.player,
            })),
            mapWidth: game.terrain.mapSize.width,
            mapHeight: game.terrain.mapSize.height,
        };
    });
}

/**
 * Read entities from game state, optionally filtered.
 */
export async function getEntities(page: Page, filter?: EntityFilter | null): Promise<EntityInfo[]> {
    return page.evaluate(f => {
        const game = (window as any).__settlers_game__;
        if (!game) return [];
        return game.state.entities
            .filter((e: any) => {
                if (f?.type !== undefined && e.type !== f.type) return false;
                if (f?.subType !== undefined && e.subType !== f.subType) return false;
                if (f?.player !== undefined && e.player !== f.player) return false;
                return true;
            })
            .map((e: any) => ({
                id: e.id,
                type: e.type,
                subType: e.subType,
                x: e.x,
                y: e.y,
                player: e.player,
            }));
    }, filter ?? null);
}

/** Get the map center coordinates. */
export async function getMapCenter(page: Page): Promise<{ x: number; y: number }> {
    return page.evaluate(() => {
        const game = (window as any).__settlers_game__;
        return {
            x: Math.floor(game.terrain.mapSize.width / 2),
            y: Math.floor(game.terrain.mapSize.height / 2),
        };
    });
}

/** Check if a tile is passable terrain (not water, not blocked). */
export async function isTerrainPassable(page: Page, x: number, y: number): Promise<TerrainInfo | null> {
    return page.evaluate(
        ({ tx, ty }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const idx = game.terrain.mapSize.toIndex(tx, ty);
            const gt = game.terrain.groundType[idx];
            return {
                groundType: gt,
                isPassable: gt > 8 && gt !== 32,
                isWater: gt <= 8,
            };
        },
        { tx: x, ty: y }
    );
}

/** Get placement preview state from the entity renderer. */
export async function getPlacementPreview(page: Page): Promise<PlacementPreview | null> {
    return page.evaluate(() => {
        const renderer = (window as any).__settlers_entity_renderer__;
        if (!renderer) return null;
        return {
            indicatorsEnabled: renderer.buildingIndicatorsEnabled,
            previewBuildingType: renderer.previewBuildingType ?? null,
            previewMaterialType: renderer.previewMaterialType ?? null,
            placementPreview: renderer.placementPreview
                ? {
                      entityType: renderer.placementPreview.entityType,
                      subType: renderer.placementPreview.subType,
                  }
                : null,
        };
    });
}

// ── Game actions ────────────────────────────────────────────────

/**
 * Set game speed multiplier.
 * @param speed - Speed multiplier (1.0 = normal, 4.0 = 4x faster)
 */
export async function setGameSpeed(page: Page, speed: number): Promise<void> {
    await page.evaluate(s => {
        const settings = (window as any).__settlers_game_settings__;
        if (settings?.state) {
            settings.state.gameSpeed = s;
        }
    }, speed);
}

/**
 * Place a building via game.execute() command pipeline.
 * Returns the created entity info, or null if placement failed.
 */
export async function placeBuilding(
    page: Page,
    buildingType: number,
    x: number,
    y: number,
    player = 0
): Promise<BuildingResult | null> {
    return page.evaluate(
        ({ bt, posX, posY, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const cmdResult = game.execute({
                type: 'place_building',
                buildingType: bt,
                x: posX,
                y: posY,
                player: p,
            });
            if (!cmdResult?.success) return null;
            const entityId = cmdResult.effects?.[0]?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            (window as any).__settlers_view_state__?.forceCountUpdate();
            return {
                id: entity.id,
                type: entity.type,
                subType: entity.subType,
                x: entity.x,
                y: entity.y,
                player: entity.player,
            };
        },
        { bt: buildingType, posX: x, posY: y, p: player }
    );
}

/**
 * Place a resource via game.execute() command pipeline.
 * Returns the created entity info, or null if placement failed.
 */
export async function placeResource(
    page: Page,
    materialType: number,
    x: number,
    y: number,
    amount = 1
): Promise<ResourceResult | null> {
    return page.evaluate(
        ({ mt, posX, posY, amt }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const cmdResult = game.execute({
                type: 'place_resource',
                materialType: mt,
                x: posX,
                y: posY,
                amount: amt,
            });
            if (!cmdResult?.success) return null;
            const entityId = cmdResult.effects?.[0]?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            const resourceState = game.state.resources?.states?.get(entityId);
            (window as any).__settlers_view_state__?.forceCountUpdate();
            return {
                id: entity.id,
                type: entity.type,
                subType: entity.subType,
                x: entity.x,
                y: entity.y,
                amount: resourceState?.quantity ?? amt,
            };
        },
        { mt: materialType, posX: x, posY: y, amt: amount }
    );
}

/**
 * Spawn a unit via game.execute() command pipeline (bypasses UI buttons).
 * If x/y not provided, spawns at map center.
 */
export async function spawnUnit(
    page: Page,
    unitType = 1,
    x?: number,
    y?: number,
    player = 0
): Promise<UnitResult | null> {
    return page.evaluate(
        ({ ut, posX, posY, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const spawnX = posX ?? Math.floor(game.terrain.mapSize.width / 2);
            const spawnY = posY ?? Math.floor(game.terrain.mapSize.height / 2);
            const cmdResult = game.execute({ type: 'spawn_unit', unitType: ut, x: spawnX, y: spawnY, player: p });
            if (!cmdResult?.success) return null;
            const entityId = cmdResult.effects?.[0]?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            (window as any).__settlers_view_state__?.forceCountUpdate();
            return {
                id: entity.id,
                type: entity.type,
                subType: entity.subType,
                x: entity.x,
                y: entity.y,
            };
        },
        { ut: unitType, posX: x, posY: y, p: player }
    );
}

/**
 * Issue a move_unit command via game.execute().
 * Returns true if the command was accepted.
 */
export async function moveUnit(page: Page, entityId: number, targetX: number, targetY: number): Promise<boolean> {
    return page.evaluate(
        ({ id, tx, ty }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            return game.execute({ type: 'move_unit', entityId: id, targetX: tx, targetY: ty })?.success ?? false;
        },
        { id: entityId, tx: targetX, ty: targetY }
    );
}

// ── Tile search helpers ─────────────────────────────────────────

/**
 * Find a buildable tile by spiraling from map center.
 * Temporarily places and removes a building to validate terrain + slope.
 * @param buildingType BuildingType to test (default 1 = Lumberjack).
 */
export async function findBuildableTile(page: Page, buildingType = 1): Promise<{ x: number; y: number } | null> {
    return page.evaluate(bt => {
        const game = (window as any).__settlers_game__;
        if (!game) return null;
        const search = (window as any)
            .__settlers_spiral_search__ as typeof import('@/game/utils/spiral-search').spiralSearch;
        const w = game.terrain.mapSize.width;
        const h = game.terrain.mapSize.height;

        return search(Math.floor(w / 2), Math.floor(h / 2), w, h, (tx, ty) => {
            const result = game.execute({
                type: 'place_building',
                buildingType: bt,
                x: tx,
                y: ty,
                player: 0,
            });
            if (result?.success) {
                const entityId = result.effects?.[0]?.entityId;
                if (entityId != null) {
                    game.execute({ type: 'remove_entity', entityId });
                }
                return true;
            }
            return false;
        });
    }, buildingType);
}

/**
 * Find a passable tile (suitable for resource placement) by spiraling from map center.
 */
export async function findPassableTile(page: Page): Promise<{ x: number; y: number } | null> {
    return page.evaluate(() => {
        const game = (window as any).__settlers_game__;
        if (!game) return null;
        const search = (window as any)
            .__settlers_spiral_search__ as typeof import('@/game/utils/spiral-search').spiralSearch;
        const w = game.terrain.mapSize.width;
        const h = game.terrain.mapSize.height;

        return search(Math.floor(w / 2), Math.floor(h / 2), w, h, (tx, ty) => {
            const idx = game.terrain.mapSize.toIndex(tx, ty);
            const gt = game.terrain.groundType[idx];
            const isPassable = gt > 8 && gt !== 32;
            const key = `${tx},${ty}`;
            const isOccupied = game.state.tileOccupancy?.has(key);
            return isPassable && !isOccupied;
        });
    });
}

// ── Batch placement ─────────────────────────────────────────────

/**
 * Place multiple buildings at different positions, spiraling from map center.
 */
export async function placeMultipleBuildings(
    page: Page,
    count: number,
    buildingTypes?: number[],
    players?: number[]
): Promise<BatchBuildingResult> {
    return page.evaluate(
        ({ targetCount, types, ps }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { placedCount: 0, positions: [], totalBuildings: 0 };
            const w = game.terrain.mapSize.width;
            const h = game.terrain.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            let placed = 0;
            const positions: Array<{ x: number; y: number }> = [];
            for (let r = 0; r < Math.max(w, h) / 2 && placed < targetCount; r += 3) {
                for (let angle = 0; angle < 8 && placed < targetCount; angle++) {
                    const dx = Math.round(r * Math.cos((angle * Math.PI) / 4));
                    const dy = Math.round(r * Math.sin((angle * Math.PI) / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
                    const bt = types ? types[placed % types.length] : 1;
                    const p = ps ? ps[placed % ps.length] : 0;
                    const result = game.execute({
                        type: 'place_building',
                        buildingType: bt,
                        x: tx,
                        y: ty,
                        player: p,
                    });
                    if (result?.success) {
                        placed++;
                        positions.push({ x: tx, y: ty });
                    }
                }
            }
            return {
                placedCount: placed,
                positions,
                totalBuildings: game.state.entities.filter((e: any) => e.type === 2).length,
            };
        },
        { targetCount: count, types: buildingTypes ?? null, ps: players ?? null }
    );
}

/**
 * Place multiple resources at different positions, spiraling from map center.
 */
export async function placeMultipleResources(
    page: Page,
    count: number,
    materialTypes?: number[]
): Promise<BatchResourceResult> {
    return page.evaluate(
        ({ targetCount, types }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return { placedCount: 0, totalResources: 0 };
            const w = game.terrain.mapSize.width;
            const h = game.terrain.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            let placed = 0;
            for (let r = 0; r < 20 && placed < targetCount; r++) {
                for (let angle = 0; angle < 8 && placed < targetCount; angle++) {
                    const dx = Math.round(r * 2 * Math.cos((angle * Math.PI) / 4));
                    const dy = Math.round(r * 2 * Math.sin((angle * Math.PI) / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
                    const mt = types ? types[placed % types.length] : placed % 3;
                    const result = game.execute({
                        type: 'place_resource',
                        materialType: mt,
                        amount: placed + 1,
                        x: tx,
                        y: ty,
                    });
                    if (result?.success) placed++;
                }
            }
            return {
                placedCount: placed,
                totalResources: game.state.entities.filter((e: any) => e.type === 4).length,
            };
        },
        { targetCount: count, types: materialTypes ?? null }
    );
}

// ── Camera ──────────────────────────────────────────────────────

/**
 * Move camera to center on a specific tile position.
 * Does NOT wait for frames — caller is responsible for waiting.
 */
export async function setCameraPosition(page: Page, tileX: number, tileY: number): Promise<void> {
    await page.evaluate(
        ({ x, y }) => {
            const vp = (window as any).__settlers_viewpoint__;
            if (vp?.setPosition) {
                vp.setPosition(x, y);
            }
        },
        { x: tileX, y: tileY }
    );
}
