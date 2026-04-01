/**
 * Settler task system configuration interface and debug helpers.
 *
 * Extracted from settler-task-system.ts to keep it under the line limit.
 */

import type { CoreDeps } from '../feature';
import type { BuildingInventoryManager, BuildingPileRegistry } from '../inventory';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import type { BuildingOverlayManager } from '../building-overlays/building-overlay-manager';
import type { ProductionControlManager } from '../production-control';
import type { BarracksTrainingManager } from '../barracks';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { ExecuteCommand } from '../../commands';
import type { MaterialTransfer } from '../material-transfer';
import type { ChoreoSystem } from '../../systems/choreo';
import type { ISettlerBuildingLocationManager } from '../settler-location/types';
import type { TickScheduler } from '../../systems/tick-scheduler';
import type { UnitRuntime } from './unit-state-machine';
import type { EMaterialType } from '../../economy';

export interface SettlerTaskSystemConfig extends CoreDeps {
    tickScheduler: TickScheduler;
    choreoSystem: ChoreoSystem;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    getPileRegistry: () => BuildingPileRegistry | null;
    workAreaStore: WorkAreaStore;
    buildingOverlayManager: BuildingOverlayManager;
    getProductionControlManager?: () => ProductionControlManager;
    getBarracksTrainingManager?: () => BarracksTrainingManager;
    constructionSiteManager: ConstructionSiteManager;
    executeCommand: ExecuteCommand;
    materialTransfer: MaterialTransfer;
    isInCombat?: (entityId: number) => boolean;
    locationManager: ISettlerBuildingLocationManager;
}

export interface SettlerDebugEntry {
    entityId: number;
    state: string;
    jobId: string | null;
    jobType: string | null;
    taskIndex: number | null;
    progress: number | null;
    targetId: number | null;
    carryingGood: EMaterialType | null;
    assignedBuilding: number | null;
}

export function buildDebugEntry(entityId: number, runtime: UnitRuntime): SettlerDebugEntry {
    const job = runtime.job;
    return {
        entityId,
        state: runtime.state,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        jobId: job?.jobId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        jobType: job?.type ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        taskIndex: job?.nodeIndex ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        progress: job?.progress ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        targetId: job?.targetId ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        carryingGood: job?.carryingGood ?? null,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
    };
}
