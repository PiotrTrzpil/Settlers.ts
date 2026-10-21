/**
 * Construction dependencies of SettlerTaskSystem (services from other features).
 */

import type { CoreDeps } from '../feature';
import type { BuildingInventoryManager } from '../inventory';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import type { TriggerSystem } from '../building-overlays';
import type { MaterialTransfer } from '../material-transfer';
import type { ChoreoSystem } from '../../systems/choreo';
import type { ISettlerBuildingLocationManager } from '../settler-location';
import type { TickScheduler } from '../../systems/tick-scheduler';
import type { TerritoryConnectivityCheck } from './worker-assignments';

export interface SettlerTaskSystemConfig extends CoreDeps {
    tickScheduler: TickScheduler;
    choreoSystem: ChoreoSystem;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    workAreaStore: WorkAreaStore;
    triggerSystem: TriggerSystem;
    materialTransfer: MaterialTransfer;
    isInCombat: (entityId: number) => boolean;
    locationManager: ISettlerBuildingLocationManager;
    /** Rejects worker↔building pairs in disconnected territory pockets. */
    territoryCheck: TerritoryConnectivityCheck;
}
