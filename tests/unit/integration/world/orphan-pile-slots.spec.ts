/**
 * Integration test: verify all StackedPile entities have inventory slots.
 *
 * Reproduces a bug where pile entities created during map loading lose their
 * inventory slots, causing `getPileKind: unknown pile entity` errors in
 * BuildingDemandSystem → ToolSourceResolver.findNearestToolPile.
 *
 * Uses AO_maya3 (same campaign map as real-map-loading.spec.ts) — not MD_roman4,
 * which is ~3× larger and made full-suite runs hang for many minutes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType } from '@/game/entity';
import { installRealGameData } from '../../helpers/test-game-data';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');
/** Shared with real-map-loading — known to load in seconds, not minutes. */
const MAP_PATH = 'Campaign/AO_maya3.map';

/** ~1s game time — enough for systems to touch piles without multi-minute runs. */
const SHORT_TICK_COUNT = 30;

function loadMap(relativePath: string): GameCore | null {
    const fullPath = path.join(MAP_DIR, relativePath);
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    const buffer = fs.readFileSync(fullPath);
    const reader = new BinaryReader(new Uint8Array(buffer).buffer, 0, null, relativePath);
    const mapLoader = MapLoader.getLoader(reader);
    if (!mapLoader) {
        throw new Error(`Failed to parse map: ${relativePath}`);
    }
    return new GameCore(mapLoader);
}

function findOrphanPiles(game: GameCore): string[] {
    const orphans: string[] = [];
    for (const entity of game.state.entities) {
        if (entity.type !== EntityType.StackedPile) {
            continue;
        }
        const slot = game.services.inventoryManager.getSlotByEntityId(entity.id);
        if (!slot) {
            orphans.push(`#${entity.id} (${entity.subType}) at (${entity.x},${entity.y}) player=${entity.player}`);
        }
    }
    return orphans;
}

function runTicks(game: GameCore, count: number): string[] {
    const dt = 1 / 30;
    const tickSystems = game.getTickSystems();
    const errors: string[] = [];
    for (let tick = 0; tick < count; tick++) {
        for (const { system, group } of tickSystems) {
            try {
                system.tick(dt);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                errors.push(`[tick ${tick}] ${group}: ${msg}`);
            }
        }
    }
    return errors;
}

installRealGameData();

describe('Pile slot integrity after map load', { timeout: 30_000 }, () => {
    let game: GameCore | null = null;

    afterEach(() => {
        game?.destroy();
        game = null;
    });

    it('no orphan piles after map load or a short simulation window', () => {
        game = loadMap(MAP_PATH);
        if (!game) {
            console.log(`Skipping: ${MAP_PATH} not found at ${MAP_DIR}`);
            return;
        }

        const piles = game.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(piles.length).toBeGreaterThan(0);

        let orphans = findOrphanPiles(game);
        expect(orphans, `Orphan piles after init:\n${orphans.join('\n')}`).toHaveLength(0);

        const errors = runTicks(game, SHORT_TICK_COUNT);
        const pileErrors = errors.filter(e => e.includes('getPileKind') || e.includes('unknown pile'));
        expect(pileErrors, `getPileKind errors:\n${pileErrors.join('\n')}`).toHaveLength(0);

        orphans = findOrphanPiles(game);
        expect(orphans, `Orphan piles after ${SHORT_TICK_COUNT} ticks:\n${orphans.join('\n')}`).toHaveLength(0);
    });
});
