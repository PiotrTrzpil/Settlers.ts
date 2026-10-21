/**
 * Recruit jobs across save / load.
 *
 * Recruit jobs (player queue, direct transforms) are owned `Recruit` jobs: saved as
 * `{ kind, params: { segment }, nodeIndex }` and rebuilt on load. Source reservations are not
 * saved — the TRANSFORM_* node's `onRestore` hook re-makes them, and refuses (→ the job is
 * abandoned, the carrier idles) when the source is gone. TRANSFORM_* is irreversible: a job saved
 * after its transform never snaps back across it, so the carrier does not transform twice.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';
import { ChoreoTaskType, JobKind, choreo } from '@/game/systems/choreo';
import { restoreFromSnapshot } from '@/game/state/game-state-persistence';
import { snapResumeIndex } from '@/game/features/settler-tasks/internal/job-resume';
import { recruitJobSpec, type RecruitExports, type RecruitSegment } from '@/game/features/recruit';
import type { Game } from '@/game/game';
import type { Command } from '@/game/commands';

installRealGameData();

const ONE_SWORD = [{ material: EMaterialType.SWORD, count: 1 }] as const;

function recruit(sim: Simulation): RecruitExports {
    return sim.services.getFeature<RecruitExports>('recruit');
}

/** Storage areas charge one sword (output) per swordsman — a building source for these specs. */
function registerStorageCharge(sim: Simulation): void {
    recruit(sim).recruitSegments.registerBuildingCharge(BuildingType.StorageArea, () => ({
        costs: ONE_SWORD,
        side: 'output',
    }));
}

/** Snapshot → fresh Simulation (`prepare` runs before the restore) → no replay ticks. */
function restoreInto(src: Simulation, prepare: (sim: Simulation) => void = () => {}): Simulation {
    const snapshot = src.createSnapshot();
    const sim2 = new Simulation({ mapWidth: src.mapWidth, mapHeight: src.mapHeight });
    prepare(sim2);
    const game = {
        state: sim2.state,
        services: sim2.services,
        terrain: sim2.map.terrain,
        eventBus: sim2.eventBus,
        execute: (cmd: Command) => sim2.execute(cmd),
    } as unknown as Game;
    restoreFromSnapshot(game, snapshot);
    return sim2;
}

/** One carrier, one pickaxe pile 20 tiles away; queues a geologist and runs until the walk began. */
function geologistWalking(sim: Simulation): { carrierId: number; pileId: number } {
    const carrierId = sim.spawnUnit({ x: 60, y: 64 }, UnitType.Carrier);
    const pileId = sim.placeGoodsAt({ x: 80, y: 64 }, EMaterialType.PICKAXE, 1);
    sim.execute({ type: 'recruit_specialist', unitType: UnitType.Geologist, count: 1, player: 0, race: Race.Roman });
    sim.runUntil(() => sim.services.unitCommitments.get(carrierId)?.owner === JobKind.Recruit, {
        maxTicks: 1_000,
        label: 'geologist recruit dispatched',
    });
    sim.runTicks(20);
    return { carrierId, pileId };
}

function pickaxePiles(sim: Simulation): number {
    return sim.state.entityIndex.query(EntityType.StackedPile, 0, EMaterialType.PICKAXE).count();
}

describe('Recruit jobs across save / load', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        restored?.destroy();
        restored = undefined;
        sim?.destroy();
        cleanupSimulation();
    });

    it('a recruit saved on its way resumes, still reserves the pile, and transforms once', () => {
        sim = createSimulation();
        const { carrierId } = geologistWalking(sim);

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.get(carrierId)).toEqual({
            owner: JobKind.Recruit,
            ref: 0,
            reserved: true,
            hasJob: true,
        });
        const { unitTransformer, toolSourceResolver } = recruit(restored);
        expect(unitTransformer.isPending(carrierId)).toBe(true);
        expect(toolSourceResolver.findNearestToolPile(EMaterialType.PICKAXE, 80, 64, 0)).toBeNull();

        const recruited: number[] = [];
        restored.eventBus.on('unit:recruited', e => recruited.push(e.unitId));
        restored.runUntil(() => restored!.countEntities(EntityType.Unit, UnitType.Geologist) === 1, {
            maxTicks: 30_000,
            label: 'restored recruit transforms',
        });
        restored.runTicks(100);

        expect(recruited).toEqual([carrierId]);
        expect(pickaxePiles(restored)).toBe(0);
        expect(unitTransformer.isPending(carrierId)).toBe(false);
        expect(restored.services.unitCommitments.isIdle(carrierId)).toBe(true);
        expect(restored.errors).toHaveLength(0);
    });

    it('a recruit whose pile is gone on load is abandoned: the carrier stays a carrier and idles', () => {
        sim = createSimulation();
        const { carrierId, pileId } = geologistWalking(sim);
        sim.state.removeEntity(pileId);

        restored = sim.saveAndRestore(0);

        expect(restored.services.unitCommitments.isIdle(carrierId)).toBe(true);
        expect(recruit(restored).unitTransformer.isPending(carrierId)).toBe(false);
        restored.runTicks(300);
        expect(restored.state.getEntityOrThrow(carrierId, 'carrier').subType).toBe(UnitType.Carrier);
        expect(restored.errors).toHaveLength(0);
    });

    it('a job saved after its transform resumes past it (TRANSFORM_* is irreversible)', () => {
        sim = createSimulation();
        const { recruitSegments } = recruit(sim);
        const segment: RecruitSegment = {
            targetUnitType: UnitType.Geologist,
            source: 'pile',
            sourceId: 1,
            at: { x: 10, y: 10 },
        };
        const build = recruitSegments.prefix(
            segment,
            choreo('CONTINUATION').goTo({ x: 20, y: 20 }).wait(5).toJobBuild()
        );
        expect(build.nodes.map(n => n.task)).toEqual([
            ChoreoTaskType.GO_TO_TARGET,
            ChoreoTaskType.TRANSFORM_RECRUIT,
            ChoreoTaskType.GO_TO_TARGET,
            ChoreoTaskType.WAIT,
        ]);
        const transformIndex = 1;

        expect(snapResumeIndex(build.nodes, transformIndex, sim.services.choreoSystem)).toBe(0);
        expect(snapResumeIndex(build.nodes, transformIndex + 2, sim.services.choreoSystem)).toBe(transformIndex + 1);
    });

    it('a building-source recruit saved on its way re-reserves the materials and withdraws them once', () => {
        sim = createSimulation();
        registerStorageCharge(sim);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.SWORD, 1);
        const [carrierId] = sim.spawnUnitNear(storageId, UnitType.Carrier, 1, 0);
        const dispatched = recruit(sim).recruitSystem.dispatchBuildingRecruitment(
            UnitType.Swordsman1,
            0,
            storageId,
            (_id, seg) => recruitJobSpec(seg)
        );
        expect(dispatched).toBe(carrierId);

        restored = restoreInto(sim, registerStorageCharge);

        expect(recruit(restored).toolSourceResolver.hasBuildingMaterials(storageId, ONE_SWORD, 'output')).toBe(false);
        restored.runUntil(() => restored!.countEntities(EntityType.Unit, UnitType.Swordsman1) === 1, {
            maxTicks: 10_000,
            label: 'restored building recruit transforms',
        });
        expect(restored.services.inventoryManager.getOutputAmount(storageId, EMaterialType.SWORD)).toBe(0);
        expect(recruit(restored).toolSourceResolver.getBuildingReservation(carrierId!)).toBeUndefined();
        expect(restored.errors).toHaveLength(0);
    });

    it('a building-source recruit killed on its way releases the materials', () => {
        sim = createSimulation();
        registerStorageCharge(sim);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.SWORD, 1);
        const [carrierId] = sim.spawnUnitNear(storageId, UnitType.Carrier, 1, 0);
        recruit(sim).recruitSystem.dispatchBuildingRecruitment(UnitType.Swordsman1, 0, storageId, (_id, seg) =>
            recruitJobSpec(seg)
        );

        sim.killUnit(carrierId!);

        expect(recruit(sim).toolSourceResolver.hasBuildingMaterials(storageId, ONE_SWORD, 'output')).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});
