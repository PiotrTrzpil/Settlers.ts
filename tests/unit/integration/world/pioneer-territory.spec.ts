/**
 * Integration tests for pioneer territory claiming behaviour.
 *
 * Covers:
 *   - Pioneer idles after spawn until given a move command
 *   - Pioneer claims unclaimed tiles after being sent to a location
 *   - Pioneer claims multiple tiles in sequence (expansion pattern)
 *   - Claimed tiles belong to the pioneer's player
 *   - Pioneer can claim tiles not adjacent to existing territory
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import type { Tile } from '@/game/core/coordinates';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Count tiles owned by a player within a square region. */
function countPlayerTiles(sim: Simulation, cx: number, cy: number, radius: number, player: number): number {
    const tm = sim.services.territoryManager;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (tm.isInTerritory({ x: cx + dx, y: cy + dy }, player)) count++;
        }
    }
    return count;
}

/** Count unclaimed tiles within a square region. */
function countUnclaimedTiles(sim: Simulation, cx: number, cy: number, radius: number): number {
    const tm = sim.services.territoryManager;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (!tm.isInAnyTerritory({ x: cx + dx, y: cy + dy })) count++;
        }
    }
    return count;
}

function moveUnit(sim: Simulation, entityId: number, tile: Tile) {
    return sim.execute({ type: 'move_unit', entityId, targetX: tile.x, targetY: tile.y });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Pioneer territory claiming (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('idles after spawn until given a move command', () => {
        sim = createSimulation({ skipTerritory: true });

        const tx = 70,
            ty = 64;
        sim.spawnUnit({ x: tx, y: ty + 10 }, UnitType.Pioneer);

        // Run for a while — pioneer should NOT claim anything
        sim.runTicks(3_000);
        expect(countPlayerTiles(sim, tx, ty, 10, 0)).toBe(0);
    });

    it('claims unclaimed tiles after being sent to a location', () => {
        sim = createSimulation({ skipTerritory: true });

        const tx = 70,
            ty = 64;
        const id = sim.spawnUnit({ x: tx, y: ty + 10 }, UnitType.Pioneer);

        // Send pioneer to the target area
        expect(moveUnit(sim, id, { x: tx, y: ty }).success).toBe(true);

        // Wait until pioneer claims at least one tile
        sim.runUntil(() => countPlayerTiles(sim, tx, ty, 15, 0) > 0, {
            maxTicks: 20_000,
            label: 'pioneer claims first tile',
        });

        expect(countPlayerTiles(sim, tx, ty, 15, 0)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('claims multiple tiles in sequence', () => {
        sim = createSimulation({ skipTerritory: true });

        const tx = 70,
            ty = 64;
        const id = sim.spawnUnit({ x: tx, y: ty + 10 }, UnitType.Pioneer);

        expect(moveUnit(sim, id, { x: tx, y: ty }).success).toBe(true);

        // Wait until pioneer claims several tiles (pioneers claim slowly — ~10k ticks per tile)
        sim.runUntil(() => countPlayerTiles(sim, tx, ty, 20, 0) >= 3, {
            maxTicks: 120_000,
            label: 'pioneer claims 3+ tiles',
        });

        expect(countPlayerTiles(sim, tx, ty, 20, 0)).toBeGreaterThanOrEqual(3);
        expect(sim.errors).toHaveLength(0);
    });

    it('claimed tiles belong to the correct player', () => {
        sim = createSimulation({ skipTerritory: true });

        const tx = 70,
            ty = 64;
        const player = 1;
        const id = sim.spawnUnit({ x: tx, y: ty + 10 }, UnitType.Pioneer, player);

        expect(moveUnit(sim, id, { x: tx, y: ty }).success).toBe(true);

        sim.runUntil(() => countPlayerTiles(sim, tx, ty, 15, player) > 0, {
            maxTicks: 20_000,
            label: 'pioneer claims tile for player 1',
        });

        // Tiles should belong to player 1, not player 0
        expect(countPlayerTiles(sim, tx, ty, 15, player)).toBeGreaterThan(0);
        expect(countPlayerTiles(sim, tx, ty, 15, 0)).toBe(0);
    });

    it('claims tiles not adjacent to existing territory', () => {
        sim = createSimulation({ skipTerritory: true });

        // Establish territory for player 0 far from where the pioneer will work
        sim.establishTerritory(0);

        // Send pioneer to a distant corner (should be unclaimed)
        const tx = 10,
            ty = 10;
        const initialUnclaimed = countUnclaimedTiles(sim, tx, ty, 5);
        expect(initialUnclaimed).toBeGreaterThan(0);

        const id = sim.spawnUnit({ x: tx, y: ty + 10 }, UnitType.Pioneer);
        expect(moveUnit(sim, id, { x: tx, y: ty }).success).toBe(true);

        sim.runUntil(() => countPlayerTiles(sim, tx, ty, 10, 0) > 0, {
            maxTicks: 20_000,
            label: 'pioneer claims tile away from existing territory',
        });

        expect(countPlayerTiles(sim, tx, ty, 10, 0)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });
});
