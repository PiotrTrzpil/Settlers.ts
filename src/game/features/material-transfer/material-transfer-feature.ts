/**
 * MaterialTransfer Feature — wraps MaterialTransfer as a self-registering feature.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { InventoryExports } from '../inventory';
import { MaterialTransfer } from './material-transfer';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';

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

        return {
            exports: { materialTransfer } satisfies MaterialTransferExports,
        };
    },
};
