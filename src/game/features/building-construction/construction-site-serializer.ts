/**
 * Serialization and worker-count helpers for ConstructionSiteManager.
 * Extracted to keep the manager file under the line limit.
 */

import type { BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import type { ConstructionCost } from '../../economy/building-production';
import { getConstructionCosts } from '../../economy/building-production';
import { getBuildingInfo } from '../../data/game-data-access';
import { getBuildingFootprintFromInfo } from '@/resources/game-data';
import { BuildingConstructionPhase, type ConstructionSite } from './types';
import type { StoreSerializer } from '@/game/persistence/persistent-store';
import { assignConstructionPilePositions } from '../../systems/inventory/construction-pile-positions';

// ── Serialization types ──

/**
 * Serialized form of a ConstructionSite for game state persistence.
 * Worker assignments (terrain.slots.assigned, building.slots.assigned) are NOT serialized —
 * workers are re-assigned by the settler task system on load.
 */
export interface SerializedConstructionSite {
    buildingType: BuildingType;
    race: Race;
    player: number;
    tileX: number;
    tileY: number;
    phase: BuildingConstructionPhase;
    levelingProgress: number;
    levelingComplete: boolean;
    constructionProgress: number;
    terrainModified: boolean;
}

/** Serialized form with buildingId included so the StoreSerializer can restore it. */
type PersistedConstructionSite = SerializedConstructionSite & { buildingId: number };

/**
 * StoreSerializer for ConstructionSite.
 * Converts between the full in-memory ConstructionSite and the lean PersistedConstructionSite.
 * Derived fields (constructionCosts, workerCount, pilePositions) are recomputed on deserialize.
 */
export function makeConstructionSiteSerializer(): StoreSerializer<ConstructionSite> {
    return {
        serialize(site: ConstructionSite): PersistedConstructionSite {
            return {
                buildingId: site.buildingId,
                buildingType: site.buildingType,
                race: site.race,
                player: site.player,
                tileX: site.tileX,
                tileY: site.tileY,
                phase: site.phase,
                levelingProgress: site.terrain.progress,
                levelingComplete: site.terrain.complete,
                constructionProgress: site.building.progress,
                terrainModified: site.terrain.modified,
            };
        },
        deserialize(raw: unknown): ConstructionSite {
            const data = raw as PersistedConstructionSite;
            const constructionCosts = getConstructionCosts(data.buildingType, data.race);
            const totalCost = constructionCosts.reduce((sum, c) => sum + c.count, 0);
            const workerCount = getWorkerCount(data.buildingType, data.race);
            const pilePositions = assignConstructionPilePositions(data.buildingType, data.race, data.tileX, data.tileY);
            return {
                buildingId: data.buildingId,
                buildingType: data.buildingType,
                race: data.race,
                player: data.player,
                tileX: data.tileX,
                tileY: data.tileY,
                phase:
                    data.phase === BuildingConstructionPhase.Evacuating
                        ? BuildingConstructionPhase.WaitingForBuilders
                        : data.phase,
                terrain: {
                    slots: {
                        required: workerCount,
                        assigned: new Set(),
                        started: data.levelingProgress > 0,
                    },
                    progress: data.levelingProgress,
                    complete: data.levelingComplete,
                    originalTerrain: null,
                    modified: data.terrainModified,
                    unleveledTiles: null,
                    reservedTiles: new Set(),
                    totalLevelingTiles: 0,
                },
                materials: {
                    costs: constructionCosts,
                    totalCost,
                },
                building: {
                    slots: {
                        required: workerCount,
                        assigned: new Set(),
                        started: data.constructionProgress > 0,
                    },
                    progress: data.constructionProgress,
                },
                pilePositions,
            };
        },
    };
}

// ── Worker count helpers ──

/** Default worker count when XML data is unavailable (e.g. eyecatchers without BuildingInfo). */
const DEFAULT_WORKER_COUNT = 2;

/**
 * Derive worker slot count from building footprint tile count.
 * Thresholds match the design doc (docs/designs/building-construction-process.md).
 */
function getWorkerCountFromFootprint(footprintTileCount: number): number {
    if (footprintTileCount <= 30) {
        return 2;
    }
    if (footprintTileCount <= 60) {
        return 3;
    }
    if (footprintTileCount <= 100) {
        return 4;
    }
    if (footprintTileCount <= 150) {
        return 5;
    }
    return 6;
}

/**
 * Get worker slot count from building footprint size.
 * Falls back to DEFAULT_WORKER_COUNT if no BuildingInfo exists for this building/race.
 */
export function getWorkerCount(buildingType: BuildingType, race: Race): number {
    const info = getBuildingInfo(race, buildingType);
    if (!info) {
        return DEFAULT_WORKER_COUNT;
    }
    return getWorkerCountFromFootprint(getBuildingFootprintFromInfo(info).length);
}

/**
 * Get construction costs and total for a building. Convenience wrapper.
 */
export function getConstructionCostsAndTotal(
    buildingType: BuildingType,
    race: Race
): { costs: readonly ConstructionCost[]; totalCost: number } {
    const costs = getConstructionCosts(buildingType, race);
    const totalCost = costs.reduce((sum, c) => sum + c.count, 0);
    return { costs, totalCost };
}
