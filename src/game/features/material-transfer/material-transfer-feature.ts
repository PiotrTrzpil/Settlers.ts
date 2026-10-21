/**
 * MaterialTransfer Feature — wraps MaterialTransfer as a self-registering feature.
 *
 * Owns worker goods handling in choreographies: registers the GET_GOOD / PUT_GOOD /
 * RESOURCE_GATHERING / LOAD_GOOD executors on the kernel ChoreoSystem.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import { MaterialTransfer } from './material-transfer';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import { registerGoodsExecutors } from './internal/goods-executors';

export interface MaterialTransferExports {
    materialTransfer: MaterialTransfer;
}

export const MaterialTransferFeature: FeatureDefinition = {
    id: 'material-transfer',
    dependencies: ['inventory'],

    create(ctx: FeatureContext) {
        const { inventoryManager } = ctx.getFeature<InventoryExports>('inventory');

        const materialTransfer = new MaterialTransfer(
            ctx.gameState,
            inventoryManager,
            ctx.executeCommand,
            ctx.eventBus
        );

        ctx.cleanupRegistry.onEntityRemoved(
            materialTransfer.onEntityRemoved.bind(materialTransfer),
            CLEANUP_PRIORITY.EARLY
        );

        registerGoodsExecutors(ctx.choreoSystem, { materialTransfer, inventoryManager });

        return {
            exports: { materialTransfer } satisfies MaterialTransferExports,
            persistence: 'none',
        };
    },
};
