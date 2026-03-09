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
import { tileKey, type TileCoord } from '@/game/entity';

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

describe('Pile arrival – bump and busy behavior', () => {
    let state: GameState;
    const PILE_TILE: TileCoord = { x: 15, y: 10 };

    beforeEach(() => {
        state = createGameState();
    });

    it('arriving carrier pushes idle unit off the pile tile', () => {
        // Idle unit standing on the pile tile
        const { entity: idleUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);

        // Carrier approaching from the left, destination = pile tile
        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        // Run enough ticks for the carrier to reach the pile
        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        // Carrier should have reached the pile tile
        expect(carrier.x).toBe(PILE_TILE.x);
        expect(carrier.y).toBe(PILE_TILE.y);

        // Idle unit should have been bumped off
        expect(idleUnit.x !== PILE_TILE.x || idleUnit.y !== PILE_TILE.y).toBe(true);

        assertOccupancyConsistent(state, [carrier.id, idleUnit.id]);
    });

    it('does NOT push a busy unit (pick/put animation in progress)', () => {
        // Busy unit on the pile tile (simulating pick/put animation)
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        // Carrier approaching the pile tile
        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        // Run ticks — carrier should reach adjacent but NOT push the busy unit
        for (let i = 0; i < 15; i++) {
            state.movement.update(0.1);
        }

        // Busy unit must NOT have been displaced
        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);

        // Carrier should be stuck waiting (not on the pile tile)
        expect(carrier.x !== PILE_TILE.x || carrier.y !== PILE_TILE.y).toBe(true);

        assertOccupancyConsistent(state, [carrier.id, busyUnit.id]);
    });

    it('carrier waits for busy unit to finish, then pushes it', () => {
        // Busy unit on pile tile
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        // Carrier approaching
        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        // Phase 1: carrier approaches but can't push the busy unit
        for (let i = 0; i < 10; i++) {
            state.movement.update(0.1);
        }

        // Busy unit still on pile
        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);

        // Phase 2: busy unit finishes animation
        busyController.busy = false;

        // Run more ticks — carrier should now push the idle unit and take the tile
        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
        }

        // Carrier should now be on the pile tile
        expect(carrier.x).toBe(PILE_TILE.x);
        expect(carrier.y).toBe(PILE_TILE.y);

        // Previously busy unit should have been pushed off
        expect(busyUnit.x !== PILE_TILE.x || busyUnit.y !== PILE_TILE.y).toBe(true);

        assertOccupancyConsistent(state, [carrier.id, busyUnit.id]);
    });

    it('three carriers converging on pile tile take turns via push', () => {
        // Carrier 1 starts on the pile tile (will be pushed)
        const { entity: c1 } = addUnit(state, PILE_TILE.x, PILE_TILE.y);

        // Carrier 2 from the left
        const { entity: c2 } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
        ]);

        // Carrier 3 from the right
        const { entity: c3 } = addUnitWithPath(state, 18, 10, [
            { x: 17, y: 10 },
            { x: 16, y: 10 },
            { x: 15, y: 10 },
        ]);

        // Track who occupies the pile tile over time
        const pileOccupants: number[] = [];
        const pileKey = tileKey(PILE_TILE.x, PILE_TILE.y);

        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
            const occupant = state.tileOccupancy.get(pileKey);
            if (occupant !== undefined && (pileOccupants.length === 0 || pileOccupants[pileOccupants.length - 1] !== occupant)) {
                pileOccupants.push(occupant);
            }
            assertOccupancyConsistent(state, [c1.id, c2.id, c3.id]);
        }

        // At least 2 different units should have occupied the pile tile
        // (c1 was there first, then got pushed by c2 or c3)
        const uniqueOccupants = new Set(pileOccupants);
        expect(uniqueOccupants.size).toBeGreaterThanOrEqual(2);
    });

    it('unit walking to door tile pushes idle occupant off the door', () => {
        const DOOR: TileCoord = { x: 15, y: 10 };

        // Idle unit standing on the door tile
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);

        // Worker approaching from the left with path ending at the door tile
        const { entity: worker } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
            { x: 15, y: 10 }, // door tile — last waypoint
        ]);

        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        // Worker should have reached the door tile
        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);

        // Idle unit should have been bumped off the door
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);

        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('GO_HOME with ARRIVAL_DIST=1: worker must still push door occupant', () => {
        const DOOR: TileCoord = { x: 15, y: 10 };

        // Idle unit standing on the door tile
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);

        // Worker starts 3 tiles away, uses moveUnit (pathfinding) to go to the door
        const { entity: worker } = addUnit(state, 12, 10);
        state.movement.moveUnit(worker.id, DOOR.x, DOOR.y);

        // Run movement ticks — worker should pathfind to door and bump the occupant
        for (let i = 0; i < 60; i++) {
            state.movement.update(0.1);
        }

        // Worker should reach the door tile (not stop adjacent)
        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);

        // Door occupant should be pushed off
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);

        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('bump near building: door occupant can be pushed to non-blocked neighbor', () => {
        // Simulate a building's blocked area around the door
        // Door at (15,10), building blocks (14,9), (15,9), (16,9), (14,10) but NOT door itself
        const blocked = [
            { x: 14, y: 9 },
            { x: 15, y: 9 },
            { x: 16, y: 9 },
            { x: 14, y: 10 },
        ];
        for (const t of blocked) {
            state.buildingOccupancy.add(tileKey(t.x, t.y));
        }

        const DOOR: TileCoord = { x: 15, y: 10 };

        // Idle unit on door tile
        const { entity: doorUnit } = addUnit(state, DOOR.x, DOOR.y);

        // Worker approaching from below
        const { entity: worker } = addUnitWithPath(state, 15, 13, [
            { x: 15, y: 12 },
            { x: 15, y: 11 },
            { x: 15, y: 10 },
        ]);

        for (let i = 0; i < 40; i++) {
            state.movement.update(0.1);
        }

        // Worker should reach the door
        expect(worker.x).toBe(DOOR.x);
        expect(worker.y).toBe(DOOR.y);

        // Door occupant bumped to a non-blocked neighbor
        expect(doorUnit.x !== DOOR.x || doorUnit.y !== DOOR.y).toBe(true);

        // Bumped unit must NOT be on a blocked tile
        expect(state.buildingOccupancy.has(tileKey(doorUnit.x, doorUnit.y))).toBe(false);

        assertOccupancyConsistent(state, [worker.id, doorUnit.id]);
    });

    it('busy unit is also not pushed via recursive bump chain', () => {
        // Busy unit on pile tile
        const { entity: busyUnit } = addUnit(state, PILE_TILE.x, PILE_TILE.y);
        const busyController = state.movement.getController(busyUnit.id)!;
        busyController.busy = true;

        // Idle unit adjacent to pile tile (could be chain-bumped into pile tile)
        const { entity: middleUnit } = addUnit(state, 14, 10);

        // Carrier approaching — will try to bump middleUnit, which would chain-bump into busyUnit
        const { entity: carrier } = addUnitWithPath(state, 12, 10, [
            { x: 13, y: 10 },
            { x: 14, y: 10 },
        ]);

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
        }

        // Busy unit must NOT have been displaced
        expect(busyUnit.x).toBe(PILE_TILE.x);
        expect(busyUnit.y).toBe(PILE_TILE.y);

        assertOccupancyConsistent(state, [carrier.id, middleUnit.id, busyUnit.id]);
    });
});
