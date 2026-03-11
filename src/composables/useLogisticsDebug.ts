/**
 * Composable for gathering logistics debug data.
 *
 * Thin Vue wrapper around the shared logistics-snapshot module.
 * Updated on a 500ms interval.
 */

import { ref, onUnmounted, type Ref } from 'vue';
import type { Game } from '@/game/game';
import {
    type SnapshotConfig,
    type LogisticsDebugState,
    gatherLogisticsSnapshot,
    createEmptyState,
} from '@/game/features/logistics/logistics-snapshot';

// Re-export types so existing consumers don't break
export type {
    DemandSummary,
    CarrierSummary,
    LogisticsStats,
    LogisticsDebugState,
} from '@/game/features/logistics/logistics-snapshot';

function buildSnapshotConfig(game: Game): SnapshotConfig {
    const svc = game.services;
    return {
        gameState: game.state,
        demandQueue: svc.demandQueue,
        carrierRegistry: svc.carrierRegistry,
        logisticsDispatcher: svc.logisticsDispatcher,
        settlerTaskSystem: svc.settlerTaskSystem,
        inventoryManager: svc.inventoryManager,
        unitReservation: svc.unitReservation,
        constructionSiteManager: svc.constructionSiteManager,
    };
}

/**
 * Composable for gathering logistics debug data, filtered by player.
 *
 * @param getGame Function to retrieve the current Game instance
 * @param getPlayer Function to retrieve the current player to filter by
 * @returns Reactive state with logistics debug data
 */
export function useLogisticsDebug(
    getGame: () => Game | null,
    getPlayer: () => number
): {
    state: Ref<LogisticsDebugState>;
    refresh: () => void;
} {
    const state = ref<LogisticsDebugState>(createEmptyState());

    function refresh(): void {
        const game = getGame();
        if (!game) {
            state.value = createEmptyState();
            return;
        }

        const config = buildSnapshotConfig(game);
        state.value = gatherLogisticsSnapshot(config, getPlayer());
    }

    // Initial refresh
    refresh();

    // Set up interval
    const intervalId = setInterval(refresh, 500);

    onUnmounted(() => {
        clearInterval(intervalId);
    });

    return { state, refresh };
}
