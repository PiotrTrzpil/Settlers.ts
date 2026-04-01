/**
 * Game action and query helpers for e2e tests.
 *
 * Standalone functions that operate on a Playwright Page via `page.evaluate()`.
 * GamePage delegates to these; tests can also import them directly.
 */
import type { Page } from '@playwright/test';
import type { BuildingResult, ResourceResult, UnitResult, BatchPlacementResult } from './game-action-types';
import type { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';

// Re-export all types and query functions so existing imports keep working
export type {
    GameState,
    EntityInfo,
    BuildingResult,
    ResourceResult,
    UnitResult,
    TerrainInfo,
    PlacementPreview,
    BatchPlacementResult,
    EntityFilter,
    InventorySlotInfo,
    BuildingInventoryInfo,
} from './game-action-types';

export {
    getGameState,
    getEntities,
    getMapCenter,
    isTerrainPassable,
    getPlacementPreview,
    getBuildingInventory,
} from './game-action-types';

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
    buildingType: BuildingType,
    x: number,
    y: number,
    player = 0,
    options?: { completed?: boolean }
): Promise<BuildingResult | null> {
    return page.evaluate(
        ({ bt, posX, posY, p, completed }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const cmdResult = game.execute({
                type: 'place_building',
                buildingType: bt,
                x: posX,
                y: posY,
                player: p,
                race: 10,
                ...(completed && { completed: true }),
            });
            if (!cmdResult?.success) return null;
            const entityId = 'entityId' in cmdResult ? cmdResult.entityId : undefined;
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
        { bt: buildingType, posX: x, posY: y, p: player, completed: options?.completed ?? false }
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
                type: 'place_pile',
                materialType: mt as any,
                x: posX,
                y: posY,
                amount: amt,
            });
            if (!cmdResult?.success) return null;
            const entityId = 'entityId' in cmdResult ? cmdResult.entityId : undefined;
            if (entityId == null) return null;
            const entity = game.state.getEntity(entityId);
            if (!entity) return null;
            const slot = game.services?.inventoryManager?.getSlotByEntityId(entityId);
            window.__settlers__?.viewState?.forceCountUpdate();
            return {
                id: entity.id,
                type: entity.type,
                subType: entity.subType,
                x: entity.x,
                y: entity.y,
                amount: slot?.currentAmount ?? amt,
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
    unitType: string = 'Carrier',
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
                unitType: ut as UnitType,
                x: spawnX,
                y: spawnY,
                player: p,
                race: 10,
            });
            if (!cmdResult?.success) return null;
            const entityId = 'entityId' in cmdResult ? cmdResult.entityId : undefined;
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
export async function findBuildableTile(
    page: Page,
    buildingType: BuildingType = BuildingType.WoodcutterHut
): Promise<{ x: number; y: number } | null> {
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
                const entityId = 'entityId' in result ? result.entityId : undefined;
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
            const isOccupied = game.state.groundOccupancy?.has(key);
            return isPassable && !isOccupied;
        });
    });
}

// ── Batch placement ─────────────────────────────────────────────

export type PlacementSpec =
    | { kind: 'building'; buildingTypes?: BuildingType[]; players?: number[] }
    | { kind: 'pile'; materialTypes?: number[] };

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

            const executePlacement = (tx: number, ty: number, idx: number) => {
                if (s.kind === 'building') {
                    const bt = s.buildingTypes
                        ? s.buildingTypes[idx % s.buildingTypes.length]!
                        : ('WoodcutterHut' as BuildingType);
                    const p = s.players ? s.players[idx % s.players.length]! : 0;
                    return game.execute({
                        type: 'place_building',
                        buildingType: bt,
                        x: tx,
                        y: ty,
                        player: p,
                        race: 10,
                    });
                }
                const mt = s.materialTypes ? s.materialTypes[idx % s.materialTypes.length]! : idx % 3;
                return game.execute({
                    type: 'place_pile',
                    materialType: mt as any,
                    amount: idx + 1,
                    x: tx,
                    y: ty,
                });
            };

            for (let r = 0; r < Math.max(w, h) / 2 && placed < targetCount; r += 2) {
                for (let angle = 0; angle < 8 && placed < targetCount; angle++) {
                    const dx = Math.round(r * Math.cos((angle * Math.PI) / 4));
                    const dy = Math.round(r * Math.sin((angle * Math.PI) / 4));
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                    const result = executePlacement(tx, ty, placed);
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
            return 'entityId' in result ? result.entityId : null;
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
    buildingType: BuildingType,
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
                    const entityId = 'entityId' in result ? result.entityId : undefined;
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
