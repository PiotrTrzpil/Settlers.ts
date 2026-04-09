import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';
import { getBuildingInfo } from '@/game/data/game-data-access';
import { isGarrisonBuildingType } from './garrison-capacity';

/** Pixel offset and default direction for a garrison slot on a tower/castle. */
export interface GarrisonSlotPosition {
    /** Pixel offset X from building anchor */
    readonly offsetX: number;
    /** Pixel offset Y from building anchor */
    readonly offsetY: number;
    /** Default facing direction — sprite direction index (0-5) from XML */
    readonly direction: number;
}

/**
 * Returns the visual positions for garrison slots filtered by the `top` flag.
 * - `top === true`  → bowman positions (rendered above the building sprite)
 * - `top === false` → swordsman positions (rendered behind, visible through windows)
 *
 * Returns undefined for non-garrison buildings or when no matching slots exist.
 */
export function getGarrisonSlotPositions(
    buildingType: BuildingType,
    race: Race,
    top: boolean
): readonly GarrisonSlotPosition[] | undefined {
    if (!isGarrisonBuildingType(buildingType)) {
        return undefined;
    }

    const info = getBuildingInfo(race, buildingType);
    if (!info || info.settlers.length === 0) {
        return undefined;
    }

    const slots: GarrisonSlotPosition[] = [];
    for (const s of info.settlers) {
        if (s.top === top) {
            slots.push({ offsetX: s.xOffset, offsetY: s.yOffset, direction: s.direction });
        }
    }

    return slots.length > 0 ? slots : undefined;
}
