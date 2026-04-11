/**
 * Executor context factory — constructs all 4 choreo executor context objects from shared deps.
 *
 * Extracted from WorkerTaskExecutor to make context dependencies explicit and keep the
 * executor's constructor focused on wiring rather than object construction.
 */

import type { GameState } from '../../../game-state';
import type { EventBus } from '../../../event-bus';
import type { BuildingInventoryManager } from '../../inventory';
import type { MaterialTransfer } from '../../material-transfer';
import type { ConstructionSiteManager } from '../../building-construction/construction-site-manager';
import type { ExecuteCommand } from '../../../commands';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type {
    MovementContext,
    WorkContext,
    InventoryExecutorContext,
    ControlContext,
    BuildingPositionResolver,
    TriggerSystem,
    JobPartResolver,
} from '../choreo-types';
import type { ISettlerBuildingLocationManager } from '../../settler-location';

/** All dependencies needed to build the 4 executor context objects. */
export interface ExecutorContextDeps {
    gameState: GameState;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
    materialTransfer: MaterialTransfer;
    constructionSiteManager: ConstructionSiteManager;
    buildingPositionResolver: BuildingPositionResolver;
    jobPartResolver: JobPartResolver;
    triggerSystem: TriggerSystem;
    locationManager: ISettlerBuildingLocationManager;
    handlerErrorLogger: ThrottledLogger;
    executeCommand?: ExecuteCommand;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
}

/** The 4 pre-built context objects for choreo executor categories. */
export interface ExecutorContexts {
    movement: MovementContext;
    work: WorkContext;
    inventory: InventoryExecutorContext;
    control: ControlContext;
}

/**
 * Build all executor category contexts from shared deps.
 *
 * The returned contexts are stable objects — handler fields (entityHandler, positionHandler)
 * are mutated in-place each tick by WorkerTaskExecutor with no allocation.
 *
 * Called once in WorkerTaskExecutor constructor.
 */
export function buildExecutorContexts(deps: ExecutorContextDeps): ExecutorContexts {
    const movement: MovementContext = {
        gameState: deps.gameState,
        buildingPositionResolver: deps.buildingPositionResolver,
        getWorkerHomeBuilding: deps.getWorkerHomeBuilding,
        handlerErrorLogger: deps.handlerErrorLogger,
        entityHandler: undefined,
        positionHandler: undefined,
    };

    const work: WorkContext = {
        gameState: deps.gameState,
        triggerSystem: deps.triggerSystem,
        getWorkerHomeBuilding: deps.getWorkerHomeBuilding,
        handlerErrorLogger: deps.handlerErrorLogger,
        entityHandler: undefined,
        positionHandler: undefined,
    };

    const inventory: InventoryExecutorContext = {
        inventoryManager: deps.inventoryManager,
        getWorkerHomeBuilding: deps.getWorkerHomeBuilding,
        materialTransfer: deps.materialTransfer,
        eventBus: deps.eventBus,
        constructionSiteManager: deps.constructionSiteManager,
    };

    const control: ControlContext = {
        gameState: deps.gameState,
        eventBus: deps.eventBus,
        handlerErrorLogger: deps.handlerErrorLogger,
        executeCommand: deps.executeCommand,
        inventoryManager: deps.inventoryManager,
    };

    return { movement, work, inventory, control };
}
