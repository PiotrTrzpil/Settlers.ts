/**
 * BuildingPlacement Feature — owns the `place_building` command and the active
 * territory placement filter.
 *
 * Separate from BuildingConstructionFeature because placement needs territory
 * ownership, and making building-construction depend on territory would reorder
 * feature loading (and with it event-subscription order). This feature has no
 * systems, subscriptions or persistent state, so its load position is irrelevant.
 *
 * The placement filter is runtime state: GameCore swaps it when territory
 * enforcement is toggled; renderer/UI read it for placement previews.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { TerritoryExports } from '../territory';
import type { PlacementFilter } from '../../systems/placement';
import type { PlaceBuildingCommand } from '../../commands/command-types';
import type { BuildingConstructionExports } from './building-construction-feature';
import { executePlaceBuilding } from './internal/place-building-command';

export interface BuildingPlacementExports {
    /** Active placement filter; null when territory enforcement is off (nullable by design). */
    getPlacementFilter(): PlacementFilter | null;
    setPlacementFilter(filter: PlacementFilter | null): void;
}

export const BuildingPlacementFeature: FeatureDefinition = {
    id: 'building-placement',
    dependencies: ['building-construction', 'territory'],

    create(ctx: FeatureContext) {
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        let placementFilter: PlacementFilter | null = null;

        const exports: BuildingPlacementExports = {
            getPlacementFilter: () => placementFilter,
            setPlacementFilter: filter => {
                placementFilter = filter;
            },
        };

        return {
            exports,
            persistence: 'none',
            commands: {
                place_building: cmd =>
                    executePlaceBuilding(
                        {
                            state: ctx.gameState,
                            terrain: ctx.terrain,
                            eventBus: ctx.eventBus,
                            constructionSiteManager,
                            placementFilter,
                            getOwner: tile => territoryManager.getOwner(tile),
                        },
                        cmd as PlaceBuildingCommand
                    ),
            },
        };
    },
};
