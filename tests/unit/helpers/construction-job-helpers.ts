/**
 * Shared setup + accessors for the Construction job specs (tests/unit/integration/jobs/construction-*.spec.ts).
 */

import type { Simulation } from './test-simulation';
import { createSlope } from './test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import type { BuildingConstructionExports } from '@/game/features/building-construction';
import type { ConstructionWorkerDemand } from '@/game/features/building-construction/construction-worker-demands';
import type { ConstructionJobParams } from '@/game/features/building-construction/construction-job-kind';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import { JobKind } from '@/game/systems/choreo';

export interface SlopedSiteOpts {
    diggers?: number;
    builders?: number;
    carriers?: number;
    shovels?: number;
}

export interface SlopedSite {
    siteId: number;
    diggers: number[];
    builders: number[];
    carriers: number[];
}

/** Sloped woodcutter site (needs digging) next to a residence and a stocked storage area. */
export function slopedSite(sim: Simulation, opts: SlopedSiteOpts = {}): SlopedSite {
    createSlope(sim.map, 55, 60, 75, 70, 0, 40);
    const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
    const storageId = sim.placeBuilding(BuildingType.StorageArea);
    sim.injectOutput(storageId, EMaterialType.BOARD, 8);
    sim.injectOutput(storageId, EMaterialType.STONE, 8);
    if (opts.shovels) {
        sim.placeGoods(EMaterialType.SHOVEL, opts.shovels);
    }
    const diggers = sim.spawnUnitNear(residenceId, UnitType.Digger, opts.diggers ?? 0);
    const builders = sim.spawnUnitNear(residenceId, UnitType.Builder, opts.builders ?? 0);
    const carriers = sim.spawnUnitNear(residenceId, UnitType.Carrier, opts.carriers ?? 0);
    const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
    return { siteId, diggers, builders, carriers };
}

export function constructionParamsOf(sim: Simulation, unitId: number): ConstructionJobParams {
    const { jobs } = sim.services.getFeature<SettlerTaskExports>('settler-tasks');
    return jobs.paramsOf(unitId) as ConstructionJobParams;
}

/** The demand of `siteId` bound to `unitId`, if any. */
export function demandOf(sim: Simulation, siteId: number, unitId: number): ConstructionWorkerDemand | undefined {
    const { constructionWorkerDemands } = sim.services.getFeature<BuildingConstructionExports>('building-construction');
    return constructionWorkerDemands.demandOf(siteId, unitId);
}

/** Records the leveled tiles (`x,y`) of a site. */
export function recordLeveledTiles(sim: Simulation, siteId: number): string[] {
    const tiles: string[] = [];
    sim.eventBus.on('construction:tileCompleted', e => e.buildingId === siteId && tiles.push(`${e.x},${e.y}`));
    return tiles;
}

/** Runs until a carrier is dispatched as a recruit-digger to `siteId`; returns it. */
export function recruitDiggerDispatched(sim: Simulation, siteId: number): number {
    let found: number | undefined;
    sim.runUntil(
        () => {
            found = sim.services.unitCommitments
                .unitsOwnedBy(JobKind.Construction, siteId)
                .find(id => sim.services.jobRunner.getActiveJobId(id) === 'RECRUIT_DIGGER');
            return found !== undefined;
        },
        { maxTicks: 10_000, label: 'recruit-digger dispatched' }
    );
    return found!;
}
