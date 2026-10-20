/**
 * Territory Feature — self-registering feature module for territory zones.
 *
 * Towers (small, large) and castles create territory zones.
 * Territory boundary dots are rendered at the edges of these zones.
 *
 * Creates the TerritoryManager (sized from ctx.terrain) and the territory-aware
 * SpatialGrid, and wires building lifecycle events into territory updates.
 *
 * Consequences of territory loss (destroying buildings, displacing units) live in
 * TerritoryConsequencesFeature, which depends on settler-tasks.
 */

import type { FeatureDefinition, FeatureContext, FeatureDiagnostics } from '../feature';
import { getBuildingFootprint, type BuildingType } from '../../buildings/types';
import { EntityType } from '../../entity';
import { TerritoryManager } from './territory-manager';
import { TerritoryPersistence } from './territory-persistence';
import { SpatialGrid } from '../../spatial-grid';
import { TERRITORY_BUILDINGS } from './territory-types';
import { isDarkTribe } from '../../core/race';

export interface TerritoryExports {
    territoryManager: TerritoryManager;
}

export const TerritoryFeature: FeatureDefinition = {
    id: 'territory',
    dependencies: [],

    create(ctx: FeatureContext) {
        const territoryManager = new TerritoryManager(ctx.terrain.width, ctx.terrain.height);

        // Create SpatialGrid and wire it into GameState
        const spatialIndex = new SpatialGrid(
            ctx.terrain.width,
            ctx.terrain.height,
            4,
            id => ctx.gameState.getEntity(id),
            tile => territoryManager.getOwner(tile)
        );
        ctx.gameState.initSpatialIndex(spatialIndex);

        // Wire territory → spatial grid callbacks
        territoryManager.onTileChanged = (tile, oldOwner, newOwner) => {
            spatialIndex.onTileOwnerChanged(tile, oldOwner, newOwner);
        };
        territoryManager.onRecomputed = () => {
            spatialIndex.rebuildAllCells();
        };

        registerBuildingEvents(ctx, territoryManager);

        const exports: TerritoryExports = { territoryManager };

        return {
            exports,
            persistence: [new TerritoryPersistence(territoryManager)],
            renderContributions: {
                territoryDots: () => territoryManager.getBoundaryDots(),
            },
            diagnostics: (): FeatureDiagnostics => ({
                label: 'Territory',
                sections: [
                    {
                        label: 'Status',
                        entries: [{ key: 'Buildings', value: territoryManager.buildingCount }],
                    },
                ],
            }),
        };
    },
};

/**
 * Register building lifecycle handlers that add/remove territory zones.
 * Dark Tribe never generates territory — their towers exist but create no zones.
 * Territory persists when towers are destroyed — only ownership changes
 * (siege capture) trigger territory recomputation.
 */
function registerBuildingEvents(ctx: FeatureContext, territoryManager: TerritoryManager): void {
    // Register territory when buildings complete construction
    ctx.on('building:completed', ({ buildingId, buildingType }) => {
        if (TERRITORY_BUILDINGS.has(buildingType)) {
            const entity = ctx.gameState.getEntityOrThrow(buildingId, 'territory:building:completed');
            if (isDarkTribe(entity.race)) {
                return;
            }
            territoryManager.addBuilding(buildingId, entity, entity.player, buildingType);
        }
    });

    // On game load, buildings are created already operational — register those immediately
    ctx.on('entity:created', ({ entityId, entityType: type, subType, player }) => {
        if (type === EntityType.Building && TERRITORY_BUILDINGS.has(subType as BuildingType)) {
            const entity = ctx.gameState.getEntityOrThrow(entityId, 'territory:entity:created');
            if (isDarkTribe(entity.race)) {
                return;
            }
            if (entity.operational) {
                territoryManager.addBuilding(entityId, entity, player, subType as BuildingType);
            }
        }
    });

    // Update territory when a building changes ownership (e.g. siege capture)
    ctx.on('building:ownerChanged', ({ buildingId, buildingType, newPlayer }) => {
        if (TERRITORY_BUILDINGS.has(buildingType)) {
            const entity = ctx.gameState.getEntityOrThrow(buildingId, 'territory:building:ownerChanged');
            territoryManager.removeBuilding(buildingId);
            // Dark Tribe captures don't generate territory
            if (isDarkTribe(entity.race)) {
                return;
            }
            territoryManager.addBuilding(buildingId, entity, newPlayer, buildingType);
            // The building footprint itself must belong to the new owner immediately,
            // even if surrounding tiles are still contested by the old owner's other towers.
            const footprint = getBuildingFootprint(entity, buildingType, entity.race);
            territoryManager.claimTiles(footprint, newPlayer);
        }
    });
}
