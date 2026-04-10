/**
 * Integration test: verify all StackedPile entities have inventory slots.
 *
 * Reproduces a bug where pile entities created during map loading lose their
 * inventory slots, causing `getPileKind: unknown pile entity` errors in
 * BuildingDemandSystem → ToolSourceResolver.findNearestToolPile.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType } from '@/game/entity';
import { installRealGameData } from '../../helpers/test-game-data';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');

function loadMap(relativePath: string): GameCore {
    const fullPath = path.join(MAP_DIR, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Map file not found: ${fullPath}`);
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

describe('Pile slot integrity — MD_roman4', { timeout: 60_000 }, () => {
    it('no orphan piles after map load', () => {
        const game = loadMap('Campaign/MD_roman4.map');

        const piles = game.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(piles.length).toBeGreaterThan(0);

        const orphans = findOrphanPiles(game);
        expect(orphans, `Orphan piles after init:\n${orphans.join('\n')}`).toHaveLength(0);

        game.destroy();
    });

    it('no orphan piles after 10s of ticks', () => {
        const game = loadMap('Campaign/MD_roman4.map');

        const errors = runTicks(game, 300);
        const pileErrors = errors.filter(e => e.includes('getPileKind') || e.includes('unknown pile'));
        expect(pileErrors, `getPileKind errors:\n${pileErrors.join('\n')}`).toHaveLength(0);

        const orphans = findOrphanPiles(game);
        expect(orphans, `Orphan piles after ticks:\n${orphans.join('\n')}`).toHaveLength(0);

        game.destroy();
    });

    it('no orphan piles after 100s of ticks', () => {
        const game = loadMap('Campaign/MD_roman4.map');

        const errors = runTicks(game, 3000);
        const pileErrors = errors.filter(e => e.includes('getPileKind') || e.includes('unknown pile'));
        expect(pileErrors, `getPileKind errors:\n${pileErrors.join('\n')}`).toHaveLength(0);

        const orphans = findOrphanPiles(game);
        expect(orphans, `Orphan piles after 3000 ticks:\n${orphans.join('\n')}`).toHaveLength(0);

        game.destroy();
    });
});
