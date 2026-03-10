/**
 * Scenario builders for integration tests.
 *
 * Pre-configured simulation setups for common test patterns:
 *   createScenario.singleProducer(type)         - residence + 1 building
 *   createScenario.chain(producer, transformer)  - residence + 2 buildings
 *   createScenario.isolatedTransformer(type, inputs) - building with injected inputs
 *   createScenario.militaryTraining()            - storage + residence + barracks
 *   createScenario.constructionSite(type)        - residence + digger + builder + storage + site
 */

import { Simulation, type SimulationOptions } from './test-simulation';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';

// ─── Types ───────────────────────────────────────────────────────

/** Simulation + primary building ID for single-building scenarios. */
export type SingleBuildingSim = Simulation & { buildingId: number };

/** Simulation + producer and transformer IDs for chain scenarios. */
export type ChainSim = Simulation & { producerId: number; transformerId: number };

// ─── Scenario builders ──────────────────────────────────────────

export const createScenario = {
    /**
     * Single producer/building with a ResidenceSmall for carriers.
     * Returns sim with `buildingId` for the primary building.
     */
    singleProducer(buildingType: BuildingType, opts?: SimulationOptions): SingleBuildingSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const buildingId = sim.placeBuilding(buildingType);
        return Object.assign(sim, { buildingId });
    },

    /**
     * Producer → Transformer chain with carrier logistics.
     * Returns sim with `producerId` and `transformerId`.
     */
    chain(producer: BuildingType, transformer: BuildingType, opts?: SimulationOptions): ChainSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const producerId = sim.placeBuilding(producer);
        const transformerId = sim.placeBuilding(transformer);
        return Object.assign(sim, { producerId, transformerId });
    },

    /**
     * Isolated transformer — inputs pre-injected, no supply chain needed.
     * Returns sim with `buildingId` for the transformer.
     */
    isolatedTransformer(
        buildingType: BuildingType,
        inputs: [EMaterialType, number][],
        opts?: SimulationOptions
    ): SingleBuildingSim {
        const sim = new Simulation(opts);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const buildingId = sim.placeBuilding(buildingType);
        for (const [mat, amt] of inputs) {
            sim.injectInput(buildingId, mat, amt);
        }
        return Object.assign(sim, { buildingId });
    },

    /**
     * Military training setup: StorageArea + ResidenceSmall + Barracks.
     * Returns sim with `barracksId` and `storageId`.
     */
    militaryTraining(opts?: SimulationOptions): Simulation & { barracksId: number; storageId: number } {
        const sim = new Simulation(opts ?? { mapWidth: 256, mapHeight: 256 });
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const barracksId = sim.placeBuilding(BuildingType.Barrack);
        return Object.assign(sim, { barracksId, storageId });
    },

    /**
     * Construction site setup: ResidenceSmall (for carriers) + digger + builder +
     * StorageArea with materials + a building placed as construction site.
     * Returns sim with `siteId` (the building under construction) and `storageId`.
     */
    constructionSite(
        buildingType: BuildingType,
        materials: [EMaterialType, number][] = [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ],
        opts?: SimulationOptions
    ): Simulation & { siteId: number; storageId: number } {
        const sim = new Simulation(opts ?? {});
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.spawnUnitNear(residenceId, UnitType.Digger);
        sim.spawnUnitNear(residenceId, UnitType.Builder, 2);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        for (const [mat, amt] of materials) {
            sim.injectOutput(storageId, mat, amt);
        }
        const siteId = sim.placeBuilding(buildingType, 0, false);
        return Object.assign(sim, { siteId, storageId });
    },
};
