/**
 * Territory Feature — self-registering feature module for territory zones.
 *
 * Towers (small, large) and castles create territory zones.
 * Territory boundary dots are rendered at the edges of these zones.
 *
 * The TerritoryManager is created in onTerrainReady (needs map dimensions).
 * Event wiring for building lifecycle happens after creation.
 */

import type { FeatureDefinition, FeatureContext, FeatureDiagnostics } from '../feature';
import type { BuildingType } from '../../buildings/types';
import type { TerrainData } from '../../terrain';
import { EntityType } from '../../entity';
import { TerritoryManager } from './territory-manager';
import { SpatialGrid } from '../../spatial-grid';
import { TERRITORY_BUILDINGS } from './territory-types';

export interface TerritoryExports {
    territoryManager: TerritoryManager | null;
}

export const TerritoryFeature: FeatureDefinition = {
    id: 'territory',

    create(ctx: FeatureContext) {
        const exports: TerritoryExports = { territoryManager: null };

        return {
            exports,
            onTerrainReady(terrain: TerrainData) {
                const territoryManager = new TerritoryManager(terrain.width, terrain.height);
                exports.territoryManager = territoryManager;

                // Create SpatialGrid and wire it into GameState
                const spatialIndex = new SpatialGrid(
                    terrain.width,
                    terrain.height,
                    4,
                    id => ctx.gameState.getEntity(id),
                    (x, y) => territoryManager.getOwner(x, y)
                );
                ctx.gameState.initSpatialIndex(spatialIndex);

                // Wire territory → spatial grid callbacks
                territoryManager.onTileChanged = (x, y, oldOwner, newOwner) => {
                    spatialIndex.onTileOwnerChanged(x, y, oldOwner, newOwner);
                };
                territoryManager.onRecomputed = () => {
                    spatialIndex.rebuildAllCells();
                };

                // Register territory buildings when created
                ctx.on('entity:created', ({ entityId, type, subType, x, y, player }) => {
                    if (type === EntityType.Building && TERRITORY_BUILDINGS.has(subType as BuildingType)) {
                        territoryManager.addBuilding(entityId, x, y, player, subType as BuildingType);
                    }
                });

                // Remove territory when buildings are destroyed
                ctx.cleanupRegistry.onEntityRemoved(territoryManager.removeBuilding.bind(territoryManager));
            },
            renderContributions: {
                territoryDots: () => exports.territoryManager?.getBoundaryDots() ?? [],
            },
            diagnostics: (): FeatureDiagnostics => ({
                label: 'Territory',
                sections: [
                    {
                        label: 'Status',
                        entries: [
                            {
                                key: 'Buildings',
                                value: exports.territoryManager?.buildingCount ?? 0,
                            },
                        ],
                    },
                ],
            }),
        };
    },
};
