/**
 * Composable for carrier debug info displayed in the selection panel.
 *
 * Extracts status and path progress data for a selected carrier unit.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import type { Game } from '@/game/game';
import { CARRIER_STATUS_NAMES, CARRIER_STATUS_CLASSES } from '@/composables/useLogisticsDebug';

export interface CarrierDebugInfo {
    status: string;
    statusClass: string;
    pathLength: number;
    pathProgress: number;
}

/**
 * Returns reactive carrier debug info for the given selected entity.
 */
export function useCarrierDebugInfo(
    game: Ref<Game | null>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): { carrierDebug: Ref<CarrierDebugInfo | null> } {
    const carrierDebug = computed<CarrierDebugInfo | null>(() => {
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Unit) return null;
        if (!game.value) return null;

        const carrier = game.value.services.carrierManager.getCarrier(entity.id);
        if (!carrier) return null;

        const movement = game.value.state.movement.getController(entity.id);
        const pathLength = movement?.path.length ?? 0;
        const pathProgress = movement?.pathIndex ?? 0;

        return {
            status: CARRIER_STATUS_NAMES[carrier.status],
            statusClass: CARRIER_STATUS_CLASSES[carrier.status],
            pathLength,
            pathProgress,
        };
    });

    return { carrierDebug };
}
