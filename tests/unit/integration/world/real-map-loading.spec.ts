/**
 * Integration test: load a real campaign map and run it for several seconds.
 *
 * Uses GameCore (headless game engine) directly — the same code path as
 * the browser Game class but without Vue/audio/renderer dependencies.
 *
 * Verifies:
 *   - Map parses and loads without throwing
 *   - Entities (buildings, settlers, trees, stacks) are populated
 *   - Tick systems run without errors for ~10 simulated seconds
 */

import { describe, it, expect, onTestFinished } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType } from '@/game/entity';
import { installRealGameData } from '../../helpers/test-game-data';
import { TimelineRecorder } from '../../helpers/timeline-recorder';
import { wireSimulationTimeline } from '../../helpers/simulation-timeline';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');

let testCounter = 0;

function loadMapFile(relativePath: string) {
    const fullPath = path.join(MAP_DIR, relativePath);
    if (!fs.existsSync(fullPath)) return null;

    const buffer = fs.readFileSync(fullPath);
    const reader = new BinaryReader(new Uint8Array(buffer).buffer, 0, null, relativePath);
    return MapLoader.getLoader(reader);
}

installRealGameData();

/** Run tick systems for ~10 simulated seconds and collect any errors. */
function runAndCollectErrors(game: GameCore, mapName: string) {
    const { width, height } = game.terrain;
    const buildings = game.state.entities.filter(e => e.type === EntityType.Building);
    const units = game.state.entities.filter(e => e.type === EntityType.Unit);
    const mapObjects = game.state.entities.filter(e => e.type === EntityType.MapObject);
    const piles = game.state.entities.filter(e => e.type === EntityType.StackedPile);

    console.log(`\n=== ${mapName} ===`);
    console.log(
        `Map: ${width}x${height} | ` +
            `${buildings.length} buildings, ${units.length} units, ` +
            `${mapObjects.length} objects, ${piles.length} piles`
    );

    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(100);
    expect(buildings.length).toBeGreaterThan(0);
    expect(units.length).toBeGreaterThan(0);

    // Wire timeline recording
    const testId = `realmap_${++testCounter}_${Date.now()}`;
    const timeline = new TimelineRecorder(testId);
    let tickCount = 0;
    wireSimulationTimeline(game.eventBus, timeline, () => tickCount);

    onTestFinished(ctx => {
        const failed = ctx.task.result?.state === 'fail';
        timeline.finalize(failed ? 'failed' : 'passed', tickCount, errors.length);
        timeline.close();
    });

    const dt = 1 / 30;
    const totalTicks = 300; // ~10 seconds at 30fps
    const errors: Array<{ tick: number; error: Error }> = [];
    const tickSystems = game.getTickSystems();

    for (let tick = 0; tick < totalTicks; tick++) {
        tickCount = tick;
        for (const { system, group } of tickSystems) {
            try {
                system.tick(dt);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                errors.push({ tick, error: err });
                timeline.record({ tick, category: 'error', event: group, detail: err.message });
                if (errors.length <= 5) {
                    console.error(`  [tick ${tick}] ${group}: ${err.message}`);
                }
            }
        }
    }

    if (errors.length > 5) {
        console.error(`  ... and ${errors.length - 5} more errors`);
    }

    const postEntities = game.state.entities.length;
    console.log(
        `Run: ${totalTicks} ticks (${(totalTicks * dt).toFixed(1)}s) | ` +
            `${errors.length} errors | ${postEntities} entities after | ` +
            `${timeline.length} timeline entries`
    );

    return errors;
}

const MAPS_TO_TEST = ['Campaign/AO_maya3.map'];

describe('Real map loading', () => {
    it('has maps configured for testing', () => {
        expect(MAPS_TO_TEST.length).toBeGreaterThan(0);
    });

    for (const mapPath of MAPS_TO_TEST) {
        const mapName = mapPath.split('/').pop()!.replace('.map', '');

        it(`${mapName} loads and runs without errors`, () => {
            const mapLoader = loadMapFile(mapPath);
            if (!mapLoader) {
                console.log(`Skipping: ${mapPath} not found at ${MAP_DIR}`);
                return;
            }

            const game = new GameCore(mapLoader);
            const errors = runAndCollectErrors(game, mapName);

            expect(errors).toHaveLength(0);

            game.destroy();
        });
    }
});

describe('Real map: free pile player assignment', () => {
    it('free ground piles belong to the territory owner, not player 0', () => {
        const mapLoader = loadMapFile(MAPS_TO_TEST[0]!);
        if (!mapLoader) {
            console.log(`Skipping: map not found`);
            return;
        }

        const game = new GameCore(mapLoader);
        const piles = game.state.entities.filter(e => e.type === EntityType.StackedPile);

        expect(piles.length).toBeGreaterThan(0);

        // Every free pile in a player's territory should belong to that player
        const misassigned: string[] = [];
        for (const pile of piles) {
            const owner = game.services.territoryManager.getOwner(pile.x, pile.y);
            if (owner > 0 && pile.player !== owner) {
                misassigned.push(
                    `pile #${pile.id} (${pile.subType}) at (${pile.x},${pile.y}): player=${pile.player}, territory=${owner}`
                );
            }
        }

        expect(
            misassigned,
            `${misassigned.length} piles have wrong player:\n${misassigned.slice(0, 5).join('\n')}`
        ).toHaveLength(0);

        game.destroy();
    });
});
