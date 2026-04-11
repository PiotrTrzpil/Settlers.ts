/**
 * Composable for the SP (Specialists) panel.
 *
 * Returns reactive specialist entries for all specialist types available
 * to the current race. Each entry includes live count, queued count
 * (waiting for a carrier in SpecialistRecruitQueue), and pending count
 * (carrier currently walking to a tool pile).
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { Game } from '@/game/game';
import { EntityType } from '@/game/entity';
import { type UnitType } from '@/game/core/unit-types';
import { type EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';
import { isUnitAvailableForRace } from '@/game/data/race-availability';
import { ALL_SPECIALISTS } from '@/views/palette-data';

export interface SpecialistEntry {
    type: UnitType;
    id: string;
    name: string;
    icon: string;
    toolMaterial: EMaterialType | null;
    liveCount: number;
    queuedCount: number;
    pendingCount: number;
}

/**
 * Returns a computed array of specialist entries for the given race.
 *
 * @param game - Ref to the current Game instance (may be null before load)
 * @param tick - Ref to the game tick counter; touching this ensures re-evaluation each frame
 * @param race - Ref to the current player's race, used for race filtering
 */
export function useSpecialists(
    game: Ref<Game | null>,
    tick: Ref<number>,
    race: Ref<Race>
): ComputedRef<SpecialistEntry[]> {
    return computed<SpecialistEntry[]>(() => {
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const g = game.value;
        if (!g) {
            return [];
        }

        const currentPlayer = g.currentPlayer;
        const entries: SpecialistEntry[] = [];

        for (const def of ALL_SPECIALISTS) {
            if (!isUnitAvailableForRace(def.type, race.value)) {
                continue;
            }

            const liveCount = g.state.entityIndex.query(EntityType.Unit, currentPlayer, def.type).count();

            const queuedCount = g.services.recruitSystem.getQueuedCount(def.type);
            const pendingCount = g.services.unitTransformer.getPendingCountByType(def.type);

            entries.push({
                type: def.type,
                id: def.id,
                name: def.name,
                icon: def.icon,
                toolMaterial: def.toolMaterial,
                liveCount,
                queuedCount,
                pendingCount,
            });
        }

        return entries;
    });
}
