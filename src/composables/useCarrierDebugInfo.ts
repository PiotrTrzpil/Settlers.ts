/**
 * Composable for carrier debug info displayed in the selection panel.
 *
 * Extracts fatigue, status, path progress and home building data for a selected carrier unit.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { getFatigueLevel } from '@/game/features/carriers/carrier-state';
import type { Game } from '@/game/game';
import {
    CARRIER_STATUS_NAMES,
    CARRIER_STATUS_CLASSES,
    FATIGUE_LEVEL_NAMES,
    FATIGUE_LEVEL_CLASSES,
} from '@/composables/useLogisticsDebug';

export interface CarrierDebugInfo {
    status: string;
    statusClass: string;
    fatigue: number;
    fatigueLevel: string;
    fatigueClass: string;
    homeBuilding: number;
    pathLength: number;
    pathProgress: number;
}

/**
 * Returns reactive carrier debug info for the given selected entity.
 *
 * @param game - Ref to the current Game instance (may be null)
 * @param selectedEntity - Ref to the currently selected entity (may be undefined)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useCarrierDebugInfo(
    game: Ref<Game | null>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): { carrierDebug: Ref<CarrierDebugInfo | null> } {
    const carrierDebug = computed<CarrierDebugInfo | null>(() => {
        // Touch tick to re-evaluate every frame (carrier state changes frequently)
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Unit) return null;
        if (!game.value) return null;

        const carrier = game.value.services.carrierManager.getCarrier(entity.id);
        if (!carrier) return null;
        const fatigueLevel = getFatigueLevel(carrier.fatigue);

        const movement = game.value.state.movement.getController(entity.id);
        const pathLength = movement?.path.length ?? 0;
        const pathProgress = movement?.pathIndex ?? 0;

        return {
            status: CARRIER_STATUS_NAMES[carrier.status],
            statusClass: CARRIER_STATUS_CLASSES[carrier.status],
            fatigue: Math.round(carrier.fatigue),
            fatigueLevel: FATIGUE_LEVEL_NAMES[fatigueLevel],
            fatigueClass: FATIGUE_LEVEL_CLASSES[fatigueLevel],
            homeBuilding: carrier.homeBuilding,
            pathLength,
            pathProgress,
        };
    });

    return { carrierDebug };
}
