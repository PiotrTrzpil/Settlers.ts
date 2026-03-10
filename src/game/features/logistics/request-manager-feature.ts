/**
 * Request Manager Feature - Self-registering feature module for material delivery requests.
 *
 * Creates the RequestManager and injects the global EventBus for event emission.
 * This feature uses id='logistics' so that downstream features (e.g., material-requests)
 * can access the request manager via ctx.getFeature('logistics').
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { RequestManager } from './request-manager';

export interface RequestManagerExports {
    requestManager: RequestManager;
}

export const RequestManagerFeature: FeatureDefinition = {
    id: 'logistics',
    dependencies: [],

    create(ctx: FeatureContext) {
        const requestManager = new RequestManager(ctx.eventBus);

        return {
            exports: { requestManager } satisfies RequestManagerExports,
            persistence: [{ persistable: requestManager, after: ['constructionSites'] }],
        };
    },
};
