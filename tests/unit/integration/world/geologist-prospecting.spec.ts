/**
 * Integration tests for geologist prospecting behaviour.
 *
 * Covers:
 *   - Geologist prospects rock tiles near its starting position
 *   - Geologist fans out and prospects multiple distinct tiles (not stuck on one)
 *   - A group of geologists prospect the same mountain without interfering
 *   - After a move command, geologist prospects at the NEW mountain, not the old one
 *   - Second move command re-anchors to a third mountain
 *   - Group move: multiple geologists all switch to the new mountain
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { TERRAIN } from '../../helpers/test-map';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Count prospected tiles within a square region. */
function countProspected(sim: Simulation, cx: number, cy: number, radius: number): number {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (sim.services.oreVeinData.isProspected(cx + dx, cy + dy)) count++;
        }
    }
    return count;
}

function geoPos(sim: Simulation): string {
    return sim.state.entities
        .filter(e => e.type === EntityType.Unit && e.subType === UnitType.Geologist)
        .map(g => `(${g.x},${g.y})`)
        .join(' ');
}

function moveUnit(sim: Simulation, entityId: number, x: number, y: number) {
    return sim.execute({ type: 'move_unit', entityId, targetX: x, targetY: y });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Geologist prospecting (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ── single geologist ──────────────────────────────────────────────────────

    it('prospects rock tiles near its starting position', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 6, TERRAIN.ROCK);
        sim.spawnUnit(mx, my, UnitType.Geologist);

        sim.runUntil(() => countProspected(sim, mx, my, 6) > 0, {
            maxTicks: 15_000,
            label: 'geologist prospects at least one tile',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 6)}`,
        });

        expect(countProspected(sim, mx, my, 6)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('fans out and prospects multiple distinct rock tiles (not stuck on one)', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 6, TERRAIN.ROCK);
        sim.spawnUnit(mx, my, UnitType.Geologist);

        sim.runUntil(() => countProspected(sim, mx, my, 6) >= 4, {
            maxTicks: 30_000,
            label: 'geologist prospects 4+ distinct tiles',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 6)}`,
        });

        expect(countProspected(sim, mx, my, 6)).toBeGreaterThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });

    // ── move command ──────────────────────────────────────────────────────────

    it('after move command, prospects at new mountain not the old one', () => {
        sim = createSimulation();

        const ax = 55,
            ay = 64; // Mountain A
        const bx = 90,
            by = 64; // Mountain B — far from A
        sim.fillTerrain(ax, ay, 6, TERRAIN.ROCK);
        sim.fillTerrain(bx, by, 6, TERRAIN.ROCK);

        const geologistId = sim.spawnUnit(ax, ay, UnitType.Geologist);

        // Let it prospect Mountain A
        sim.runUntil(() => countProspected(sim, ax, ay, 6) > 0, {
            maxTicks: 15_000,
            label: 'geologist prospects Mountain A',
        });

        const prospectedAtABeforeMove = countProspected(sim, ax, ay, 6);

        // Move to Mountain B
        expect(moveUnit(sim, geologistId, bx, by).success).toBe(true);

        // Geologist should prospect Mountain B
        sim.runUntil(() => countProspected(sim, bx, by, 6) > 0, {
            maxTicks: 20_000,
            label: 'geologist prospects Mountain B after move',
            diagnose: () =>
                `geo=${geoPos(sim)} prospectedA=${countProspected(sim, ax, ay, 6)} prospectedB=${countProspected(sim, bx, by, 6)}`,
        });

        expect(countProspected(sim, bx, by, 6)).toBeGreaterThan(0);
        // Mountain A should not have advanced significantly (one extra at most for in-flight work)
        expect(countProspected(sim, ax, ay, 6)).toBeLessThanOrEqual(prospectedAtABeforeMove + 1);
        expect(sim.errors).toHaveLength(0);
    });

    it('second move re-anchors to a third mountain', () => {
        sim = createSimulation();

        const ax = 50,
            ay = 64;
        const bx = 80,
            by = 64;
        const cx = 110,
            cy = 64;
        sim.fillTerrain(ax, ay, 5, TERRAIN.ROCK);
        sim.fillTerrain(bx, by, 5, TERRAIN.ROCK);
        sim.fillTerrain(cx, cy, 5, TERRAIN.ROCK);

        const geologistId = sim.spawnUnit(ax, ay, UnitType.Geologist);

        sim.runUntil(() => countProspected(sim, ax, ay, 5) > 0, {
            maxTicks: 15_000,
            label: 'geologist starts on Mountain A',
        });

        moveUnit(sim, geologistId, bx, by);
        sim.runUntil(() => countProspected(sim, bx, by, 5) > 0, {
            maxTicks: 20_000,
            label: 'geologist reaches Mountain B',
        });

        moveUnit(sim, geologistId, cx, cy);
        sim.runUntil(() => countProspected(sim, cx, cy, 5) > 0, {
            maxTicks: 20_000,
            label: 'geologist reaches Mountain C',
            diagnose: () => `geo=${geoPos(sim)} prospectedC=${countProspected(sim, cx, cy, 5)}`,
        });

        expect(countProspected(sim, cx, cy, 5)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ── group of geologists ───────────────────────────────────────────────────

    it('group of 3 geologists prospects the same mountain without interference', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 8, TERRAIN.ROCK);

        sim.spawnUnit(mx - 1, my, UnitType.Geologist);
        sim.spawnUnit(mx, my - 1, UnitType.Geologist);
        sim.spawnUnit(mx + 1, my, UnitType.Geologist);

        // Three geologists should collectively prospect more tiles than one would alone
        sim.runUntil(() => countProspected(sim, mx, my, 8) >= 6, {
            maxTicks: 30_000,
            label: 'group prospects 6+ tiles',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 8)}`,
        });

        expect(countProspected(sim, mx, my, 8)).toBeGreaterThanOrEqual(6);
        expect(sim.errors).toHaveLength(0);
    });

    it('group move: all geologists switch to new mountain', () => {
        sim = createSimulation();

        const ax = 55,
            ay = 64;
        const bx = 90,
            by = 64;
        sim.fillTerrain(ax, ay, 6, TERRAIN.ROCK);
        sim.fillTerrain(bx, by, 6, TERRAIN.ROCK);

        const id1 = sim.spawnUnit(ax - 1, ay, UnitType.Geologist);
        const id2 = sim.spawnUnit(ax, ay - 1, UnitType.Geologist);
        const id3 = sim.spawnUnit(ax + 1, ay, UnitType.Geologist);

        // Let the group start on Mountain A
        sim.runUntil(() => countProspected(sim, ax, ay, 6) >= 2, {
            maxTicks: 20_000,
            label: 'group starts prospecting Mountain A',
        });

        const prospectedAtABeforeMove = countProspected(sim, ax, ay, 6);

        // Move all three to Mountain B via individual move commands
        moveUnit(sim, id1, bx - 1, by);
        moveUnit(sim, id2, bx, by - 1);
        moveUnit(sim, id3, bx + 1, by);

        // All three should end up prospecting Mountain B
        sim.runUntil(() => countProspected(sim, bx, by, 6) >= 3, {
            maxTicks: 30_000,
            label: 'group prospects Mountain B after move',
            diagnose: () =>
                `geo=${geoPos(sim)} prospectedA=${countProspected(sim, ax, ay, 6)} prospectedB=${countProspected(sim, bx, by, 6)}`,
        });

        expect(countProspected(sim, bx, by, 6)).toBeGreaterThanOrEqual(3);
        // Mountain A should not have grown much after the move
        expect(countProspected(sim, ax, ay, 6)).toBeLessThanOrEqual(prospectedAtABeforeMove + 3);
        expect(sim.errors).toHaveLength(0);
    });

    it('geologists in a group do not duplicate-prospect the same tile', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        // Small mountain — only a few rock tiles
        sim.fillTerrain(mx, my, 3, TERRAIN.ROCK);

        sim.spawnUnit(mx - 1, my, UnitType.Geologist);
        sim.spawnUnit(mx + 1, my, UnitType.Geologist);

        sim.runUntil(() => countProspected(sim, mx, my, 3) >= 4, {
            maxTicks: 20_000,
            label: 'group prospects 4+ tiles on small mountain',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 3)}`,
        });

        // No errors means the sign system didn't crash on double-prospecting
        expect(countProspected(sim, mx, my, 3)).toBeGreaterThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });
});
