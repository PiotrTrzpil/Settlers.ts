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
    previewBuildingType: number | null;
    previewMaterialType: number | null;
    placementPreview: { entityType: string; subType: number } | null;
}

export interface BatchPlacementResult {
    placedCount: number;
    positions: Array<{ x: number; y: number }>;
    totalEntities: number;
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
        const game = window.__settlers__?.game;
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
        const game = window.__settlers__?.game;
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
        const game = window.__settlers__!.game!;
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
            const game = window.__settlers__?.game;
            if (!game) return null;
            const idx = game.terrain.mapSize.toIndex(tx, ty);
            const gt = game.terrain.groundType[idx]!;
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
        const renderer = window.__settlers__?.entityRenderer;
        if (!renderer) return null;
        const preview = renderer.placementPreview
            ? { entityType: renderer.placementPreview.entityType, subType: renderer.placementPreview.subType }
            : null;
        return {
            previewBuildingType: preview?.entityType === 'building' ? preview.subType : null,
            previewMaterialType: preview?.entityType === 'resource' ? preview.subType : null,
            placementPreview: preview,
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
        const settings = window.__settlers__?.settings;
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
            const game = window.__settlers__?.game;
            if (!game) return null;
            const cmdResult = game.execute({
                type: 'place_building',
                buildingType: bt,
                x: posX,
                y: posY,
                player: p,
                race: 10,
            });
            if (!cmdResult?.success) return null;
            const entityId = (cmdResult.effects?.[0] as { entityId?: number })?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            window.__settlers__?.viewState?.forceCountUpdate();
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
            const game = window.__settlers__?.game;
            if (!game) return null;
            const cmdResult = game.execute({
                type: 'place_resource',
                materialType: mt,
                x: posX,
                y: posY,
                amount: amt,
            });
            if (!cmdResult?.success) return null;
            const entityId = (cmdResult.effects?.[0] as { entityId?: number })?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            const resourceState = game.state.resources?.states?.get(entityId);
            window.__settlers__?.viewState?.forceCountUpdate();
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
            const game = window.__settlers__?.game;
            if (!game) return null;
            const spawnX = posX ?? Math.floor(game.terrain.mapSize.width / 2);
            const spawnY = posY ?? Math.floor(game.terrain.mapSize.height / 2);
            const cmdResult = game.execute({
                type: 'spawn_unit',
                unitType: ut,
                x: spawnX,
                y: spawnY,
                player: p,
                race: 10,
            });
            if (!cmdResult?.success) return null;
            const entityId = (cmdResult.effects?.[0] as { entityId?: number })?.entityId;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            window.__settlers__?.viewState?.forceCountUpdate();
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
            const game = window.__settlers__?.game;
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
        const game = window.__settlers__?.game;
        if (!game) return null;
        const search = window.__settlers__!.utils!.spiralSearch!;
        const w = game.terrain.mapSize.width;
        const h = game.terrain.mapSize.height;

        return search(Math.floor(w / 2), Math.floor(h / 2), w, h, (tx, ty) => {
            const result = game.execute({
                type: 'place_building',
                buildingType: bt,
                x: tx,
                y: ty,
                player: 0,
                race: 10,
            });
            if (result?.success) {
                const entityId = (result.effects?.[0] as { entityId?: number })?.entityId;
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
        const game = window.__settlers__?.game;
        if (!game) return null;
        const search = window.__settlers__!.utils!.spiralSearch!;
        const w = game.terrain.mapSize.width;
        const h = game.terrain.mapSize.height;

        return search(Math.floor(w / 2), Math.floor(h / 2), w, h, (tx, ty) => {
            const idx = game.terrain.mapSize.toIndex(tx, ty);
            const gt = game.terrain.groundType[idx]!;
            const isPassable = gt > 8 && gt !== 32;
            const key = `${tx},${ty}`;
            const isOccupied = game.state.tileOccupancy?.has(key);
            return isPassable && !isOccupied;
        });
    });
}

// ── Batch placement ─────────────────────────────────────────────

export type PlacementSpec =
    | { kind: 'building'; buildingTypes?: number[]; players?: number[] }
    | { kind: 'resource'; materialTypes?: number[] };

/**
 * Place multiple entities at different positions, spiraling from map center.
 */
export async function placeMultiple(page: Page, count: number, spec: PlacementSpec): Promise<BatchPlacementResult> {
    return page.evaluate(
        ({ targetCount, s }) => {
            const game = window.__settlers__?.game;
            if (!game) return { placedCount: 0, positions: [], totalEntities: 0 };
            const w = game.terrain.mapSize.width;
            const h = game.terrain.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            let placed = 0;
            const positions: Array<{ x: number; y: number }> = [];
            for (let r = 0; r < Math.max(w, h) / 2 && placed < targetCount; r += 2) {
                for (let angle = 0; angle < 8 && placed < targetCount; angle++) {
                    const dx = Math.round(r * Math.cos((angle * Math.PI) / 4));
                    const dy = Math.round(r * Math.sin((angle * Math.PI) / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                    let result;
                    if (s.kind === 'building') {
                        const bt = s.buildingTypes ? s.buildingTypes[placed % s.buildingTypes.length]! : 1;
                        const p = s.players ? s.players[placed % s.players.length]! : 0;
                        result = game.execute({
                            type: 'place_building',
                            buildingType: bt,
                            x: tx,
                            y: ty,
                            player: p,
                            race: 10,
                        });
                    } else {
                        const mt = s.materialTypes ? s.materialTypes[placed % s.materialTypes.length]! : placed % 3;
                        result = game.execute({
                            type: 'place_resource',
                            materialType: mt,
                            amount: placed + 1,
                            x: tx,
                            y: ty,
                        });
                    }

                    if (result?.success) {
                        placed++;
                        positions.push({ x: tx, y: ty });
                    }
                }
            }
            const entityType = s.kind === 'building' ? 2 : 4;
            return {
                placedCount: placed,
                positions,
                totalEntities: game.state.entities.filter((e: any) => e.type === entityType).length,
            };
        },
        { targetCount: count, s: spec }
    );
}

// ── Building inventory ───────────────────────────────────────────

export interface InventorySlotInfo {
    materialType: number;
    currentAmount: number;
    maxCapacity: number;
    reservedAmount: number;
}

export interface BuildingInventoryInfo {
    buildingId: number;
    inputSlots: InventorySlotInfo[];
    outputSlots: InventorySlotInfo[];
}

/**
 * Read a building's inventory state (input/output slots with amounts).
 * @returns Inventory info, or null if building has no inventory
 */
export async function getBuildingInventory(page: Page, buildingId: number): Promise<BuildingInventoryInfo | null> {
    return page.evaluate(id => {
        const game = window.__settlers__?.game;
        if (!game?.services?.inventoryManager) return null;
        const inv = game.services.inventoryManager.getInventory(id);
        if (!inv) return null;
        const mapSlot = (s: any) => ({
            materialType: s.materialType,
            currentAmount: s.currentAmount,
            maxCapacity: s.maxCapacity,
            reservedAmount: s.reservedAmount,
        });
        return {
            buildingId: id,
            inputSlots: inv.inputSlots.map(mapSlot),
            outputSlots: inv.outputSlots.map(mapSlot),
        };
    }, buildingId);
}

// ── Game settings ────────────────────────────────────────────────

/**
 * Set a game setting value.
 * @param key Setting key (e.g. 'placeBuildingsCompleted', 'placeBuildingsWithWorker')
 * @param value Setting value
 */
export async function setGameSetting(page: Page, key: string, value: boolean | number | string): Promise<void> {
    await page.evaluate(
        ({ k, v }) => {
            const settings = window.__settlers__?.settings;
            if (settings?.state) {
                (settings.state as unknown as Record<string, unknown>)[k] = v;
            }
        },
        { k: key, v: value }
    );
}

// ── Tree placement ───────────────────────────────────────────────

/**
 * Plant a single tree via game.execute() command pipeline.
 * @param treeType MapObjectType (0=TreeOak)
 * @returns Entity id of the planted tree, or null if placement failed
 */
export async function plantTree(page: Page, x: number, y: number, treeType = 0): Promise<number | null> {
    return page.evaluate(
        ({ tx, ty, tt }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const result = game.execute({ type: 'plant_tree', treeType: tt, x: tx, y: ty });
            if (!result?.success) return null;
            return (result.effects?.[0] as { entityId?: number })?.entityId ?? null;
        },
        { tx: x, ty: y, tt: treeType }
    );
}

/**
 * Plant multiple trees near a position, respecting spacing and terrain constraints.
 * Uses the game's built-in spatial search to find valid spots.
 * @returns Number of trees actually planted
 */
export async function plantTreesNear(
    page: Page,
    centerX: number,
    centerY: number,
    count: number,
    radius = 15
): Promise<number> {
    return page.evaluate(
        ({ cx, cy, n, r }) => {
            const game = window.__settlers__?.game;
            if (!game?.services?.treeSystem) return 0;
            return game.services.treeSystem.plantTreesNear(cx, cy, n, r);
        },
        { cx: centerX, cy: centerY, n: count, r: radius }
    );
}

/**
 * Spawn multiple mature (immediately cuttable) trees near a position.
 * Unlike plantTreesNear, trees start in Normal stage rather than Growing.
 * @returns Number of trees actually spawned
 */
export async function spawnMatureTreesNear(
    page: Page,
    centerX: number,
    centerY: number,
    count: number,
    radius = 15
): Promise<number> {
    return page.evaluate(
        ({ cx, cy, n, r }) => {
            const game = window.__settlers__?.game;
            if (!game?.services?.treeSystem) return 0;
            const ts = game.services.treeSystem;
            // Plant trees (creates entities + registers as Growing)
            const planted = ts.plantTreesNear(cx, cy, n, r);
            // Force all Growing trees to Normal so they're immediately cuttable
            for (const [, state] of ts.getAllTreeStates()) {
                if (state.stage === 0 /* TreeStage.Growing */) {
                    state.stage = 1; /* TreeStage.Normal */
                    state.progress = 0;
                }
            }
            return planted;
        },
        { cx: centerX, cy: centerY, n: count, r: radius }
    );
}

// ── Tile search near position ────────────────────────────────────

/**
 * Find a buildable tile by spiraling from a given position (not map center).
 * Useful for placing multiple buildings within the same service area.
 */
export async function findBuildableTileNear(
    page: Page,
    buildingType: number,
    centerX: number,
    centerY: number
): Promise<{ x: number; y: number } | null> {
    return page.evaluate(
        ({ bt, cx, cy }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const search = window.__settlers__!.utils!.spiralSearch!;
            const w = game.terrain.mapSize.width;
            const h = game.terrain.mapSize.height;

            return search(cx, cy, w, h, (tx, ty) => {
                const result = game.execute({
                    type: 'place_building',
                    buildingType: bt,
                    x: tx,
                    y: ty,
                    player: 0,
                    race: 10,
                });
                if (result?.success) {
                    const entityId = (result.effects?.[0] as { entityId?: number })?.entityId;
                    if (entityId != null) {
                        game.execute({ type: 'remove_entity', entityId });
                    }
                    return true;
                }
                return false;
            });
        },
        { bt: buildingType, cx: centerX, cy: centerY }
    );
}

// ── Stone placement ──────────────────────────────────────────────

/**
 * Spawn multiple ResourceStone map objects near a center position.
 * Delegates to stoneSystem.spawnStonesNear() which uses findEmptySpot
 * for proper spacing — mirrors the plantTreesNear pattern.
 * @returns Number of stones successfully spawned.
 */
export async function plantStonesNear(
    page: Page,
    centerX: number,
    centerY: number,
    count: number,
    radius = 15
): Promise<number> {
    return page.evaluate(
        ({ cx, cy, n, r }) => {
            const game = window.__settlers__?.game;
            if (!game?.services?.stoneSystem) return 0;
            return game.services.stoneSystem.spawnStonesNear(cx, cy, n, r);
        },
        { cx: centerX, cy: centerY, n: count, r: radius }
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
            const vp = window.__settlers__?.viewpoint;
            if (vp?.setPosition) {
                vp.setPosition(x, y);
            }
        },
        { x: tileX, y: tileY }
    );
}
