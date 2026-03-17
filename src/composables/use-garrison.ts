/**
 * Composable for garrison state in the building selection panel.
 *
 * Returns reactive garrison info for the selected building, or null
 * if the building has no garrison capacity (not a garrison building).
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { Game } from '@/game/game';
import { EntityType, BuildingType } from '@/game/entity';
import { UnitType, getUnitLevel } from '@/game/core/unit-types';
import { getGarrisonCapacity } from '@/game/features/tower-garrison/internal/garrison-capacity';

export interface GarrisonSlotInfo {
    max: number;
    units: Array<{ unitId: number; level: number; unitType: UnitType }>;
}

export interface GarrisonInfo {
    swordsmanSlots: GarrisonSlotInfo;
    bowmanSlots: GarrisonSlotInfo;
    /**
     * False when this unit is the last soldier in the building (total garrisoned == 1).
     * The last soldier cannot be removed regardless of type.
     */
    canEject: (unitId: number) => boolean;
}

/**
 * Returns reactive garrison info for the currently selected building.
 *
 * @param game - Computed ref to the current Game instance (may be null)
 * @param buildingId - Computed ref to the selected building entity ID (may be null)
 * @param tick - Ref to the game tick counter, used to trigger re-evaluation each frame
 */
export function useGarrison(
    game: ComputedRef<Game | null>,
    buildingId: ComputedRef<number | null>,
    tick: Ref<number>
): ComputedRef<GarrisonInfo | null> {
    return computed<GarrisonInfo | null>(() => {
        // eslint-disable-next-line sonarjs/void-use -- intentionally touch reactive tick to trigger re-evaluation
        void tick.value;

        const g = game.value;
        const id = buildingId.value;
        if (!g || id === null) {
            return null;
        }

        const entity = g.state.getEntity(id);
        if (!entity || entity.type !== EntityType.Building) {
            return null;
        }

        const capacity = getGarrisonCapacity(entity.subType as BuildingType);
        if (!capacity) {
            return null;
        }

        const garrison = g.services.garrisonManager.getGarrison(id);
        if (!garrison) {
            return null;
        }

        const swordsmanUnits = garrison.swordsmanSlots.unitIds.map(unitId => {
            const unitType = g.state.getEntityOrThrow(unitId, 'useGarrison:swordsman').subType as UnitType;
            return { unitId, level: getUnitLevel(unitType), unitType };
        });

        const bowmanUnits = garrison.bowmanSlots.unitIds.map(unitId => {
            const unitType = g.state.getEntityOrThrow(unitId, 'useGarrison:bowman').subType as UnitType;
            return { unitId, level: getUnitLevel(unitType), unitType };
        });

        const totalGarrisoned = swordsmanUnits.length + bowmanUnits.length;

        return {
            swordsmanSlots: { max: garrison.swordsmanSlots.max, units: swordsmanUnits },
            bowmanSlots: { max: garrison.bowmanSlots.max, units: bowmanUnits },
            canEject: (_unitId: number) => totalGarrisoned !== 1,
        };
    });
}
