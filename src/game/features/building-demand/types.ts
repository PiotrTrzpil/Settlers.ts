/**
 * BuildingDemand types — shared contract for building worker demand tracking.
 */

import type { UnitType } from '../../core/unit-types';
import type { EMaterialType } from '../../economy/material-type';
import type { Race } from '../../core/race';

export interface BuildingDemand {
    buildingId: number;
    unitType: UnitType;
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    /** The unit running this building's WorkplaceDispatch job; null = none (yet / again). */
    committedUnitId: number | null;
}
