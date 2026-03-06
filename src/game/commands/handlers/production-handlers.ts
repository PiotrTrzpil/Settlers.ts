import type { ProductionControlManager } from '../../features/production-control';
import type {
    SetProductionModeCommand,
    SetRecipeProportionCommand,
    AddToProductionQueueCommand,
    RemoveFromProductionQueueCommand,
    CommandResult,
} from '../command-types';
import { commandFailed } from '../command-types';

export interface ProductionDeps {
    productionControlManager: ProductionControlManager;
}

export function executeSetProductionMode(deps: ProductionDeps, cmd: SetProductionModeCommand): CommandResult {
    const state = deps.productionControlManager.getProductionState(cmd.buildingId);
    if (!state) {
        return commandFailed(`Building ${cmd.buildingId} has no production control state`);
    }
    deps.productionControlManager.setMode(cmd.buildingId, cmd.mode);
    return { success: true };
}

export function executeSetRecipeProportion(deps: ProductionDeps, cmd: SetRecipeProportionCommand): CommandResult {
    deps.productionControlManager.setProportion(cmd.buildingId, cmd.recipeIndex, cmd.weight);
    return { success: true };
}

export function executeAddToProductionQueue(deps: ProductionDeps, cmd: AddToProductionQueueCommand): CommandResult {
    deps.productionControlManager.addToQueue(cmd.buildingId, cmd.recipeIndex);
    return { success: true };
}

export function executeRemoveFromProductionQueue(
    deps: ProductionDeps,
    cmd: RemoveFromProductionQueueCommand
): CommandResult {
    deps.productionControlManager.removeFromQueue(cmd.buildingId, cmd.recipeIndex);
    return { success: true };
}
