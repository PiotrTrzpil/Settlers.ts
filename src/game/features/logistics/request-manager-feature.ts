/**
 * Request Manager Feature - Self-registering feature module for material delivery requests.
 *
 * Creates the RequestManager and bridges its events to the EventBus.
 * This feature uses id='logistics' so that downstream features (e.g., material-requests)
 * can access the request manager via ctx.getFeature('logistics').
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { RequestManager, type RequestEventListener } from './request-manager';

export interface RequestManagerExports {
    requestManager: RequestManager;
}

export const RequestManagerFeature: FeatureDefinition = {
    id: 'logistics',
    dependencies: [],

    create(ctx: FeatureContext) {
        const requestManager = new RequestManager();

        // Bridge request creation to EventBus for consumers (debug panel, UI)
        const onRequestAdded: RequestEventListener<'requestAdded'> = ({ request }) => {
            ctx.eventBus.emit('request:created', {
                requestId: request.id,
                buildingId: request.buildingId,
                materialType: request.materialType,
                amount: request.amount,
                priority: request.priority,
            });
        };
        requestManager.on('requestAdded', onRequestAdded);

        return {
            exports: { requestManager } satisfies RequestManagerExports,
            destroy: () => {
                requestManager.off('requestAdded', onRequestAdded);
            },
        };
    },
};
