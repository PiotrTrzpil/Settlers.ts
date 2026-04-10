/** Game mode settings — persisted to localStorage, shared between UI and game initialization. */

import { MapStartResources } from '@/resources/map/map-start-resources';
import type { IMapLoader } from '@/resources/map/imap-loader';
import { MapGameType } from '@/resources/map/map-game-type';

const START_RESOURCES_KEY = 'game_mode_start_resources';

/** Read the player-selected start resources level (defaults to medium). */
export function readStartResources(): MapStartResources {
    try {
        const stored = localStorage.getItem(START_RESOURCES_KEY);
        if (stored != null) {
            const value = Number(stored);
            if (value >= MapStartResources.low && value <= MapStartResources.high) {
                return value;
            }
        }
    } catch {
        // localStorage not available
    }
    return MapStartResources.medium;
}

/** Persist the selected start resources level. */
export function saveStartResources(value: MapStartResources): void {
    try {
        localStorage.setItem(START_RESOURCES_KEY, String(value));
    } catch {
        // localStorage not available
    }
}

/**
 * Check if a map needs start resources applied.
 *
 * Multiplayer and coop maps have no settlers/buildings in the map data — the
 * StartResources.txt script spawns them at game start. Campaign/singleplayer
 * maps already have everything baked into the map file.
 */
export function mapNeedsStartResources(mapLoader: IMapLoader): boolean {
    const gameType = mapLoader.general.gameType;
    if (gameType === MapGameType.singlePlayer) {
        return false;
    }
    // Multiplayer/coop maps need start resources if they have player start positions
    // eslint-disable-next-line no-restricted-syntax -- entityData is optional on IMapLoader (map file may lack entity chunks)
    const players = mapLoader.entityData?.players ?? [];
    return players.some(p => p.startX != null && p.startY != null);
}
