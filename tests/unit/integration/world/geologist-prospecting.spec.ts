/**
 * Integration tests for geologist prospecting behaviour.
 *
 * Covers:
 *   - Geologist idles after spawn until given a move command
 *   - Geologist prospects rock tiles after being sent to a mountain
 *   - Geologist fans out and prospects multiple distinct tiles (not stuck on one)
 *   - A group of geologists prospect the same mountain without interference
 *   - After a move command, geologist prospects at the NEW mountain, not the old one
 *   - Second move command re-anchors to a third mountain
 *   - Group move: multiple geologists all switch to the new mountain
 *   - Tile selection uses ring-sweep pattern (nearby tiles, preferring closer to origin)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType, Tile } from '@/game/entity';
import { TERRAIN } from '../../helpers/test-map';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Count prospected tiles within a square region. */
function countProspected(sim: Simulation, cx: number, cy: number, radius: number): number {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (sim.services.oreVeinData.isProspected({ x: cx + dx, y: cy + dy })) count++;
        }
    }
    return count;
}

/** Collect all prospected tile coords within a square region. */
function getProspectedTiles(sim: Simulation, cx: number, cy: number, radius: number): Tile[] {
    const tiles: Tile[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (sim.services.oreVeinData.isProspected({ x: cx + dx, y: cy + dy })) {
                tiles.push({ x: cx + dx, y: cy + dy });
            }
        }
    }
    return tiles;
}

/**
 * Run simulation and collect the order in which tiles get prospected by polling
 * between tick batches. Returns an ordered list of newly prospected tiles.
 */
function collectProspectingOrder(
    sim: Simulation,
    cx: number,
    cy: number,
    radius: number,
    targetCount: number,
    maxTicks = 60_000
): Tile[] {
    const order: Tile[] = [];
    const seen = new Set<string>();
    const pollInterval = 30;

    for (let tick = 0; tick < maxTicks && order.length < targetCount; tick += pollInterval) {
        sim.runTicks(pollInterval);
        for (const t of getProspectedTiles(sim, cx, cy, radius)) {
            const key = `${t.x},${t.y}`;
            if (!seen.has(key)) {
                seen.add(key);
                order.push(t);
            }
        }
    }
    return order;
}

function dist(a: Tile, b: Tile): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function geoPos(sim: Simulation): string {
    return sim.state.entities
        .filter(e => e.type === EntityType.Unit && e.subType === UnitType.Geologist)
        .map(g => `(${g.x},${g.y})`)
        .join(' ');
}

function moveUnit(sim: Simulation, entityId: number, tile: Tile) {
    return sim.execute({ type: 'move_unit', entityId, targetX: tile.x, targetY: tile.y });
}

/**
 * Spawn a geologist on grass near the mountain, then send it to the mountain center.
 * Offset places the spawn point south of the mountain (on default grass terrain).
 */
function spawnAndSend(sim: Simulation, mx: number, my: number, radius: number, offsetX = 0): number {
    const spawnY = my + radius + 2; // grass below the rock region
    const id = sim.spawnUnit({ x: mx + offsetX, y: spawnY }, UnitType.Geologist);
    expect(moveUnit(sim, id, { x: mx + offsetX, y: my }).success).toBe(true);
    return id;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Geologist prospecting (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ── idle until moved ────────────────────────────────────────────────────

    it('idles after spawn until given a move command', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 6, TERRAIN.ROCK);
        const id = sim.spawnUnit({ x: mx, y: my + 10 }, UnitType.Geologist); // spawn on grass

        // Run for a while — geologist should NOT prospect anything
        sim.runTicks(3_000);
        expect(countProspected(sim, mx, my, 6)).toBe(0);

        // Now send it to the mountain — should start prospecting
        moveUnit(sim, id, { x: mx, y: my });
        sim.runUntil(() => countProspected(sim, mx, my, 6) > 0, {
            maxTicks: 15_000,
            label: 'geologist prospects after move command',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 6)}`,
        });

        expect(countProspected(sim, mx, my, 6)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('does not prospect when move target is far from mountain', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 6, TERRAIN.ROCK);
        // Spawn on grass and move to grass >5 tiles from nearest rock edge
        const grassTarget = my + 6 + 7; // rock edge is my+6, so +7 more = 13 tiles from mountain center
        const id = sim.spawnUnit({ x: mx, y: my + 10 }, UnitType.Geologist);
        moveUnit(sim, id, { x: mx, y: grassTarget });

        sim.runTicks(5_000);
        expect(countProspected(sim, mx, my, 6)).toBe(0);

        // Now move to the mountain — should start prospecting
        moveUnit(sim, id, { x: mx, y: my });
        sim.runUntil(() => countProspected(sim, mx, my, 6) > 0, {
            maxTicks: 20_000,
            label: 'geologist prospects after move to mountain',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 6)}`,
        });

        expect(countProspected(sim, mx, my, 6)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ── single geologist ──────────────────────────────────────────────────────

    it('prospects rock tiles after being sent to a mountain', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 6, TERRAIN.ROCK);
        spawnAndSend(sim, mx, my, 6);

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
        spawnAndSend(sim, mx, my, 6);

        sim.runUntil(() => countProspected(sim, mx, my, 6) >= 4, {
            maxTicks: 30_000,
            label: 'geologist prospects 4+ distinct tiles',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 6)}`,
        });

        expect(countProspected(sim, mx, my, 6)).toBeGreaterThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });
});

describe('Geologist move commands (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('after move command, prospects at new mountain not the old one', () => {
        sim = createSimulation();

        const ax = 55,
            ay = 64;
        const bx = 90,
            by = 64;
        sim.fillTerrain(ax, ay, 6, TERRAIN.ROCK);
        sim.fillTerrain(bx, by, 6, TERRAIN.ROCK);

        const geologistId = spawnAndSend(sim, ax, ay, 6);

        sim.runUntil(() => countProspected(sim, ax, ay, 6) > 0, {
            maxTicks: 15_000,
            label: 'geologist prospects Mountain A',
        });

        const prospectedAtABeforeMove = countProspected(sim, ax, ay, 6);
        expect(moveUnit(sim, geologistId, { x: bx, y: by }).success).toBe(true);

        sim.runUntil(() => countProspected(sim, bx, by, 6) > 0, {
            maxTicks: 20_000,
            label: 'geologist prospects Mountain B after move',
            diagnose: () =>
                `geo=${geoPos(sim)} prospectedA=${countProspected(sim, ax, ay, 6)} prospectedB=${countProspected(sim, bx, by, 6)}`,
        });

        expect(countProspected(sim, bx, by, 6)).toBeGreaterThan(0);
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

        const geologistId = spawnAndSend(sim, ax, ay, 5);

        sim.runUntil(() => countProspected(sim, ax, ay, 5) > 0, {
            maxTicks: 15_000,
            label: 'geologist starts on Mountain A',
        });

        moveUnit(sim, geologistId, { x: bx, y: by });
        sim.runUntil(() => countProspected(sim, bx, by, 5) > 0, {
            maxTicks: 20_000,
            label: 'geologist reaches Mountain B',
        });

        moveUnit(sim, geologistId, { x: cx, y: cy });
        sim.runUntil(() => countProspected(sim, cx, cy, 5) > 0, {
            maxTicks: 20_000,
            label: 'geologist reaches Mountain C',
            diagnose: () => `geo=${geoPos(sim)} prospectedC=${countProspected(sim, cx, cy, 5)}`,
        });

        expect(countProspected(sim, cx, cy, 5)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });
});

describe('Geologist group behavior (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('group of 3 geologists prospects the same mountain without interference', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 8, TERRAIN.ROCK);

        spawnAndSend(sim, mx, my, 8, -1);
        spawnAndSend(sim, mx, my, 8, 0);
        spawnAndSend(sim, mx, my, 8, 1);

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

        const id1 = spawnAndSend(sim, ax, ay, 6, -1);
        const id2 = spawnAndSend(sim, ax, ay, 6, 0);
        const id3 = spawnAndSend(sim, ax, ay, 6, 1);

        sim.runUntil(() => countProspected(sim, ax, ay, 6) >= 2, {
            maxTicks: 20_000,
            label: 'group starts prospecting Mountain A',
        });

        const prospectedAtABeforeMove = countProspected(sim, ax, ay, 6);

        moveUnit(sim, id1, { x: bx - 1, y: by });
        moveUnit(sim, id2, { x: bx, y: by });
        moveUnit(sim, id3, { x: bx + 1, y: by });

        sim.runUntil(() => countProspected(sim, bx, by, 6) >= 3, {
            maxTicks: 30_000,
            label: 'group prospects Mountain B after move',
            diagnose: () =>
                `geo=${geoPos(sim)} prospectedA=${countProspected(sim, ax, ay, 6)} prospectedB=${countProspected(sim, bx, by, 6)}`,
        });

        expect(countProspected(sim, bx, by, 6)).toBeGreaterThanOrEqual(3);
        expect(countProspected(sim, ax, ay, 6)).toBeLessThanOrEqual(prospectedAtABeforeMove + 3);
        expect(sim.errors).toHaveLength(0);
    });

    it('geologists in a group do not duplicate-prospect the same tile', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 3, TERRAIN.ROCK);

        spawnAndSend(sim, mx, my, 3, -1);
        spawnAndSend(sim, mx, my, 3, 1);

        sim.runUntil(() => countProspected(sim, mx, my, 3) >= 4, {
            maxTicks: 20_000,
            label: 'group prospects 4+ tiles on small mountain',
            diagnose: () => `geo=${geoPos(sim)} prospected=${countProspected(sim, mx, my, 3)}`,
        });

        expect(countProspected(sim, mx, my, 3)).toBeGreaterThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });
});

describe('Geologist tile selection pattern (integration)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('prospects tiles in a ring-sweep pattern (nearby tiles, not jumping across mountain)', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 12, TERRAIN.ROCK);
        spawnAndSend(sim, mx, my, 12);

        const order = collectProspectingOrder(sim, mx, my, 12, 15);
        expect(order.length).toBeGreaterThanOrEqual(15);

        const MAX_CONSECUTIVE_DIST = 8;
        const jumps: string[] = [];
        for (let i = 1; i < order.length; i++) {
            const d = dist(order[i - 1]!, order[i]!);
            if (d > MAX_CONSECUTIVE_DIST) {
                jumps.push(
                    `#${i - 1}(${order[i - 1]!.x},${order[i - 1]!.y}) → #${i}(${order[i]!.x},${order[i]!.y}) d=${d.toFixed(1)}`
                );
            }
        }
        // Allow at most 1 long jump (the initial fallback when local search finds nothing)
        expect(jumps.length, `too many long jumps: ${jumps.join('; ')}`).toBeLessThanOrEqual(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('ring-sweep prefers tiles closer to origin over tiles further away', () => {
        sim = createSimulation();

        const mx = 70,
            my = 64;
        sim.fillTerrain(mx, my, 12, TERRAIN.ROCK);
        spawnAndSend(sim, mx, my, 12);

        const order = collectProspectingOrder(sim, mx, my, 12, 12);
        expect(order.length).toBeGreaterThanOrEqual(12);

        const origin = { x: mx, y: my };
        const half = Math.floor(order.length / 2);
        const firstHalfAvgDist = order.slice(0, half).reduce((sum, t) => sum + dist(t, origin), 0) / half;
        const secondHalfAvgDist =
            order.slice(half).reduce((sum, t) => sum + dist(t, origin), 0) / (order.length - half);

        expect(
            firstHalfAvgDist,
            `first half avg dist (${firstHalfAvgDist.toFixed(1)}) should be ≤ second half (${secondHalfAvgDist.toFixed(1)})`
        ).toBeLessThanOrEqual(secondHalfAvgDist);
        expect(sim.errors).toHaveLength(0);
    });
});
