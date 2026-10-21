/**
 * Workplace dispatch ownership — a building that needs a worker dispatches an owned
 * `WorkplaceDispatch` job (ref = building id): an idle specialist walks in directly, or a carrier
 * recruits (walk to the tool pile + transform) and then walks in (docs/designs/job-ownership.md,
 * "Workplace-dispatch migration").
 *
 * Covers: commitments of both dispatch paths, save mid-walk (the job resumes, the building is
 * filled once, no second unit dispatched), unit killed mid-walk (a new dispatch), building removed
 * mid-walk (the job is cancelled, the pile reservation released).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { JobKind } from '@/game/systems/choreo';
import type { BuildingDemandExports } from '@/game/features/building-demand/building-demand-feature';
import type { BuildingDemand } from '@/game/features/building-demand/types';
import type { RecruitExports } from '@/game/features/recruit';

installRealGameData();

const HUT_NEAR = { x: 50, y: 64 };
const UNIT_AT = { x: 76, y: 64 };
const PILE_AT = { x: 80, y: 64 };

function demandOf(sim: Simulation, buildingId: number): BuildingDemand | undefined {
    return sim.services.getFeature<BuildingDemandExports>('building-demand').buildingDemandSystem.getDemand(buildingId);
}

/** A completed woodcutter hut without its worker — the demand pipeline dispatches one. */
function placeEmptyHut(sim: Simulation): number {
    return sim.placeBuildingNear(HUT_NEAR, BuildingType.WoodcutterHut, 0, true, undefined, false);
}

function waitForDispatch(sim: Simulation, unitId: number, label: string): void {
    sim.runUntil(() => sim.services.unitCommitments.get(unitId)?.owner === JobKind.WorkplaceDispatch, {
        maxTicks: 1_000,
        label,
    });
    sim.runTicks(10);
}

/** Idle woodcutter far from an empty hut, dispatched and walking. */
function specialistWalking(sim: Simulation): { buildingId: number; unitId: number } {
    const unitId = sim.spawnUnit(UNIT_AT, UnitType.Woodcutter);
    const buildingId = placeEmptyHut(sim);
    waitForDispatch(sim, unitId, 'woodcutter dispatched');
    return { buildingId, unitId };
}

/** Carrier far from an empty hut, an axe pile further away; the carrier walks to the pile. */
function recruitWalking(sim: Simulation): { buildingId: number; unitId: number; pileId: number } {
    const unitId = sim.spawnUnit(UNIT_AT, UnitType.Carrier);
    const pileId = sim.placeGoodsAt(PILE_AT, EMaterialType.AXE, 1);
    const buildingId = placeEmptyHut(sim);
    waitForDispatch(sim, unitId, 'carrier dispatched to recruit');
    return { buildingId, unitId, pileId };
}

/** Run until the building's demand is fulfilled by `unitId`; returns the dispatch completions seen. */
function runUntilFilled(sim: Simulation, buildingId: number, unitId: number, completions: number[]): void {
    sim.runUntil(() => !demandOf(sim, buildingId) && sim.services.unitCommitments.isIdle(unitId), {
        maxTicks: 30_000,
        label: 'workplace filled',
        diagnose: () =>
            `demand=${JSON.stringify(demandOf(sim, buildingId))} ` +
            `commitment=${JSON.stringify(sim.services.unitCommitments.get(unitId))}`,
    });
    sim.runTicks(100);
    expect(sim.services.workerAssignments.getAssignedBuilding(unitId)).toBe(buildingId);
    expect(completions).toEqual([unitId]);
}

function trackCompletions(sim: Simulation): number[] {
    const completed: number[] = [];
    sim.eventBus.on('settler:taskCompleted', e => {
        if (e.kind === JobKind.WorkplaceDispatch) {
            completed.push(e.unitId);
        }
    });
    return completed;
}

describe('Workplace dispatch ownership', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        restored?.destroy();
        restored = undefined;
        sim?.destroy();
        cleanupSimulation();
    });

    it('specialist dispatch: unreserved WorkplaceDispatch job, demand committed, building filled', () => {
        sim = createSimulation();
        const completions = trackCompletions(sim);
        const { buildingId, unitId } = specialistWalking(sim);

        expect(sim.services.unitCommitments.get(unitId)).toEqual({
            owner: JobKind.WorkplaceDispatch,
            ref: buildingId,
            reserved: false,
            hasJob: true,
        });
        expect(demandOf(sim, buildingId)!.committedUnitId).toBe(unitId);

        runUntilFilled(sim, buildingId, unitId, completions);
        expect(sim.errors).toHaveLength(0);
    });

    it('recruit dispatch: reserved WorkplaceDispatch job through the transform into the building', () => {
        sim = createSimulation();
        const completions = trackCompletions(sim);
        const { buildingId, unitId } = recruitWalking(sim);

        expect(sim.services.unitCommitments.get(unitId)).toEqual({
            owner: JobKind.WorkplaceDispatch,
            ref: buildingId,
            reserved: true,
            hasJob: true,
        });

        runUntilFilled(sim, buildingId, unitId, completions);
        expect(sim.state.getEntityOrThrow(unitId, 'recruit').subType).toBe(UnitType.Woodcutter);
        expect(sim.errors).toHaveLength(0);
    });

    it('specialist saved mid-walk resumes and fills the building; no second specialist dispatched', () => {
        sim = createSimulation();
        const { buildingId, unitId } = specialistWalking(sim);
        const spare = sim.spawnUnit({ x: UNIT_AT.x, y: UNIT_AT.y + 4 }, UnitType.Woodcutter);

        restored = sim.saveAndRestore(0);
        const completions = trackCompletions(restored);

        expect(restored.services.unitCommitments.get(unitId)).toMatchObject({
            owner: JobKind.WorkplaceDispatch,
            ref: buildingId,
            hasJob: true,
        });
        expect(demandOf(restored, buildingId)!.committedUnitId).toBe(unitId);

        runUntilFilled(restored, buildingId, unitId, completions);
        expect(restored.services.workerAssignments.getAssignedBuilding(spare)).toBeNull();
        expect(restored.errors).toHaveLength(0);
    });

    it('recruit saved mid-walk resumes, transforms once and fills the building; the spare carrier stays', () => {
        sim = createSimulation();
        const { buildingId, unitId } = recruitWalking(sim);
        const spare = sim.spawnUnit({ x: UNIT_AT.x, y: UNIT_AT.y + 4 }, UnitType.Carrier);

        restored = sim.saveAndRestore(0);
        const completions = trackCompletions(restored);
        const recruited: number[] = [];
        restored.eventBus.on('unit:recruited', e => recruited.push(e.unitId));

        expect(restored.services.unitCommitments.get(unitId)).toEqual({
            owner: JobKind.WorkplaceDispatch,
            ref: buildingId,
            reserved: true,
            hasJob: true,
        });
        expect(demandOf(restored, buildingId)!.committedUnitId).toBe(unitId);

        runUntilFilled(restored, buildingId, unitId, completions);
        expect(recruited).toEqual([unitId]);
        expect(restored.state.getEntityOrThrow(spare, 'spare carrier').subType).toBe(UnitType.Carrier);
        expect(restored.errors).toHaveLength(0);
    });

    it('specialist killed mid-walk: the demand is re-opened and another specialist is dispatched', () => {
        sim = createSimulation();
        const { buildingId, unitId } = specialistWalking(sim);
        const second = sim.spawnUnit({ x: UNIT_AT.x, y: UNIT_AT.y + 4 }, UnitType.Woodcutter);
        const completions = trackCompletions(sim);

        sim.killUnit(unitId);
        sim.runTicks(1);
        expect(demandOf(sim, buildingId)!.committedUnitId).toBeNull();

        waitForDispatch(sim, second, 'second woodcutter dispatched');
        expect(demandOf(sim, buildingId)!.committedUnitId).toBe(second);
        runUntilFilled(sim, buildingId, second, completions);
        expect(sim.errors).toHaveLength(0);
    });

    it('recruit killed mid-walk: the pile is released and another carrier recruits', () => {
        sim = createSimulation();
        const { buildingId, unitId } = recruitWalking(sim);
        const second = sim.spawnUnit({ x: UNIT_AT.x, y: UNIT_AT.y + 4 }, UnitType.Carrier);
        const completions = trackCompletions(sim);

        sim.killUnit(unitId);
        sim.runTicks(1);
        expect(demandOf(sim, buildingId)!.committedUnitId).toBeNull();

        waitForDispatch(sim, second, 'second carrier dispatched');
        runUntilFilled(sim, buildingId, second, completions);
        expect(sim.state.getEntityOrThrow(second, 'recruit').subType).toBe(UnitType.Woodcutter);
        expect(sim.errors).toHaveLength(0);
    });

    it('building removed mid-walk: the specialist job is cancelled and the unit idles', () => {
        sim = createSimulation();
        const { buildingId, unitId } = specialistWalking(sim);

        sim.execute({ type: 'remove_entity', entityId: buildingId });
        sim.runTicks(1);

        expect(sim.services.unitCommitments.isIdle(unitId)).toBe(true);
        expect(demandOf(sim, buildingId)).toBeUndefined();
        expect(sim.services.workerAssignments.getAssignedBuilding(unitId)).toBeNull();
        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });

    it('building removed mid-walk: the recruit job is cancelled, the carrier stays a carrier, the pile is free', () => {
        sim = createSimulation();
        const { buildingId, unitId, pileId } = recruitWalking(sim);
        const { toolSourceResolver, unitTransformer } = sim.services.getFeature<RecruitExports>('recruit');

        sim.execute({ type: 'remove_entity', entityId: buildingId });
        sim.runTicks(1);

        expect(sim.services.unitCommitments.isIdle(unitId)).toBe(true);
        expect(unitTransformer.isPending(unitId)).toBe(false);
        expect(toolSourceResolver.findNearestToolPile(EMaterialType.AXE, PILE_AT.x, PILE_AT.y, 0)).toMatchObject({
            pileEntityId: pileId,
        });

        sim.runTicks(2_000);
        expect(sim.state.getEntityOrThrow(unitId, 'carrier').subType).toBe(UnitType.Carrier);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });
});
