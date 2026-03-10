/**
 * WorkArea Feature — wraps WorkAreaStore as a self-registering feature.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { WorkAreaStore } from './work-area-store';

export interface WorkAreaExports {
    workAreaStore: WorkAreaStore;
}

export const WorkAreaFeature: FeatureDefinition = {
    id: 'work-areas',

    create(ctx: FeatureContext) {
        const workAreaStore = new WorkAreaStore();

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            workAreaStore.removeInstance(entityId);
        });

        return {
            exports: { workAreaStore } satisfies WorkAreaExports,
            persistence: 'none',
        };
    },
};
