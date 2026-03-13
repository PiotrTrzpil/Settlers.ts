/**
 * Work Area Types
 *
 * Helpers for the work area system.
 * Work areas define where a building's worker operates.
 * Whether a building has a work area is derived from XML data (workingAreaRadius > 0).
 */

import type { BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import { getBuildingInfo, hasBuildingXmlMapping } from '../../data/game-data-access';

/**
 * Check if a building type has a work area for the given race.
 * Derived from XML buildingInfo: a building has a work area when workingAreaRadius > 0.
 */
export function hasWorkArea(buildingType: BuildingType, race: Race): boolean {
    if (!hasBuildingXmlMapping(buildingType)) {
        return false;
    }
    const info = getBuildingInfo(race, buildingType);
    return info !== undefined && info.workingAreaRadius > 0;
}
