/**
 * Construction jobs ending early — the Construction owner is called directly:
 * - a worker killed on its way (`onUnitRemoved`) releases its demand and tile; the demand is
 *   re-dispatched to another worker;
 * - a player move (`onFailed` 'preempted') releases the demand the same way;
 * - a recruit-digger killed before its transform frees its demand and its shovel;
 * - removing the site cancels its workers' jobs (owner cancel: no failure is reported).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import {
    constructionParamsOf,
    demandOf,
    recruitDiggerDispatched,
    slopedSite,
} from '../../helpers/construction-job-helpers';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { JobKind } from '@/game/systems/choreo';
import type { RecruitExports } from '@/game/features/recruit';

installRealGameData();

/** Ordered job notifications + demand bind/release events of one unit. */
function recordUnit(sim: Simulation, unitId: number): string[] {
    const log: string[] = [];
    sim.eventBus.on('settler:taskFailed', e => e.unitId === unitId && log.push(`failed:${e.reason}`));
    sim.eventBus.on('settler:jobAborted', e => e.unitId === unitId && log.push(`aborted:${e.reason}`));
    sim.eventBus.on('construction:workerReleased', e => e.unitId === unitId && log.push(`released:${e.role}`));
    return log;
}

function recordAssignments(sim: Simulation): number[] {
    const ids: number[] = [];
    sim.eventBus.on('construction:workerAssigned', e => ids.push(e.unitId));
    return ids;
}

function runUntilDigging(sim: Simulation, unitId: number): void {
    sim.runUntil(() => sim.services.jobRunner.getActiveJobId(unitId) === 'DIG_TILE', {
        maxTicks: 10_000,
        label: `${unitId} runs DIG_TILE`,
    });
}

describe('Construction jobs ending early', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('a digger killed on its way releases its demand and tile; another digger takes the demand', () => {
        sim = createSimulation();
        const { siteId, diggers } = slopedSite(sim, { diggers: 1 });
        const digger = diggers[0]!;
        runUntilDigging(sim, digger);
        const log = recordUnit(sim, digger);

        sim.killUnit(digger);

        expect(log).toEqual(['released:digger', 'aborted:unitRemoved']);
        expect(demandOf(sim, siteId, digger)).toBeUndefined();

        const assigned = recordAssignments(sim);
        const replacement = sim.spawnUnitNear(siteId, UnitType.Digger, 1)[0]!;
        sim.runUntil(() => assigned.includes(replacement), { maxTicks: 5_000, label: 'demand re-dispatched' });
        expect(sim.services.unitCommitments.get(replacement)!.owner).toBe(JobKind.Construction);
        expect(sim.errors).toHaveLength(0);
    });

    it('a digger moved by the player is preempted: the demand and its tile are released', () => {
        sim = createSimulation();
        const { siteId, diggers } = slopedSite(sim, { diggers: 1 });
        const digger = diggers[0]!;
        runUntilDigging(sim, digger);
        const log = recordUnit(sim, digger);
        const unit = sim.state.getEntityOrThrow(digger, 'digger');

        expect(sim.execute({ type: 'move_unit', entityId: digger, targetX: unit.x - 4, targetY: unit.y }).success).toBe(
            true
        );

        expect(log).toEqual(['released:digger', 'failed:preempted']);
        expect(demandOf(sim, siteId, digger)).toBeUndefined();
        expect(sim.services.unitCommitments.get(digger)!.owner).toBe('player-move');
        expect(sim.errors).toHaveLength(0);
    });

    it('a recruit-digger killed before its transform frees its demand and its shovel', () => {
        sim = createSimulation();
        const { siteId } = slopedSite(sim, { carriers: 1, shovels: 1 });
        const carrier = recruitDiggerDispatched(sim, siteId);
        expect(constructionParamsOf(sim, carrier).recruit).not.toBeNull();
        const { unitTransformer, toolSourceResolver } = sim.services.getFeature<RecruitExports>('recruit');
        expect(toolSourceResolver.findNearestToolPile(EMaterialType.SHOVEL, 60, 60, 0)).toBeNull();

        sim.killUnit(carrier);

        expect(demandOf(sim, siteId, carrier)).toBeUndefined();
        expect(unitTransformer.isPending(carrier)).toBe(false);
        expect(toolSourceResolver.findNearestToolPile(EMaterialType.SHOVEL, 60, 60, 0)).not.toBeNull();
        expect(sim.errors).toHaveLength(0);
    });

    it('removing the site cancels its workers: no failure reported, the digger idles', () => {
        sim = createSimulation();
        const { siteId, diggers } = slopedSite(sim, { diggers: 1 });
        const digger = diggers[0]!;
        runUntilDigging(sim, digger);
        const log = recordUnit(sim, digger);

        sim.removeBuilding(siteId);

        expect(log).toEqual(['aborted:cancelled', 'released:digger']);
        expect(sim.services.unitCommitments.isIdle(digger)).toBe(true);
        sim.runTicks(300);
        expect(sim.errors).toHaveLength(0);
    });
});
