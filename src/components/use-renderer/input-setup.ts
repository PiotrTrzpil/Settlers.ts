/**
 * Input mode setup — creates specialized input modes and handles mode changes.
 */

import { ref, type Ref } from 'vue';
import type { Game } from '@/game/game';
import { BuildingType, UnitType } from '@/game/entity';
import type { BuildingAdjustHandler } from '@/game/input/building-adjust/types';
import { BuildingAdjustMode } from '@/game/input';
import { WorkAreaAdjustHandler } from '@/game/input/building-adjust';
import { debugStats } from '@/game/debug/debug-stats';

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
 * Registers all adjust handlers: work areas.
 */
export function createBuildingAdjustMode(getGame: () => Game | null): BuildingAdjustMode {
    let handlers: readonly BuildingAdjustHandler[] | null = null;

    return new BuildingAdjustMode(() => {
        const game = getGame();
        if (!game) {
            return null;
        }

        if (!handlers) {
            handlers = [new WorkAreaAdjustHandler(game.services.workAreaStore)];
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
        if (!game) {
            return;
        }

        const vs = game.viewState.state;
        vs.mode = newMode;

        // Update building type
        vs.placeBuildingType =
            newMode === 'place_building' && data?.['buildingType'] !== undefined
                ? (data['buildingType'] as BuildingType)
                : null;

        // Update resource type
        vs.placePileType =
            newMode === 'place_pile' && data?.['resourceType'] !== undefined ? (data['resourceType'] as string) : '';

        // Update unit type
        vs.placeUnitType =
            newMode === 'place_unit' && data?.['unitType'] !== undefined ? (data['unitType'] as UnitType) : '';

        // Sync with game for backward compatibility
        game.mode = newMode;
        game.placeBuildingType = vs.placeBuildingType;
    };
}

/**
 * Create a reactive hint message state and a provider function for the InputManager.
 * Shows a transient message near the cursor (e.g. "No garrison slot available") for 2.5 s.
 */
export interface HintMessage {
    text: string;
    x: number;
    y: number;
}

export interface HintState {
    hintMessage: Ref<HintMessage | null>;
    hintProvider: (msg: string, sx: number, sy: number) => void;
}

export function createHintState(): HintState {
    const hintMessage = ref<HintMessage | null>(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    function hintProvider(msg: string, sx: number, sy: number): void {
        if (timer !== null) {
            clearTimeout(timer);
        }
        hintMessage.value = { text: msg, x: sx, y: sy };
        timer = setTimeout(() => {
            hintMessage.value = null;
            timer = null;
        }, 2500);
    }
    return { hintMessage, hintProvider };
}
