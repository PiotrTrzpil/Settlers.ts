/**
 * Construction jobs across save / load.
 *
 * Diggers and builders run owned `Construction` jobs (ref = siteId, params `{ siteId, role,
 * tileIndex, workPos, recruit }`). They are saved and rebuilt on load; the demand system rebinds
 * each restored worker to its demand (with the digger's tile reservation) in onRestoreComplete, so
 * the same worker resumes instead of the demand being re-dispatched. DIG_TILE / BUILD_STEP and the
 * recruit TRANSFORM_* are irreversible: nothing is done twice.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createScenario, createSimulation, cleanupSimulation, Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import {
    constructionParamsOf,
    demandOf,
    recordLeveledTiles,
    recruitDiggerDispatched,
    slopedSite,
} from '../../helpers/construction-job-helpers';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { JobKind } from '@/game/systems/choreo';
import type { UnitCommitment } from '@/game/systems/unit-commitment';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { RecruitExports } from '@/game/features/recruit';

installRealGameData();

/** True while `unitId` runs `jobId` and still walks its first node, away from the work position. */
function walkingTo(sim: Simulation, unitId: number, jobId: string, walkNode = 0): boolean {
    if (sim.services.jobRunner.getActiveJobId(unitId) !== jobId) {
        return false;
    }
    const job = sim.services.settlerTaskSystem.runtimes.get(unitId)!.job!;
    const { workPos } = constructionParamsOf(sim, unitId);
    const unit = sim.state.getEntityOrThrow(unitId, 'worker');
    return job.nodeIndex === walkNode && Math.abs(unit.x - workPos.x) + Math.abs(unit.y - workPos.y) > 2;
}

function committed(siteId: number, reserved: boolean): UnitCommitment {
    return { owner: JobKind.Construction, ref: siteId, reserved, hasJob: true };
}

/** Units that get bound to a site demand from now on. */
function recordAssignments(sim: Simulation): number[] {
    const ids: number[] = [];
    sim.eventBus.on('construction:workerAssigned', e => ids.push(e.unitId));
    return ids;
}

function recordRecruits(sim: Simulation): number[] {
    const ids: number[] = [];
    sim.eventBus.on('unit:recruited', e => ids.push(e.unitId));
    return ids;
}

describe('Construction jobs across save / load', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        restored?.destroy();
        restored = undefined;
        sim?.destroy();
        cleanupSimulation();
    });

    it('a digger saved on its way resumes the same tile; its demand and tile reservation are kept', () => {
        sim = createSimulation();
        const { siteId, diggers } = slopedSite(sim, { diggers: 1 });
        const digger = diggers[0]!;
        sim.runUntil(() => walkingTo(sim, digger, 'DIG_TILE'), { maxTicks: 10_000, label: 'digger walking' });
        const params = constructionParamsOf(sim, digger);
        expect(params.tileIndex).not.toBeNull();

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.get(digger)).toEqual(committed(siteId, false));
        expect(constructionParamsOf(restored, digger)).toEqual(params);
        expect(restored.services.jobRunner.getActiveJobId(digger)).toBe('DIG_TILE');
        expect(demandOf(restored, siteId, digger)!.reservedTileIndex).toBe(params.tileIndex);

        const assigned = recordAssignments(restored);
        const leveled = recordLeveledTiles(restored, siteId);
        restored.runUntil(() => leveled.length > 0, { maxTicks: 5_000, label: 'restored digger levels' });
        expect(leveled[0]).toBe(`${params.workPos.x},${params.workPos.y}`);

        restored.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 50_000);
        expect(assigned).toEqual([]);
        expect(restored.errors).toHaveLength(0);
    });

    it('a builder saved on its way resumes its build step and the site completes', () => {
        sim = createScenario.constructionSite(BuildingType.WoodcutterHut);
        const siteId = (sim as Simulation & { siteId: number }).siteId;
        const builders = sim.state.entityIndex.query(EntityType.Unit, 0, UnitType.Builder).toArray();
        let builder: number | undefined;
        sim.runUntil(
            () => {
                builder = builders.map(b => b.id).find(id => walkingTo(sim, id, 'BUILD_STEP'));
                return builder !== undefined;
            },
            { maxTicks: 30_000, label: 'builder walking' }
        );
        const params = constructionParamsOf(sim, builder!);

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.get(builder!)).toEqual(committed(siteId, false));
        expect(constructionParamsOf(restored, builder!)).toEqual(params);
        expect(demandOf(restored, siteId, builder!)).toBeDefined();

        const assigned = recordAssignments(restored);
        const completed: number[] = [];
        restored.eventBus.on('settler:taskCompleted', e => e.kind === JobKind.Construction && completed.push(e.unitId));
        restored.runUntil(() => completed.includes(builder!), { maxTicks: 5_000, label: 'restored build step' });
        expect(assigned).not.toContain(builder);

        restored.waitForConstructionComplete(siteId, 80_000);
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
        expect(restored.errors).toHaveLength(0);
    });

    it('a recruit-digger saved before its transform still reserves the shovel, transforms once and digs', () => {
        sim = createSimulation();
        const { siteId } = slopedSite(sim, { carriers: 2, shovels: 2 });
        const carrier = recruitDiggerDispatched(sim, siteId);
        sim.runTicks(5);
        expect(sim.state.getEntityOrThrow(carrier, 'carrier').subType).toBe(UnitType.Carrier);
        const params = constructionParamsOf(sim, carrier);
        expect(params.recruit).not.toBeNull();

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.get(carrier)).toEqual(committed(siteId, true));
        expect(constructionParamsOf(restored, carrier)).toEqual(params);
        expect(restored.services.getFeature<RecruitExports>('recruit').unitTransformer.isPending(carrier)).toBe(true);
        expect(demandOf(restored, siteId, carrier)!.reservedTileIndex).toBe(params.tileIndex);

        const recruited = recordRecruits(restored);
        const leveled = recordLeveledTiles(restored, siteId);
        const tile = `${params.workPos.x},${params.workPos.y}`;
        restored.runUntil(() => leveled.includes(tile), { maxTicks: 20_000, label: 'recruit-digger levels its tile' });

        expect(recruited.filter(id => id === carrier)).toEqual([carrier]);
        expect(restored.state.getEntityOrThrow(carrier, 'digger').subType).toBe(UnitType.Digger);
        expect(restored.errors).toHaveLength(0);
    });

    it('a recruit-digger saved after its transform resumes past it: no second transform', () => {
        sim = createSimulation();
        const { siteId } = slopedSite(sim, { carriers: 2, shovels: 2 });
        const carrier = recruitDiggerDispatched(sim, siteId);
        sim.runUntil(() => walkingTo(sim, carrier, 'RECRUIT_DIGGER', 2), {
            maxTicks: 10_000,
            label: 'transformed digger walking to its tile',
        });
        expect(sim.state.getEntityOrThrow(carrier, 'digger').subType).toBe(UnitType.Digger);
        const params = constructionParamsOf(sim, carrier);

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.get(carrier)).toEqual(committed(siteId, true));
        expect(restored.services.getFeature<RecruitExports>('recruit').unitTransformer.isPending(carrier)).toBe(false);
        expect(restored.services.settlerTaskSystem.runtimes.get(carrier)!.job!.nodeIndex).toBe(2);

        const recruited = recordRecruits(restored);
        const leveled = recordLeveledTiles(restored, siteId);
        const tile = `${params.workPos.x},${params.workPos.y}`;
        restored.runUntil(() => leveled.includes(tile), { maxTicks: 10_000, label: 'transformed digger levels' });

        expect(recruited).not.toContain(carrier);
        expect(restored.errors).toHaveLength(0);
    });
});
