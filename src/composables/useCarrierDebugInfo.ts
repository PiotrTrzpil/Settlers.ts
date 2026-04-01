/**
 * Composable for carrier debug info displayed in the selection panel.
 *
 * Extracts status and path progress data for a selected carrier unit.
 */

import { computed, type Ref } from 'vue';
import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import type { Game } from '@/game/game';

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
    game: Ref<Game>,
    selectedEntity: Ref<Entity | undefined>,
    tick: Ref<number>
): { carrierDebug: Ref<CarrierDebugInfo | null> } {
    const carrierDebug = computed<CarrierDebugInfo | null>(() => {
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;
        const entity = selectedEntity.value;
        if (!entity || entity.type !== EntityType.Unit) {
            return null;
        }

        if (!game.value.services.carrierRegistry.has(entity.id)) {
            return null;
        }

        const movement = game.value.state.movement.getController(entity.id);
        // eslint-disable-next-line no-restricted-syntax -- movement controller is absent for idle/unmoving carriers; 0 is correct display default
        const pathLength = movement?.path.length ?? 0;
        // eslint-disable-next-line no-restricted-syntax -- movement controller is absent for idle/unmoving carriers; 0 is correct display default
        const pathProgress = movement?.pathIndex ?? 0;

        const activeJobId = game.value.services.settlerTaskSystem.getActiveJobId(entity.id);
        const hasJob = activeJobId !== null;

        return {
            status: hasJob ? 'Busy' : 'Idle',
            statusClass: hasJob ? 'busy' : 'idle',
            pathLength,
            pathProgress,
        };
    });

    return { carrierDebug };
}
