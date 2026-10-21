/**
 * Settler Location Feature
 *
 * Provides a single source of truth for which settlers are committed to buildings
 * (approaching with intent to enter, or confirmed inside / hidden).
 *
 * Other features (tower-garrison, settler-tasks) call locationManager rather than
 * setting entity.hidden directly. Registers the ENTER_BUILDING choreography executor.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { SettlerBuildingLocationManager } from './settler-building-location-manager';
import type { SettlerLocationExports } from './types';
import { ChoreoTaskType } from '../../systems/choreo';
import { createEnterBuildingExecutor, ENTER_BUILDING_HOOKS } from './enter-building-executor';

export const SettlerLocationFeature: FeatureDefinition = {
    id: 'settler-location',
    dependencies: [], // No feature dependencies — only core services from FeatureContext
    create(ctx: FeatureContext) {
        const locationManager = new SettlerBuildingLocationManager(ctx);
        ctx.choreoSystem.register(
            ChoreoTaskType.ENTER_BUILDING,
            createEnterBuildingExecutor(locationManager),
            ENTER_BUILDING_HOOKS
        );
        return {
            exports: { locationManager } satisfies SettlerLocationExports,
            persistence: [locationManager.locationStore],
        };
    },
};

export type { ISettlerBuildingLocationManager, SettlerLocationExports } from './types';
export { SettlerBuildingStatus } from './types';
export type { SettlerBuildingLocation, ApproachInterruptedEvent } from './types';
