/**
 * Tests for pile arrival bump behavior.
 *
 * When carriers arrive at a pile tile:
 *   - They must push idle units standing on the pile tile
 *   - They must NOT push units that are busy (performing pick/put animation)
 *   - They must wait for a busy unit to finish, then push it
 *
 * These tests operate at the MovementSystem level using the busy flag
 * on MovementController, which is set by the choreo system during
 * GET_GOOD/PUT_GOOD animation execution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit, addUnitWithPath } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';
import { tileKey, type Tile } from '@/game/entity';

/** Assert tile occupancy has exactly one entry per unit, matching entity position. */
function assertOccupancyConsistent(state: GameState, entityIds: number[]): void {
    for (const id of entityIds) {
        const e = state.getEntity(id);
        if (!e) continue;
        const key = tileKey(e.x, e.y);
        const occupant = state.unitOccupancy.get(key);
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

// ─── Basic bump behavior ──────────────────────────────────────────

describe('Pile arrival – basic bump behavior', () => {
    let state: GameState;
    const PILE_TILE: Tile = { x: 15, y: 10 };

    beforeEach(() => {
        state = createGameState();
    });

    it('arriving carrier pushes idle unit off the pile tile', () => {
        // Carrier created first → lower ID → can bump higher-ID idle unit
        const { entity: carrier } = addUnit(state, 12, 10);
        const { entity: idleUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        expect(carrier.id).toBeLessThan(idleUnit.id);

        state.movement.moveUnit(carrier.id, PILE_TILE.x, PILE_TILE.y);

        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        expect(carrier.x).toBe(PILE_TILE.x);
        expect(carrier.y).toBe(PILE_TILE.y);
        expect(idleUnit.x !== PILE_TILE.x || idleUnit.y !== PILE_TILE.y).toBe(true);
        assertOccupancyConsistent(state, [carrier.id, idleUnit.id]);
    });

    it('does NOT push a busy unit (pick/put animation in progress)', () => {
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        for (let i = 0; i < 15; i++) {
            state.movement.update(0.1);
        }

        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);
        expect(carrier.x !== PILE_TILE.x || carrier.y !== PILE_TILE.y).toBe(true);
        assertOccupancyConsistent(state, [carrier.id, busyUnit.id]);
    });

    it('carrier waits for busy unit to finish, then pushes it', () => {
        // Carrier created first → lower ID → can bump after busy clears
        const { entity: carrier } = addUnit(state, 12, 10);
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        expect(carrier.id).toBeLessThan(busyUnit.id);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        state.movement.moveUnit(carrier.id, PILE_TILE.x, PILE_TILE.y);

        for (let i = 0; i < 10; i++) {
            state.movement.update(0.1);
        }

        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);

        busyController.busy = false;

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
        }

        expect(carrier.x).toBe(PILE_TILE.x);
        expect(carrier.y).toBe(PILE_TILE.y);
        expect(busyUnit.x !== PILE_TILE.x || busyUnit.y !== PILE_TILE.y).toBe(true);
        assertOccupancyConsistent(state, [carrier.id, busyUnit.id]);
    });

    it('three carriers converging on pile tile take turns via push', () => {
        // c2 and c3 created first (lower IDs) can bump c1 (highest ID, idle on pile)
        const { entity: c2 } = addUnit(state, 12, 10);
        const { entity: c3 } = addUnit(state, 18, 10);
        const { entity: c1 } = addUnit(state, PILE_TILE.x, PILE_TILE.y);

        state.movement.moveUnit(c2.id, PILE_TILE.x, PILE_TILE.y);
        state.movement.moveUnit(c3.id, PILE_TILE.x, PILE_TILE.y);

        const pileOccupants: number[] = [];
        const pileKey = tileKey(PILE_TILE.x, PILE_TILE.y);

        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
            const occupant = state.unitOccupancy.get(pileKey);
            if (
                occupant !== undefined &&
                (pileOccupants.length === 0 || pileOccupants[pileOccupants.length - 1] !== occupant)
            ) {
                pileOccupants.push(occupant);
            }
            assertOccupancyConsistent(state, [c1.id, c2.id, c3.id]);
        }

        const uniqueOccupants = new Set(pileOccupants);
        expect(uniqueOccupants.size).toBeGreaterThanOrEqual(2);
    });
});

// ─── Door bump behavior ──────────────────────────────────────────

describe('Pile arrival – door bump behavior', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('unit walking to door tile pushes idle occupant off the door', () => {
        const DOOR: Tile = { x: 15, y: 10 };

        // Worker created first → lower ID → can bump higher-ID idle unit
        const { entity: worker } = addUnit(state, 12, 10);
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);
        expect(worker.id).toBeLessThan(doorUnit.id);

        state.movement.moveUnit(worker.id, DOOR.x, DOOR.y);

        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);
        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('GO_HOME with ARRIVAL_DIST=1: worker must still push door occupant', () => {
        const DOOR: Tile = { x: 15, y: 10 };

        // Worker created first → lower ID → can bump
        const { entity: worker } = addUnit(state, 12, 10);
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);
        expect(worker.id).toBeLessThan(doorUnit.id);

        state.movement.moveUnit(worker.id, DOOR.x, DOOR.y);

        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
        }

        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);
        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('bump near building: door occupant can be pushed to non-blocked neighbor', () => {
        const blocked = [
            { x: 14, y: 9 },
            { x: 15, y: 9 },
            { x: 16, y: 9 },
            { x: 14, y: 10 },
        ];
        for (const t of blocked) {
            state.buildingOccupancy.add(tileKey(t.x, t.y));
        }

        const DOOR: Tile = { x: 15, y: 10 };

        // Worker created first → lower ID → can bump
        const { entity: worker } = addUnit(state, 15, 13);
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);
        expect(worker.id).toBeLessThan(doorUnit.id);

        state.movement.moveUnit(worker.id, DOOR.x, DOOR.y);

        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);
        expect(state.buildingOccupancy.has(tileKey(doorUnit.x, doorUnit.y))).toBe(false);
        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('busy unit is also not pushed via recursive bump chain', () => {
        const PILE_TILE: Tile = { x: 15, y: 10 };
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        const { entity: middleUnit } = addUnit(state, 14, 10);

        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
        }

        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);
        assertOccupancyConsistent(state, [carrier.id, middleUnit.id, busyUnit.id]);
    });
});
