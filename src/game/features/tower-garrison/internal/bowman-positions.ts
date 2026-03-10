import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';
import { getBuildingInfo } from '@/game/data/game-data-access';
import { isGarrisonBuildingType } from './garrison-capacity';

/** Pixel offset and default direction for a bowman slot on a tower/castle. */
export interface BowmanSlotPosition {
    /** Pixel offset X from building anchor */
    readonly offsetX: number;
    /** Pixel offset Y from building anchor */
    readonly offsetY: number;
    /** Default facing direction (0-7) from XML */
    readonly direction: number;
}

/**
 * Returns the visual positions for bowman slots on this building type + race.
 * Extracts positions where `top === true` from XML settler data (bowmen render on top).
 * Returns undefined for non-garrison buildings.
 */
export function getBowmanSlotPositions(
    buildingType: BuildingType,
    race: Race
): readonly BowmanSlotPosition[] | undefined {
    if (!isGarrisonBuildingType(buildingType)) return undefined;

    const info = getBuildingInfo(race, buildingType);
    if (!info || info.settlers.length === 0) return undefined;

    const topSlots: BowmanSlotPosition[] = [];
    for (const s of info.settlers) {
        if (s.top) {
            topSlots.push({ offsetX: s.xOffset, offsetY: s.yOffset, direction: s.direction });
        }
    }

    return topSlots.length > 0 ? topSlots : undefined;
}
