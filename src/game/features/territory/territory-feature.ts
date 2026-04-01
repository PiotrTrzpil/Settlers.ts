/**
 * Territory Feature — self-registering feature module for territory zones.
 *
 * Towers (small, large) and castles create territory zones.
 * Territory boundary dots are rendered at the edges of these zones.
 *
 * The TerritoryManager is created in onTerrainReady (needs map dimensions).
 * Event wiring for building lifecycle happens after creation.
 *
 * When territory changes after a tower capture, buildings of the losing player
 * on lost territory are destroyed, and non-military units are displaced to
 * the nearest friendly territory tile.
 */

import type { FeatureDefinition, FeatureContext, FeatureDiagnostics } from '../feature';
import type { BuildingType } from '../../buildings/types';
import type { TerrainData } from '../../terrain';
import { EntityType } from '../../entity';
import { isUnitTypeMilitary, type UnitType } from '../../core/unit-types';
import { TerritoryManager, type TerritoryChange } from './territory-manager';
import { SpatialGrid } from '../../spatial-grid';
import { TERRITORY_BUILDINGS } from './territory-types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('Territory');

export interface TerritoryExports {
    territoryManager: TerritoryManager | null;
}

export const TerritoryFeature: FeatureDefinition = {
    id: 'territory',

    create(ctx: FeatureContext) {
        const exports: TerritoryExports = { territoryManager: null };

        return {
            exports,
            persistence: 'none',
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

                // Wire territory change consequences (destroy buildings, displace units).
                // Deferred to next tick: recompute fires lazily inside other systems'
                // queries, so destroying buildings mid-query causes re-entrancy bugs.
                territoryManager.onTerritoryChanged = (changes: TerritoryChange[]) => {
                    ctx.tickScheduler.schedule(1, () => {
                        handleTerritoryChanges(ctx, territoryManager, changes);
                    });
                };

                // Register territory when buildings complete construction
                ctx.on('building:completed', ({ buildingId, buildingType }) => {
                    if (TERRITORY_BUILDINGS.has(buildingType)) {
                        const entity = ctx.gameState.getEntityOrThrow(buildingId, 'territory:building:completed');
                        territoryManager.addBuilding(buildingId, entity.x, entity.y, entity.player, buildingType);
                    }
                });

                // On game load, buildings are created already operational — register those immediately
                ctx.on('entity:created', ({ entityId, entityType: type, subType, x, y, player }) => {
                    if (type === EntityType.Building && TERRITORY_BUILDINGS.has(subType as BuildingType)) {
                        const entity = ctx.gameState.getEntityOrThrow(entityId, 'territory:entity:created');
                        if (entity.operational) {
                            territoryManager.addBuilding(entityId, x, y, player, subType as BuildingType);
                        }
                    }
                });

                // Update territory when a building changes ownership (e.g. siege capture)
                ctx.on('building:ownerChanged', ({ buildingId, buildingType, newPlayer }) => {
                    if (TERRITORY_BUILDINGS.has(buildingType)) {
                        const entity = ctx.gameState.getEntityOrThrow(buildingId, 'territory:building:ownerChanged');
                        territoryManager.removeBuilding(buildingId);
                        territoryManager.addBuilding(buildingId, entity.x, entity.y, newPlayer, buildingType);
                    }
                });

                // Remove territory when buildings are destroyed
                ctx.cleanupRegistry.onEntityRemoved(territoryManager.removeBuilding.bind(territoryManager));
            },
            renderContributions: {
                // eslint-disable-next-line no-restricted-syntax -- territoryManager is nullable before feature init; [] is correct when not yet loaded
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
                                // eslint-disable-next-line no-restricted-syntax -- territoryManager is nullable before feature init; 0 is correct when not yet loaded
                                value: exports.territoryManager?.buildingCount ?? 0,
                            },
                        ],
                    },
                ],
            }),
        };
    },
};

// ── Post-capture territory consequences ──────────────────────────────

/**
 * Handle territory tile ownership changes after recomputation.
 * Finds buildings and units on tiles that changed from one player to another
 * and destroys/displaces them.
 */
function handleTerritoryChanges(
    ctx: FeatureContext,
    territoryManager: TerritoryManager,
    changes: TerritoryChange[]
): void {
    // Build a set of (oldOwner → newOwner) player pairs that actually changed
    // to quickly skip irrelevant entities
    const affectedPlayers = new Set<number>();
    for (const change of changes) {
        if (change.oldOwner >= 0) {
            affectedPlayers.add(change.oldOwner);
        }
    }
    if (affectedPlayers.size === 0) {
        return;
    }

    destroyBuildingsOnLostTerritory(ctx, territoryManager, affectedPlayers);
    displaceUnitsOnLostTerritory(ctx, territoryManager, affectedPlayers);
}

/** Check if a building should be destroyed due to lost territory. */
function isBuildingOnEnemyTerritory(ctx: FeatureContext, tm: TerritoryManager, id: number, player: number): boolean {
    const entity = ctx.gameState.getEntity(id);
    if (!entity) {
        return false;
    }
    if (TERRITORY_BUILDINGS.has(entity.subType as BuildingType)) {
        return false;
    }
    const tileOwner = tm.getOwner(entity.x, entity.y);
    return tileOwner >= 0 && tileOwner !== player;
}

/**
 * Destroy non-territory buildings belonging to players who lost territory,
 * if those buildings now sit on enemy territory.
 */
function destroyBuildingsOnLostTerritory(
    ctx: FeatureContext,
    tm: TerritoryManager,
    affectedPlayers: ReadonlySet<number>
): void {
    const toRemove: number[] = [];

    for (const player of affectedPlayers) {
        const buildingIds = ctx.gameState.entityIndex.idsOfTypeAndPlayer(EntityType.Building, player);
        for (const id of buildingIds) {
            if (isBuildingOnEnemyTerritory(ctx, tm, id, player)) {
                toRemove.push(id);
            }
        }
    }

    for (const id of toRemove) {
        log.info(`Destroying building ${id} — on enemy territory`);
        ctx.executeCommand({ type: 'remove_entity', entityId: id });
    }
}

/** Check if a non-military unit should be displaced due to lost territory. */
function shouldDisplaceUnit(ctx: FeatureContext, tm: TerritoryManager, id: number, player: number): boolean {
    const entity = ctx.gameState.getEntity(id);
    if (!entity || entity.hidden) {
        return false;
    }
    if (isUnitTypeMilitary(entity.subType as UnitType)) {
        return false;
    }
    const tileOwner = tm.getOwner(entity.x, entity.y);
    return tileOwner >= 0 && tileOwner !== player;
}

/**
 * Displace non-military units belonging to players who lost territory.
 * Units on tiles now owned by another player are moved to the nearest
 * tile still owned by their player.
 */
function displaceUnitsOnLostTerritory(
    ctx: FeatureContext,
    tm: TerritoryManager,
    affectedPlayers: ReadonlySet<number>
): void {
    for (const player of affectedPlayers) {
        const unitIds = ctx.gameState.entityIndex.idsOfTypeAndPlayer(EntityType.Unit, player);
        for (const id of unitIds) {
            if (!shouldDisplaceUnit(ctx, tm, id, player)) {
                continue;
            }
            const entity = ctx.gameState.getEntity(id)!;
            const target = findNearestFriendlyTile(tm, entity.x, entity.y, player);
            if (target) {
                ctx.executeCommand({ type: 'move_unit', entityId: id, targetX: target.x, targetY: target.y });
            }
        }
    }
}

/** BFS search for the nearest tile owned by the given player. */
function findNearestFriendlyTile(
    tm: TerritoryManager,
    startX: number,
    startY: number,
    player: number
): { x: number; y: number } | null {
    const MAX_SEARCH = 2000;
    const visited = new Set<number>();
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    visited.add(startY * 10000 + startX);

    const GRID_DX = [1, -1, 0, 0, 1, -1];
    const GRID_DY = [0, 0, 1, -1, 1, -1];

    for (let i = 0; i < queue.length && i < MAX_SEARCH; i++) {
        const { x, y } = queue[i]!;
        if (tm.isInTerritory(x, y, player)) {
            return { x, y };
        }
        for (let d = 0; d < 6; d++) {
            const nx = x + GRID_DX[d]!;
            const ny = y + GRID_DY[d]!;
            const key = ny * 10000 + nx;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
    }
    return null;
}
