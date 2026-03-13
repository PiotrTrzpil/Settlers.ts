/**
 * Settler Location Feature
 *
 * Provides a single source of truth for which settlers are committed to buildings
 * (approaching with intent to enter, or confirmed inside / hidden).
 *
 * Other features (tower-garrison, settler-tasks) call locationManager rather than
 * setting entity.hidden directly.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { SettlerBuildingLocationManager } from './settler-building-location-manager';
import type { SettlerLocationExports } from './types';

export const SettlerLocationFeature: FeatureDefinition = {
    id: 'settler-location',
    dependencies: [], // No feature dependencies — only core services from FeatureContext
    create(ctx: FeatureContext) {
        const locationManager = new SettlerBuildingLocationManager(ctx);
        return {
            exports: { locationManager } satisfies SettlerLocationExports,
            persistence: [],
        };
    },
};

export type { ISettlerBuildingLocationManager, SettlerLocationExports } from './types';
export { SettlerBuildingStatus } from './types';
export type { SettlerBuildingLocation, ApproachInterruptedEvent } from './types';
