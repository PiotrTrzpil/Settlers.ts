/**
 * Tests for crowd dispersal (flocking repulsion).
 * Idle units surrounded by >= 3 occupied neighbors gradually spread out
 * to prevent permanent clumping near building entrances or after combat.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, addUnit } from '../helpers/test-game';
import type { GameState } from '@/game/game-state';
import { tileKey } from '@/game/entity';
import { hexDistance, getAllNeighbors } from '@/game/systems/hex-directions';

// ─── Helpers ──────────────────────────────────────────────────────────

function tickFor(state: GameState, seconds: number, dt = 0.1): void {
    const ticks = Math.round(seconds / dt);
    for (let i = 0; i < ticks; i++) {
        state.movement.update(dt);
    }
}

/** Count how many of a unit's hex neighbors are occupied by other units. */
function countOccupiedNeighbors(state: GameState, entityId: number): number {
    const e = state.getEntityOrThrow(entityId, 'neighbor-count');
    const neighbors = getAllNeighbors({ x: e.x, y: e.y });
    let count = 0;
    for (const n of neighbors) {
        const occupant = state.unitOccupancy.get(tileKey(n.x, n.y));
        if (occupant !== undefined && occupant !== entityId) {
            count++;
        }
    }
    return count;
}

/** Create a tight cluster of idle units centered at (cx, cy). Returns all entity IDs. */
function createCluster(state: GameState, cx: number, cy: number): number[] {
    const ids: number[] = [];
    const { entity: center } = addUnit(state, cx, cy);
    ids.push(center.id);

    const neighbors = getAllNeighbors({ x: cx, y: cy });
    for (const n of neighbors) {
        const { entity } = addUnit(state, n.x, n.y);
        ids.push(entity.id);
    }
    return ids;
}

// ─── Crowd dispersal ────────────────────────────────────────────────

describe('Crowd dispersal', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('clustered idle units spread out over time', () => {
        // Create a tight cluster: center + all 6 neighbors (7 units)
        const ids = createCluster(state, 30, 30);

        // Verify the center unit starts crowded
        expect(countOccupiedNeighbors(state, ids[0]!)).toBe(6);

        // Run dispersal for several seconds (cooldown is 0.5-1.0s)
        tickFor(state, 5);

        // After dispersal, the center unit should have fewer occupied neighbors
        // (some units should have moved away)
        const centerNeighbors = countOccupiedNeighbors(state, ids[0]!);
        expect(centerNeighbors).toBeLessThan(6);
    });

    it('non-crowded units do not disperse', () => {
        // Two units with space between them — not crowded
        const { entity: unitA } = addUnit(state, 30, 30);
        const { entity: unitB } = addUnit(state, 32, 30);

        const posA = { x: unitA.x, y: unitA.y };
        const posB = { x: unitB.x, y: unitB.y };

        // Run for a while
        tickFor(state, 3);

        // Neither should have moved (< 3 neighbors occupied)
        expect(unitA.x).toBe(posA.x);
        expect(unitA.y).toBe(posA.y);
        expect(unitB.x).toBe(posB.x);
        expect(unitB.y).toBe(posB.y);
    });

    it('units with active goals do not disperse', () => {
        const ids = createCluster(state, 30, 30);

        // Give the center unit a movement goal
        state.movement.moveUnit(ids[0]!, 40, 30);
        const ctrl = state.movement.getController(ids[0]!)!;
        expect(ctrl.goal).toBeDefined();

        // Even though surrounded, it has a goal — should follow its path, not disperse randomly
        tickFor(state, 3);

        // Unit should be moving toward its goal, not randomly dispersing
        const e = state.getEntityOrThrow(ids[0]!, 'check');
        const distToGoal = hexDistance(e.x, e.y, 40, 30);
        expect(distToGoal).toBeLessThan(hexDistance(30, 30, 40, 30));
    });

    it('busy units do not disperse', () => {
        const ids = createCluster(state, 30, 30);

        // Mark center unit as busy
        const ctrl = state.movement.getController(ids[0]!)!;
        ctrl.busy = true;

        const origPos = { x: 30, y: 30 };

        tickFor(state, 3);

        // Busy unit should not have moved
        const e = state.getEntityOrThrow(ids[0]!, 'check');
        expect(e.x).toBe(origPos.x);
        expect(e.y).toBe(origPos.y);
    });

    it('units on building tiles do not disperse', () => {
        const ids = createCluster(state, 30, 30);

        // Mark center tile as a building
        state.buildingOccupancy.add(tileKey(30, 30));

        tickFor(state, 3);

        // Unit on building tile should stay put
        const e = state.getEntityOrThrow(ids[0]!, 'check');
        expect(e.x).toBe(30);
        expect(e.y).toBe(30);
    });

    it('dispersal maintains occupancy consistency', () => {
        const ids = createCluster(state, 30, 30);

        // Run many ticks, checking occupancy each time
        for (let i = 0; i < 80; i++) {
            state.movement.update(0.1);

            // Verify no two units share a tile
            const positions = new Set<string>();
            for (const id of ids) {
                const e = state.getEntity(id);
                if (!e) continue;
                const key = tileKey(e.x, e.y);
                expect(positions.has(key), `duplicate entity at ${key} on tick ${i}`).toBe(false);
                positions.add(key);

                // Verify occupancy map is consistent
                expect(state.unitOccupancy.get(key), `occupancy mismatch at ${key}`).toBe(id);
            }
        }
    });

    it('cooldown prevents jittering (unit does not move every tick)', () => {
        const ids = createCluster(state, 30, 30);

        // Track how many ticks the first dispersing unit actually moves
        let moveCount = 0;
        let lastPos = { x: 30, y: 30 };

        for (let i = 0; i < 30; i++) {
            state.movement.update(0.1);
            const e = state.getEntityOrThrow(ids[0]!, 'track');
            if (e.x !== lastPos.x || e.y !== lastPos.y) {
                moveCount++;
                lastPos = { x: e.x, y: e.y };
            }
        }

        // 30 ticks at 0.1s = 3 seconds total
        // With 0.5-1.0s cooldown, should move at most ~5 times, not every tick
        expect(moveCount).toBeLessThanOrEqual(6);
    });
});
