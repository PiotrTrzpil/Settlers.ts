/**
 * Input mode setup — creates specialized input modes and handles mode changes.
 */

import type { Game } from '@/game/game';
import { BuildingAdjustMode } from '@/game/input';
import { StackPositions } from '@/game/features/inventory/stack-positions';
import {
    EntranceAdjustHandler,
    SpriteLayerAdjustHandler,
    StackAdjustHandler,
    WorkAreaAdjustHandler,
} from '@/game/features/building-adjust';
import { debugStats } from '@/game/debug-stats';

/**
 * Update debug stats with tile information during pointer move.
 * Shared by all placement modes.
 */
export function updateTileDebugStats(
    tileX: number,
    tileY: number,
    getGame: () => Game | null,
    onTileClick: (tile: { x: number; y: number }) => void
): void {
    onTileClick({ x: tileX, y: tileY });
    debugStats.state.hasTile = true;
    debugStats.state.tileX = tileX;
    debugStats.state.tileY = tileY;

    const game = getGame();
    if (game) {
        const idx = game.terrain.toIndex(tileX, tileY);
        debugStats.state.tileGroundType = game.terrain.groundType[idx]!;
        debugStats.state.tileGroundHeight = game.terrain.groundHeight[idx]!;
    }
}

/**
 * Create BuildingAdjustMode with lazy game dependency resolution.
 * Registers all three adjust handlers: entrance, sprite layers, and stacks.
 */
export function createBuildingAdjustMode(getGame: () => Game | null): BuildingAdjustMode {
    const stackPositions = new StackPositions();
    let handlers: readonly import('@/game/features/building-adjust/types').BuildingAdjustHandler[] | null = null;
    let connected = false;

    return new BuildingAdjustMode(() => {
        const game = getGame();
        if (!game) return null;

        if (!connected) {
            game.services.inventoryVisualizer.setStackPositions(stackPositions);
            connected = true;
        }

        if (!handlers) {
            handlers = [
                new EntranceAdjustHandler(),
                new SpriteLayerAdjustHandler(game.services.overlayRegistry),
                new StackAdjustHandler(stackPositions, game.services.inventoryVisualizer),
                new WorkAreaAdjustHandler(game.services.workAreaStore),
            ];
        }

        return {
            gameState: game.state,
            handlers,
        };
    });
}

/** Handle mode changes and update game view state */
export function handleModeChange(
    getGame: () => Game | null
): (oldMode: string, newMode: string, data?: Record<string, unknown>) => void {
    return (_oldMode, newMode, data) => {
        const game = getGame();
        if (!game) return;

        const vs = game.viewState.state;
        vs.mode = newMode;

        // Update building type
        vs.placeBuildingType =
            newMode === 'place_building' && data?.['buildingType'] !== undefined ? (data['buildingType'] as number) : 0;

        // Update resource type
        vs.placeResourceType =
            newMode === 'place_resource' && data?.['resourceType'] !== undefined ? (data['resourceType'] as number) : 0;

        // Update unit type and level
        const isUnitMode = newMode === 'place_unit';
        vs.placeUnitType = isUnitMode && data?.['unitType'] !== undefined ? (data['unitType'] as number) : 0;
        vs.placeUnitLevel = isUnitMode && data?.['level'] !== undefined ? (data['level'] as number) : 1;

        // Sync with game for backward compatibility
        game.mode = newMode;
        game.placeBuildingType = vs.placeBuildingType;
    };
}
