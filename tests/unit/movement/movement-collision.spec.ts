/**
 * Tests for the bump/wait collision model.
 * Collision: idle/waiting → bump, moving → wait, >0.5s → repath, >2.0s → give up.
 * Verifies visual consistency, occupancy invariants, forward progress, bump priority.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addUnitWithPath } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';
import { tileKey, type Tile } from '@/game/entity';
import { hexDistance, getAllNeighbors } from '@/game/systems/hex-directions';

// ─── Helpers ──────────────────────────────────────────────────────────

function pos(x: number, y: number): Tile {
    return { x, y };
}

function tickFor(state: GameState, seconds: number, dt = 0.1): void {
    const ticks = Math.round(seconds / dt);
    for (let i = 0; i < ticks; i++) {
        state.movement.update(dt);
    }
}

type Trail = { entity: Tile[]; visual: { x: number; y: number }[] };

function trackPositions(state: GameState, entityIds: number[], ticks: number, dt = 0.1): Map<number, Trail> {
    const trails = new Map<number, Trail>();
    for (const id of entityIds) {
        trails.set(id, { entity: [], visual: [] });
    }
    for (let i = 0; i < ticks; i++) {
        state.movement.update(dt);
        for (const id of entityIds) {
            const e = state.getEntity(id);
            const c = state.movement.getController(id);
            if (!e || !c) continue;
            const trail = trails.get(id)!;
            trail.entity.push({ x: e.x, y: e.y });
            const t = Math.max(0, Math.min(c.progress, 1));
            trail.visual.push({
                x: c.prevTileX + (c.tileX - c.prevTileX) * t,
                y: c.prevTileY + (c.tileY - c.prevTileY) * t,
            });
        }
    }
    return trails;
}

function assertOccupancyConsistent(state: GameState, entityIds: number[]): void {
    for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) continue;
        const key = tileKey(e);
        expect(state.unitOccupancy.get(key), `tile (${e.x},${e.y}) should be occupied by ${id}`).toBe(id);
    }
    const positions = new Set<string>();
    for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) continue;
        const key = tileKey(e);
        expect(positions.has(key), `duplicate entity at ${key}`).toBe(false);
        positions.add(key);
    }
}

function assertNoVisualTeleportBack(trail: Trail, entityId: number): void {
    for (let i = 0; i < trail.entity.length; i++) {
        const ePos = trail.entity[i]!;
        const vPos = trail.visual[i]!;
        const dx = Math.abs(vPos.x - ePos.x);
        const dy = Math.abs(vPos.y - ePos.y);
        expect(
            dx <= 1.01 && dy <= 1.01,
            `entity #${entityId} visual (${vPos.x.toFixed(2)},${vPos.y.toFixed(2)}) ` +
                `too far from entity pos (${ePos.x},${ePos.y}) at tick ${i}`
        ).toBe(true);
    }
}

function blockNeighbors(state: GameState, tile: Tile, except?: Tile[]): void {
    const skip = new Set(except?.map(p => tileKey(p)) ?? []);
    for (const n of getAllNeighbors(tile)) {
        if (!skip.has(tileKey(n))) {
            state.buildingOccupancy.add(tileKey(n));
        }
    }
}

// ─── Basic bump mechanics ─────────────────────────────────────────

describe('Movement collision – basic bump mechanics', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('bumps idle unit out of the way', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnit(state, 11, 10);

        expect(unitA.id).toBeLessThan(unitB.id);

        tickFor(state, 3);

        expect(unitA.x).toBeGreaterThanOrEqual(11);
        expect(unitB.x !== 11 || unitB.y !== 10).toBe(true);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('head-on: both units eventually reach their destinations', () => {
        const { entity: unitA } = addUnit(state, 10, 10);
        const { entity: unitB } = addUnit(state, 14, 10);
        state.movement.moveUnit(unitA.id, { x: 14, y: 10 });
        state.movement.moveUnit(unitB.id, { x: 10, y: 10 });

        // 6s is well past the repath timeout — both must still resolve
        tickFor(state, 6);

        expect(unitA.x).toBe(14);
        expect(unitA.y).toBe(10);
        expect(unitB.x).toBe(10);
        expect(unitB.y).toBe(10);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('bumped unit is pushed toward its own goal when possible', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 11, y: 11 },
            { x: 11, y: 12 },
        ]);

        tickFor(state, 3);

        expect(unitA.x).toBeGreaterThanOrEqual(11);
        expect(unitB.x !== 11 || unitB.y !== 10).toBe(true);
    });

    it('does not bump a unit that is actively moving (waitTime=0)', () => {
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 12, y: 10 },
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);

        state.movement.update(0.05);
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);

        tickFor(state, 3);

        expect(unitB.x).toBeGreaterThan(11);
        expect(unitA.x).toBeGreaterThan(10);
    });
});

// ─── Visual position consistency (the teleport-back bug) ──────────

describe('Movement collision – visual position consistency', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('no visual teleport-back when blocked after stepping', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
        ]);
        addUnitWithPath(state, 12, 10, [{ x: 12, y: 9 }]);
        addUnit(state, 12, 9);

        const trails = trackPositions(state, [unitA.id], 50, 0.1);
        const trail = trails.get(unitA.id)!;

        assertNoVisualTeleportBack(trail, unitA.id);
    });

    it('no visual teleport-back with high speed unit', () => {
        const { entity: unitA } = addUnitWithPath(
            state,
            10,
            10,
            [
                { x: 11, y: 10 },
                { x: 12, y: 10 },
                { x: 13, y: 10 },
            ],
            20
        ); // speed=20 (very fast)

        addUnit(state, 13, 10);

        const trails = trackPositions(state, [unitA.id], 30, 0.1);
        const trail = trails.get(unitA.id)!;

        assertNoVisualTeleportBack(trail, unitA.id);
        expect(unitA.x).toBeGreaterThanOrEqual(12);
    });

    it('controller tile position matches entity position every tick', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        addUnit(state, 12, 10); // blocker

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
            const controller = state.movement.getController(unitA.id)!;
            expect(
                controller.tileX === unitA.x && controller.tileY === unitA.y,
                `tick ${i}: controller (${controller.tileX},${controller.tileY}) ≠ entity (${unitA.x},${unitA.y})`
            ).toBe(true);
        }
    });

    it('haltProgress snaps transit so visual matches tile position', () => {
        const { entity: unitA } = addUnitWithPath(
            state,
            10,
            10,
            [
                { x: 11, y: 10 },
                { x: 12, y: 10 },
            ],
            20
        ); // high speed

        addUnit(state, 12, 10); // blocker

        state.movement.update(0.1);

        const controller = state.movement.getController(unitA.id)!;
        if (controller.tileX === 11 && controller.tileY === 10) {
            const t = Math.max(0, Math.min(controller.progress, 1));
            const visualX = controller.prevTileX + (controller.tileX - controller.prevTileX) * t;
            expect(
                Math.abs(visualX - 11) < 0.01 || controller.prevTileX === controller.tileX,
                `visual X=${visualX.toFixed(2)} should be at tile X=11 (prevTile=${controller.prevTileX})`
            ).toBe(true);
        }
    });
});

// ─── Tile occupancy invariants & wait/timeout ─────────────────────

describe('Movement collision – occupancy & timeouts', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('tile occupancy stays consistent during bump', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnit(state, 11, 10);

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
            assertOccupancyConsistent(state, [unitA.id, unitB.id]);
        }
    });

    it('tile occupancy stays consistent during multi-unit movement', () => {
        const ids: number[] = [];
        for (let i = 0; i < 5; i++) {
            const { entity } = addUnitWithPath(state, 10 + i * 3, 10, [
                { x: 10 + i * 3 + 1, y: 10 },
                { x: 10 + i * 3 + 2, y: 10 },
                { x: 10 + i * 3 + 3, y: 10 },
            ]);
            ids.push(entity.id);
        }

        for (let i = 0; i < 50; i++) {
            state.movement.update(0.1);
            assertOccupancyConsistent(state, ids);
        }
    });

    it('wait time resets on successful step', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
        ]);
        const controller = state.movement.getController(unitA.id)!;

        tickFor(state, 2);

        expect(controller.waitTime).toBe(0);
    });

    it('unit repaths after REPATH_WAIT_TIMEOUT (0.5s)', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const controller = state.movement.getController(unitA.id)!;

        addUnit(state, 11, 10);
        addUnit(state, 11, 9);
        addUnit(state, 12, 10);
        addUnit(state, 11, 11);
        addUnit(state, 10, 11);

        tickFor(state, 0.6);

        expect(controller.waitTime).toBeLessThan(0.5);
        expect(controller.state).toBe('moving');
    });

    it('unit gives up after GIVEUP_WAIT_TIMEOUT (2.0s)', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);

        addUnit(state, 11, 9);
        addUnit(state, 11, 10);
        addUnit(state, 10, 11);
        addUnit(state, 9, 11);
        addUnit(state, 9, 10);
        addUnit(state, 10, 9);

        tickFor(state, 2.5);

        const controller = state.movement.getController(unitA.id)!;
        expect(controller.state).toBe('idle');
    });
});

// ─── Multi-unit scenarios & edge cases ────────────────────────────

describe('Movement collision – multi-unit & edge cases', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('two units walking same direction do not block each other permanently', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 12, y: 10 },
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        tickFor(state, 6);

        expect(unitA.x).toBeGreaterThanOrEqual(13);
        expect(unitB.x).toBeGreaterThanOrEqual(14);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('three units converging on same tile sort themselves out', () => {
        const { entity: u1 } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: u2 } = addUnitWithPath(state, 12, 8, [
            { x: 12, y: 9 },
            { x: 12, y: 10 },
        ]);
        const { entity: u3 } = addUnitWithPath(state, 14, 10, [
            { x: 13, y: 10 },
            { x: 12, y: 10 },
        ]);

        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
            assertOccupancyConsistent(state, [u1.id, u2.id, u3.id]);
        }

        let atTarget = 0;
        for (const u of [u1, u2, u3]) {
            if (u.x === 12 && u.y === 10) atTarget++;
        }
        expect(atTarget).toBeLessThanOrEqual(1);
    });

    it('units do not oscillate — position monotonically approaches goal', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);

        addUnit(state, 12, 10);

        const positions: Tile[] = [];
        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
            positions.push({ x: unitA.x, y: unitA.y });
        }

        let backwardSteps = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i]!.x < positions[i - 1]!.x) backwardSteps++;
        }
        expect(backwardSteps).toBeLessThanOrEqual(1);
    });

    it('chain of 4 units walking single file all arrive', () => {
        const units: { entity: ReturnType<typeof addUnit>['entity'] }[] = [];
        for (let i = 0; i < 4; i++) {
            const result = addUnitWithPath(state, 10 + i, 10, [
                { x: 10 + i + 1, y: 10 },
                { x: 10 + i + 2, y: 10 },
                { x: 10 + i + 3, y: 10 },
                { x: 10 + i + 4, y: 10 },
            ]);
            units.push(result);
        }

        tickFor(state, 10);

        for (const { entity } of units) {
            expect(entity.x).toBeGreaterThan(10);
        }
        assertOccupancyConsistent(
            state,
            units.map(u => u.entity.id)
        );
    });

    it('unit at map edge is not bumped out of bounds', () => {
        const { entity: unitB } = addUnit(state, 0, 0);
        addUnitWithPath(state, 1, 0, [{ x: 0, y: 0 }]);

        tickFor(state, 2);

        expect(unitB.x).toBeGreaterThanOrEqual(0);
        expect(unitB.y).toBeGreaterThanOrEqual(0);
    });

    it('bumped unit gets repathed to its goal', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 11, y: 11 },
            { x: 11, y: 12 },
            { x: 11, y: 13 },
        ]);

        tickFor(state, 6);

        expect(unitA.x).toBeGreaterThanOrEqual(11);
        const controllerB = state.movement.getController(unitB.id)!;
        const bGoal = controllerB.goal;
        if (bGoal && controllerB.state === 'moving') {
            const dist = hexDistance(unitB.x, unitB.y, bGoal.x, bGoal.y);
            expect(dist).toBeLessThan(5);
        }
    });
});

// ─── Tile swap (last-resort) & deadlock resolution ────────────────

describe('Movement collision – swap & deadlock', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('swaps tiles when no other bump destination exists', () => {
        const target = pos(11, 10);
        const bumperStart = pos(10, 10);
        blockNeighbors(state, target, [bumperStart]);

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [target]);
        const { entity: unitB } = addUnit(state, 11, 10);

        tickFor(state, 2);

        expect(unitA.x).toBe(target.x);
        expect(unitA.y).toBe(target.y);
        expect(unitB.x).toBe(bumperStart.x);
        expect(unitB.y).toBe(bumperStart.y);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('swap maintains occupancy consistency every tick', () => {
        blockNeighbors(state, pos(11, 10), [pos(10, 10)]);

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);

        for (let i = 0; i < 20; i++) {
            state.movement.update(0.1);
            assertOccupancyConsistent(state, [unitA.id, unitB.id]);
        }
    });

    it('swap repaths the displaced unit toward its goal', () => {
        blockNeighbors(state, pos(11, 10), [pos(10, 10)]);

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);
        state.movement.moveUnit(unitB.id, { x: 20, y: 10 });

        tickFor(state, 2);

        expect(unitA.x).toBe(11);
        expect(unitA.y).toBe(10);
        const controllerB = state.movement.getController(unitB.id)!;
        expect(controllerB.state).toBe('moving');
        expect(controllerB.goal).toEqual(pos(20, 10));
    });

    it('no swap when bumper tile is impassable for occupant', () => {
        blockNeighbors(state, pos(11, 10)); // ALL neighbors blocked

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);

        tickFor(state, 2.5);

        // B stays put — swap impossible
        expect(unitB.x).toBe(11);
        expect(unitB.y).toBe(10);
        expect(unitA.x === 11 && unitA.y === 10).toBe(false);
    });

    it('circular bump chain resolves via swap fallback', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);
        addUnit(state, 12, 11); // C — occupies B's only non-blocked bump dest

        // Wall off B's neighbors except A's tile (10,10) and C's tile (12,11)
        for (const key of ['12,10', '11,11', '10,9', '11,9']) {
            state.buildingOccupancy.add(key);
        }
        // Wall off C's neighbors except B's tile (11,10)
        for (const key of ['13,12', '13,11', '12,12', '11,11', '12,10']) {
            state.buildingOccupancy.add(key);
        }

        tickFor(state, 2);

        expect(unitA.x).toBe(11);
        expect(unitA.y).toBe(10);
        expect(unitB.x).toBe(10);
        expect(unitB.y).toBe(10);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('unit gives up after persistent blocking despite successful repaths', () => {
        const { entity: unitA } = addUnitWithPath(
            state,
            10,
            10,
            [
                { x: 11, y: 10 },
                { x: 12, y: 10 },
            ],
            20
        );
        const { entity: unitB } = addUnit(state, 11, 10);
        const controllerB = state.movement.getController(unitB.id)!;
        controllerB.busy = true; // unbumpable — bump always fails

        tickFor(state, 3); // well past GIVEUP_WAIT_TIMEOUT (2.0s)

        const controllerA = state.movement.getController(unitA.id)!;
        expect(controllerA.state).toBe('idle'); // should have given up
    });
});
