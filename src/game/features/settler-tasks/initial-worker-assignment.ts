/**
 * Post-map-load worker assignment.
 *
 * Scans all units and assigns workers that are positioned inside their matching
 * building's footprint. Called once after map entities are populated so that
 * map-placed workers (e.g. a woodcutter inside a woodcutter hut) are recognized.
 */

import { BuildingType, EntityType, UnitType } from '../../entity';
import type { GameState } from '../../game-state';
import { getWorkerBuildingTypes } from '../../data/game-data-access';
import { getBuildingMaxOccupants } from '../../buildings/types';
import { createLogger } from '@/utilities/logger';
import type { ISettlerBuildingLocationManager } from '../settler-location/types';
import type { UnitRuntime } from './unit-state-machine';

const log = createLogger('InitialWorkerAssignment');

/**
 * For each worker unit on a building footprint tile, check if the building's worker type
 * matches the unit type. If so, claim the building and mark the unit as inside.
 */
export function assignInitialBuildingWorkers(
    gameState: GameState,
    buildingOccupants: Map<number, number>,
    locationManager: ISettlerBuildingLocationManager,
    getRuntime: (entityId: number) => UnitRuntime,
    claimBuilding: (runtime: UnitRuntime, buildingId: number) => void
): void {
    let assigned = 0;
    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Unit) continue;

        const unitType = entity.subType as UnitType;
        const workplaceTypes = getWorkerBuildingTypes(entity.race, unitType);
        if (!workplaceTypes) continue;

        // Check if this unit is on a building footprint tile
        const buildingAtTile = gameState.getEntityAt(entity.x, entity.y);
        if (!buildingAtTile || buildingAtTile.type !== EntityType.Building) continue;
        if (buildingAtTile.player !== entity.player) continue;

        // Check if building type matches the unit's workplace types
        if (!workplaceTypes.has(buildingAtTile.subType as BuildingType)) continue;

        // Check occupancy limit
        const currentOccupants = buildingOccupants.get(buildingAtTile.id) ?? 0;
        if (currentOccupants >= getBuildingMaxOccupants(buildingAtTile.subType as BuildingType)) continue;

        // Assign: claim building, mark as inside, skip the approaching phase
        const runtime = getRuntime(entity.id);
        claimBuilding(runtime, buildingAtTile.id);
        runtime.homeAssignment!.hasVisited = true;
        locationManager.enterBuilding(entity.id, buildingAtTile.id);

        assigned++;
    }
    if (assigned > 0) {
        log.debug(`Assigned ${assigned} initial building workers from map positions`);
    }
}
