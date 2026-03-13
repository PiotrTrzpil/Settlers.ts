/**
 * Shared types and game-state query helpers for e2e tests.
 *
 * Extracted from game-actions.ts to keep that file under the 600-line limit.
 */
import type { Page } from '@playwright/test';
import type { BuildingType } from '@/game/buildings/building-type';

// ── Return types ────────────────────────────────────────────────

export interface GameState {
    mode: string;
    placeBuildingType: BuildingType | null;
    entityCount: number;
    entities: EntityInfo[];
    mapWidth: number;
    mapHeight: number;
}

export interface EntityInfo {
    id: number;
    type: number;
    subType: number | string;
    x: number;
    y: number;
    player: number;
}

export interface BuildingResult {
    id: number;
    type: number;
    subType: number | string;
    x: number;
    y: number;
    player: number;
}

export interface ResourceResult {
    id: number;
    type: number;
    subType: number | string;
    x: number;
    y: number;
    amount: number;
}

export interface UnitResult {
    id: number;
    type: number;
    subType: number | string;
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
    previewMaterialType: number | string | null;
    placementPreview: { entityType: string; subType: number | string } | null;
}

export interface BatchPlacementResult {
    placedCount: number;
    positions: Array<{ x: number; y: number }>;
    totalEntities: number;
}

export interface EntityFilter {
    type?: number;
    subType?: number | string;
    player?: number;
}

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

// ── Game state reads ────────────────────────────────────────────

/** Read structured game state including entities and map size. */
export async function getGameState(page: Page): Promise<GameState | null> {
    return page.evaluate<GameState | null>(() => {
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
            previewBuildingType: preview?.entityType === 'building' ? (preview.subType as number) : null,
            previewMaterialType: preview?.entityType === 'pile' ? preview.subType : null,
            placementPreview: preview,
        };
    });
}

/**
 * Read a building's inventory state (input/output slots with amounts).
 * @returns Inventory info, or null if building has no inventory
 */
export async function getBuildingInventory(page: Page, buildingId: number): Promise<BuildingInventoryInfo | null> {
    return page.evaluate(id => {
        const game = window.__settlers__?.game;
        if (!game?.services?.inventoryManager) return null;
        if (!game.services.inventoryManager.hasSlots(id)) return null;
        const slots: any[] = game.services.inventoryManager.getSlots(id) as any[];
        const mapSlot = (s: any) => ({
            materialType: s.materialType,
            currentAmount: s.currentAmount,
            maxCapacity: s.maxCapacity,
            reservedAmount: s.reservedAmount ?? 0,
        });
        return {
            buildingId: id,
            inputSlots: slots.filter((s: any) => s.kind === 'input').map(mapSlot),
            outputSlots: slots.filter((s: any) => s.kind === 'output' || s.kind === 'storage').map(mapSlot),
        };
    }, buildingId);
}
