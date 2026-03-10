/**
 * Comprehensive tests for the bump/wait collision model.
 *
 * Collision rules (from movement-simplification design):
 *   - A* always ignores unit occupancy — units path through each other
 *   - When unit A tries to step onto a tile occupied by unit B:
 *     1. If B is idle or waiting → bump B to a free neighbor (lower ID has priority)
 *     2. If B is moving (will leave soon) → wait
 *     3. If waiting > REPATH_WAIT_TIMEOUT (0.5s) → repath from current position
 *     4. If waiting > GIVEUP_WAIT_TIMEOUT (2.0s) → clear path, emit stopped
 *
 * Tests verify:
 *   - Visual position consistency (no teleport-back)
 *   - Tile occupancy consistency (exactly one entity per tile)
 *   - Forward progress (units eventually reach destinations)
 *   - Deterministic bump priority (lower ID always wins)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addUnitWithPath } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';
import { tileKey, type TileCoord } from '@/game/entity';
import { hexDistance, getAllNeighbors } from '@/game/systems/hex-directions';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Shorthand for TileCoord literal. */
function pos(x: number, y: number): TileCoord {
    return { x, y };
}

/** Build a waypoint array from [x,y] pairs. */
function path(...points: [number, number][]): TileCoord[] {
    return points.map(([x, y]) => ({ x, y }));
}

/** Advance the movement system for `seconds` (default dt=0.1s per tick). */
function tickFor(state: GameState, seconds: number, dt = 0.1): void {
    const ticks = Math.round(seconds / dt);
    for (let i = 0; i < ticks; i++) {
        state.movement.update(dt);
    }
}

/** Track entity position and controller visual position every tick. */
function trackPositions(
    state: GameState,
    entityIds: number[],
    ticks: number,
    dt = 0.1
): Map<number, { entity: TileCoord[]; visual: { x: number; y: number }[] }> {
    const trails = new Map<number, { entity: TileCoord[]; visual: { x: number; y: number }[] }>();
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
            // Visual position from controller interpolation
            const t = Math.max(0, Math.min(c.progress, 1));
            trail.visual.push({
                x: c.prevTileX + (c.tileX - c.prevTileX) * t,
                y: c.prevTileY + (c.tileY - c.prevTileY) * t,
            });
        }
    }
    return trails;
}

/** Assert tile occupancy has exactly one entry per unit, matching entity position. */
function assertOccupancyConsistent(state: GameState, entityIds: number[]): void {
    for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) continue;
        const key = tileKey(e.x, e.y);
        const occupant = state.tileOccupancy.get(key);
        expect(occupant, `tile (${e.x},${e.y}) should be occupied by ${id}`).toBe(id);
    }
    // No two entities should share a tile
    const positions = new Set<string>();
    for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) continue;
        const key = tileKey(e.x, e.y);
        expect(positions.has(key), `duplicate entity at ${key}`).toBe(false);
        positions.add(key);
    }
}

/**
 * Assert visual position never "teleports back" — the controller's visual position
 * should match its logical tile position (within ±1 tile of interpolation).
 */
function assertNoVisualTeleportBack(
    trail: { entity: TileCoord[]; visual: { x: number; y: number }[] },
    entityId: number
): void {
    for (let i = 0; i < trail.entity.length; i++) {
        const ePos = trail.entity[i]!;
        const vPos = trail.visual[i]!;
        // Visual must be within 1 tile of entity position (interpolation between prev and current)
        const dx = Math.abs(vPos.x - ePos.x);
        const dy = Math.abs(vPos.y - ePos.y);
        expect(
            dx <= 1.01 && dy <= 1.01,
            `entity #${entityId} visual (${vPos.x.toFixed(2)},${vPos.y.toFixed(2)}) ` +
                `too far from entity pos (${ePos.x},${ePos.y}) at tick ${i}`
        ).toBe(true);
    }
}

describe('Movement System – bump/wait collision', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    // ═════════════════════════════════════════════════════════════════
    // Basic bump mechanics
    // ═════════════════════════════════════════════════════════════════

    it('bumps idle unit out of the way', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnit(state, 11, 10);

        expect(unitA.id).toBeLessThan(unitB.id);

        tickFor(state, 3);

        // A should have passed through (11,10)
        expect(unitA.x).toBeGreaterThanOrEqual(11);
        // B should have been displaced from (11,10)
        expect(unitB.x !== 11 || unitB.y !== 10).toBe(true);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('head-on: both units eventually reach their destinations', () => {
        // Two units walking straight at each other using pathfinding (like diggers)
        const { entity: unitA } = addUnit(state, 10, 10);
        const { entity: unitB } = addUnit(state, 14, 10);
        state.movement.moveUnit(unitA.id, 14, 10);
        state.movement.moveUnit(unitB.id, 10, 10);

        // 6s is well past the repath timeout — both must still resolve
        tickFor(state, 6);

        expect(unitA.x).toBe(14);
        expect(unitA.y).toBe(10);
        expect(unitB.x).toBe(10);
        expect(unitB.y).toBe(10);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('bumped unit is pushed toward its own goal when possible', () => {
        // A heading east, B idle at (11,10) with goal to the south
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 11, y: 11 },
            { x: 11, y: 12 },
        ]);

        tickFor(state, 3);

        // A should have passed through, B should be displaced southward (toward its goal)
        expect(unitA.x).toBeGreaterThanOrEqual(11);
        // B should have moved — its y should be > 10 (toward goal) or at least displaced
        expect(unitB.x !== 11 || unitB.y !== 10).toBe(true);
    });

    it('does not bump a unit that is actively moving (waitTime=0)', () => {
        // B starts first, actively moves east
        const { entity: unitB } = addUnitWithPath(state, 11, 10, [
            { x: 12, y: 10 },
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);

        // Tick once so B starts moving (in transit, waitTime=0)
        state.movement.update(0.05);

        // Now A starts, heading toward B's old position
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);

        tickFor(state, 3);

        // B should have continued moving east undisturbed
        expect(unitB.x).toBeGreaterThan(11);
        // A should also have progressed (B moved out of the way naturally)
        expect(unitA.x).toBeGreaterThan(10);
    });

    // ═════════════════════════════════════════════════════════════════
    // Visual position consistency (the teleport-back bug)
    // ═════════════════════════════════════════════════════════════════

    it('no visual teleport-back when blocked after stepping', () => {
        // Unit steps to a tile, then next tile is occupied — visual must not snap back
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
        ]);
        // Block (12,10) with a higher-ID unit that A can't bump (we'll make it move so it
        // has state=moving, waitTime=0 — which prevents bumping)
        addUnitWithPath(state, 12, 10, [
            // Give it a path so it's "moving" but actually stuck against another blocker
            { x: 12, y: 9 },
        ]);
        // Block blocker's path so it stays at (12,10)
        addUnit(state, 12, 9);

        const trails = trackPositions(state, [unitA.id], 50, 0.1);
        const trail = trails.get(unitA.id)!;

        assertNoVisualTeleportBack(trail, unitA.id);
    });

    it('no visual teleport-back with high speed unit', () => {
        // High speed means progress accumulates fast — unit might step multiple tiles per tick
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

        // Block at (13,10)
        addUnit(state, 13, 10);

        const trails = trackPositions(state, [unitA.id], 30, 0.1);
        const trail = trails.get(unitA.id)!;

        assertNoVisualTeleportBack(trail, unitA.id);
        // A should have reached at least (12,10) before being blocked
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

    // ═════════════════════════════════════════════════════════════════
    // Tile occupancy invariants
    // ═════════════════════════════════════════════════════════════════

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

    // ═════════════════════════════════════════════════════════════════
    // Wait and timeout behavior
    // ═════════════════════════════════════════════════════════════════

    it('wait time resets on successful step', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
            { x: 13, y: 10 },
        ]);
        const controller = state.movement.getController(unitA.id)!;

        tickFor(state, 2);

        // Open terrain — wait time should always be 0
        expect(controller.waitTime).toBe(0);
    });

    it('unit repaths after REPATH_WAIT_TIMEOUT (0.5s)', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);
        const controller = state.movement.getController(unitA.id)!;

        // Surround (11,10) so bump always fails — A has lower ID but ALL
        // neighbors of the blocker are also occupied
        addUnit(state, 11, 10);
        addUnit(state, 11, 9);
        addUnit(state, 12, 10);
        addUnit(state, 11, 11);
        addUnit(state, 10, 11);

        // Tick for 0.6s — past REPATH_WAIT_TIMEOUT
        tickFor(state, 0.6);

        // After repath, waitTime should have been reset
        expect(controller.waitTime).toBeLessThan(0.5);
        // But unit should still be trying (not given up)
        expect(controller.state).toBe('moving');
    });

    it('unit gives up after GIVEUP_WAIT_TIMEOUT (2.0s)', () => {
        const { entity: unitA } = addUnitWithPath(state, 10, 10, [
            { x: 11, y: 10 },
            { x: 12, y: 10 },
        ]);

        // Box in with 6 units on all neighbors — A has lowest ID so it CAN
        // bump them, but their neighbors are also full (all 6 surrounding tiles occupied)
        addUnit(state, 11, 9);
        addUnit(state, 11, 10);
        addUnit(state, 10, 11);
        addUnit(state, 9, 11);
        addUnit(state, 9, 10);
        addUnit(state, 10, 9);

        // Tick for over 2.0s
        tickFor(state, 2.5);

        const controller = state.movement.getController(unitA.id)!;
        expect(controller.state).toBe('idle');
    });

    // ═════════════════════════════════════════════════════════════════
    // Multi-unit scenarios
    // ═════════════════════════════════════════════════════════════════

    it('two units walking same direction do not block each other permanently', () => {
        // A behind B, both heading east
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

        // Both should have reached their destinations or close
        expect(unitA.x).toBeGreaterThanOrEqual(13);
        expect(unitB.x).toBeGreaterThanOrEqual(14);
        assertOccupancyConsistent(state, [unitA.id, unitB.id]);
    });

    it('three units converging on same tile sort themselves out', () => {
        // Three units from different directions, all wanting to reach (12,10)
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

        // At most one unit can be at (12,10); others should have been bumped or repathed
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

        // Place a blocker that A can't easily bump (higher ID but surrounded)
        addUnit(state, 12, 10);

        const positions: TileCoord[] = [];
        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
            positions.push({ x: unitA.x, y: unitA.y });
        }

        // Count how many times the unit moves backward (x decreases)
        let backwardSteps = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i]!.x < positions[i - 1]!.x) backwardSteps++;
        }
        // At most 1 backward step is acceptable (from a bump displacement)
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

        // All should have advanced significantly
        for (const { entity } of units) {
            expect(entity.x).toBeGreaterThan(10);
        }
        assertOccupancyConsistent(
            state,
            units.map(u => u.entity.id)
        );
    });

    // ═════════════════════════════════════════════════════════════════
    // Edge cases
    // ═════════════════════════════════════════════════════════════════

    it('unit at map edge is not bumped out of bounds', () => {
        // Place unit at edge, blocker tries to bump it
        const { entity: unitB } = addUnit(state, 0, 0);
        addUnitWithPath(state, 1, 0, [{ x: 0, y: 0 }]);

        // The mover has higher ID than B (created after), so it cannot bump B
        // Verify B stays in bounds regardless
        tickFor(state, 2);

        // B should still be in bounds
        expect(unitB.x).toBeGreaterThanOrEqual(0);
        expect(unitB.y).toBeGreaterThanOrEqual(0);
    });

    it('bumped unit gets repathed to its goal', () => {
        // A heading east, B at (11,10) with path to (11,15)
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

        // A should have passed through (11,10)
        expect(unitA.x).toBeGreaterThanOrEqual(11);
        // B should still be heading toward its goal (not lost in space)
        const controllerB = state.movement.getController(unitB.id)!;
        const bGoal = controllerB.goal;
        if (bGoal && controllerB.state === 'moving') {
            // B should be making progress toward its goal
            const dist = hexDistance(unitB.x, unitB.y, bGoal.x, bGoal.y);
            expect(dist).toBeLessThan(5); // Should be getting closer
        }
    });

    // ═════════════════════════════════════════════════════════════════
    // Tile swap (last-resort)
    // ═════════════════════════════════════════════════════════════════

    /** Block all hex neighbors of a tile with buildings, optionally excluding some. */
    function blockNeighbors(pos: TileCoord, except?: TileCoord[]): void {
        const skip = new Set(except?.map(p => tileKey(p.x, p.y)) ?? []);
        for (const n of getAllNeighbors(pos)) {
            if (!skip.has(tileKey(n.x, n.y))) {
                state.buildingOccupancy.add(tileKey(n.x, n.y));
            }
        }
    }

    it('swaps tiles when no other bump destination exists', () => {
        const target = pos(11, 10);
        const bumperStart = pos(10, 10);
        blockNeighbors(target, [bumperStart]);

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
        blockNeighbors(pos(11, 10), [pos(10, 10)]);

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);

        for (let i = 0; i < 20; i++) {
            state.movement.update(0.1);
            assertOccupancyConsistent(state, [unitA.id, unitB.id]);
        }
    });

    it('swap repaths the displaced unit toward its goal', () => {
        blockNeighbors(pos(11, 10), [pos(10, 10)]);

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);
        state.movement.moveUnit(unitB.id, 20, 10);

        tickFor(state, 2);

        expect(unitA.x).toBe(11);
        expect(unitA.y).toBe(10);
        const controllerB = state.movement.getController(unitB.id)!;
        expect(controllerB.state).toBe('moving');
        expect(controllerB.goal).toEqual(pos(20, 10));
    });

    it('no swap when bumper tile is impassable for occupant', () => {
        blockNeighbors(pos(11, 10)); // ALL neighbors blocked

        const { entity: unitA } = addUnitWithPath(state, 10, 10, [pos(11, 10)]);
        const { entity: unitB } = addUnit(state, 11, 10);

        tickFor(state, 2.5);

        // B stays put — swap impossible
        expect(unitB.x).toBe(11);
        expect(unitB.y).toBe(10);
        expect(unitA.x === 11 && unitA.y === 10).toBe(false);
    });

    it('haltProgress snaps transit so visual matches tile position', () => {
        // Unit with fast speed steps to (11,10) then gets blocked at (12,10)
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

        // After one tick, unit should have stepped to (11,10) and be visually there
        state.movement.update(0.1);

        const controller = state.movement.getController(unitA.id)!;
        if (controller.tileX === 11 && controller.tileY === 10) {
            // Controller is at (11,10) — visual must also be there, not at (10,10)
            const t = Math.max(0, Math.min(controller.progress, 1));
            const visualX = controller.prevTileX + (controller.tileX - controller.prevTileX) * t;
            // Visual should be at tile (11,10), not snapped back to prevTile
            expect(
                Math.abs(visualX - 11) < 0.01 || controller.prevTileX === controller.tileX,
                `visual X=${visualX.toFixed(2)} should be at tile X=11 (prevTile=${controller.prevTileX})`
            ).toBe(true);
        }
    });
});
