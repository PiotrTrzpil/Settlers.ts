/**
 * Regression: units auto-dispatched to buildings (WORKER_DISPATCH / recruitment goTo)
 * must play walk animation while pathing — same as player-issued move commands.
 *
 * ChoreoBuilder.goTo() creates GO_TO_TARGET nodes with empty jobPart. Without a
 * default walk animation on those nodes, carriers slide without frames.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { EMaterialType } from '@/game/economy/material-type';

installRealGameData();

function getAnim(sim: Simulation, unitId: number) {
    return sim.services.visualService.getState(unitId)?.animation ?? null;
}

function isMoving(sim: Simulation, unitId: number): boolean {
    return sim.state.movement.getController(unitId)?.state === 'moving';
}

describe('Auto-dispatch walk animation (integration)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('carrier auto-dispatched to LookoutTower plays walk animation while moving', () => {
        sim = createSimulation();

        // Carrier far from map center so the tower is a multi-tile walk away
        const carrierId = sim.spawnUnit({ x: 30, y: 30 }, UnitType.Carrier);

        // LookoutTower inhabitant is SETTLER_CARRIER — demand finds idle carrier and issues WORKER_DISPATCH
        const towerId = sim.placeBuilding(BuildingType.LookoutTower, 0, true, undefined, false);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Sanity: tower should be away from the carrier so a walk is required
        const dist = Math.abs(tower.x - 30) + Math.abs(tower.y - 30);
        expect(dist, 'tower should be far enough to require a multi-tick walk').toBeGreaterThan(5);

        sim.runUntil(() => isMoving(sim, carrierId), {
            maxTicks: 5_000,
            label: 'carrier starts walking to lookout tower',
            diagnose: () => {
                const ctrl = sim.state.movement.getController(carrierId);
                const anim = getAnim(sim, carrierId);
                const carrier = sim.state.getEntityOrThrow(carrierId, 'carrier');
                return (
                    `carrier@(${carrier.x},${carrier.y}) move=${ctrl?.state ?? 'none'} ` +
                    `anim=${anim ? `${anim.sequenceKey} playing=${anim.playing} loop=${anim.loop}` : 'none'} ` +
                    `tower@(${tower.x},${tower.y})`
                );
            },
        });

        expect(isMoving(sim, carrierId), 'carrier should be pathing to the lookout tower').toBe(true);

        const anim = getAnim(sim, carrierId);
        expect(anim, 'visual animation state should exist while walking').not.toBeNull();
        expect(anim!.playing, 'walk animation must be playing during auto-dispatch').toBe(true);
        expect(anim!.sequenceKey, 'should use a WALK sequence').toMatch(/WALK/);
        expect(anim!.loop).toBe(true);
    });

    it('specialist auto-dispatched to workplace plays walk animation while moving', () => {
        sim = createSimulation();

        // Idle woodcutter far from center; hut placement without worker triggers WORKER_DISPATCH
        const woodcutterId = sim.spawnUnit({ x: 30, y: 30 }, UnitType.Woodcutter);
        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, true, undefined, false);
        const hut = sim.state.getEntityOrThrow(hutId, 'hut');

        const dist = Math.abs(hut.x - 30) + Math.abs(hut.y - 30);
        expect(dist, 'hut should be far enough to require a multi-tick walk').toBeGreaterThan(5);

        sim.runUntil(() => isMoving(sim, woodcutterId), {
            maxTicks: 5_000,
            label: 'woodcutter starts walking to hut',
            diagnose: () => {
                const ctrl = sim.state.movement.getController(woodcutterId);
                const anim = getAnim(sim, woodcutterId);
                const unit = sim.state.getEntityOrThrow(woodcutterId, 'woodcutter');
                return (
                    `unit@(${unit.x},${unit.y}) move=${ctrl?.state ?? 'none'} ` +
                    `anim=${anim ? `${anim.sequenceKey} playing=${anim.playing} loop=${anim.loop}` : 'none'} ` +
                    `hut@(${hut.x},${hut.y})`
                );
            },
        });

        expect(isMoving(sim, woodcutterId), 'woodcutter should be pathing to the hut').toBe(true);

        const anim = getAnim(sim, woodcutterId);
        expect(anim, 'visual animation state should exist while walking').not.toBeNull();
        expect(anim!.playing, 'walk animation must be playing during auto-dispatch').toBe(true);
        expect(anim!.sequenceKey, 'should use a WALK sequence').toMatch(/WALK/);
        expect(anim!.loop).toBe(true);
    });

    it('player-ordered move still plays walk animation (control)', () => {
        sim = createSimulation();
        const carrierId = sim.spawnUnit({ x: 40, y: 40 }, UnitType.Carrier);

        const result = sim.execute({ type: 'move_unit', entityId: carrierId, targetX: 55, targetY: 55 });
        expect(result.success).toBe(true);

        sim.runUntil(() => isMoving(sim, carrierId), {
            maxTicks: 500,
            label: 'player move starts',
        });

        const anim = getAnim(sim, carrierId);
        expect(anim).not.toBeNull();
        expect(anim!.playing).toBe(true);
        expect(anim!.sequenceKey).toMatch(/WALK/);
    });

    it('auto-recruit walk to tool pile plays walk animation', () => {
        sim = createSimulation();

        // AUTO_RECRUIT: carrier walks to distant axe pile then transforms (empty jobPart goTo)
        const carrierId = sim.spawnUnit({ x: 30, y: 30 }, UnitType.Carrier);
        sim.placeGoodsAt({ x: 70, y: 70 }, EMaterialType.AXE, 1);
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, true, undefined, false);

        sim.runUntil(() => isMoving(sim, carrierId), {
            maxTicks: 5_000,
            label: 'carrier starts walking to axe pile',
            diagnose: () => {
                const ctrl = sim.state.movement.getController(carrierId);
                const anim = getAnim(sim, carrierId);
                return `move=${ctrl?.state ?? 'none'} anim=${anim ? `${anim.sequenceKey} playing=${anim.playing}` : 'none'}`;
            },
        });

        const anim = getAnim(sim, carrierId);
        expect(anim, 'visual animation state should exist while walking to tool pile').not.toBeNull();
        expect(anim!.playing, 'walk animation must be playing during auto-recruit').toBe(true);
        expect(anim!.sequenceKey, 'should use a WALK sequence').toMatch(/WALK/);
        expect(anim!.loop).toBe(true);
    });
});
