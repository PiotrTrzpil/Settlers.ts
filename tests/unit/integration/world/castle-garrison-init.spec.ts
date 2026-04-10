/**
 * Integration test: castle garrison initialization from a real map.
 *
 * Loads MD_roman3.map and verifies that all garrison buildings
 * (GuardTowerSmall, GuardTowerBig, Castle) have garrison state
 * initialized after map loading completes.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { isGarrisonBuildingType } from '@/game/features/tower-garrison/internal/garrison-capacity';
import { getGarrisonSlotPositions } from '@/game/features/tower-garrison/internal/garrison-slot-positions';
import { formatRace } from '@/game/core/race';
import { installRealGameData } from '../../helpers/test-game-data';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');
const MAP_PATH = 'Campaign/MD_roman3.map';

installRealGameData();

function loadMap() {
    const fullPath = path.join(MAP_DIR, MAP_PATH);
    if (!fs.existsSync(fullPath)) return null;

    const buffer = fs.readFileSync(fullPath);
    const reader = new BinaryReader(new Uint8Array(buffer).buffer, 0, null, MAP_PATH);
    return MapLoader.getLoader(reader);
}

describe('Castle garrison init from real map', () => {
    it('all garrison buildings have garrison state after map load', () => {
        const mapLoader = loadMap();
        if (!mapLoader) {
            console.log(`Skipping: ${MAP_PATH} not found at ${MAP_DIR}`);
            return;
        }

        const game = new GameCore(mapLoader);

        const garrisonBuildings = game.state.entities.filter(
            e => e.type === EntityType.Building && isGarrisonBuildingType(e.subType as BuildingType)
        );

        expect(garrisonBuildings.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const b of garrisonBuildings) {
            const garrison = game.services.garrisonManager.getGarrison(b.id);
            if (!garrison) {
                missing.push(`${b.subType} id=${b.id} at (${b.x},${b.y}) player=${b.player}`);
            }
        }

        const byType = new Map<string, number>();
        for (const b of garrisonBuildings) {
            byType.set(b.subType as string, (byType.get(b.subType as string) ?? 0) + 1);
        }
        const breakdown = [...byType.entries()].map(([t, c]) => `${t}=${c}`).join(', ');
        console.log(
            `Garrison buildings: ${garrisonBuildings.length} total (${breakdown}), ` +
                `${missing.length} missing garrison state`
        );
        for (const m of missing) {
            console.log(`  MISSING: ${m}`);
        }

        expect(missing, `Buildings without garrison state:\n${missing.join('\n')}`).toHaveLength(0);

        game.destroy();
    });

    it('castle has garrison slot positions for both swordsmen and bowmen', () => {
        const mapLoader = loadMap();
        if (!mapLoader) {
            console.log(`Skipping: ${MAP_PATH} not found`);
            return;
        }

        const game = new GameCore(mapLoader);

        const castles = game.state.entities.filter(
            e => e.type === EntityType.Building && (e.subType as BuildingType) === BuildingType.Castle
        );
        expect(castles.length).toBeGreaterThan(0);

        for (const castle of castles) {
            const swordsmanSlots = getGarrisonSlotPositions(BuildingType.Castle, castle.race, false);
            const bowmanSlots = getGarrisonSlotPositions(BuildingType.Castle, castle.race, true);

            console.log(
                `Castle id=${castle.id} race=${formatRace(castle.race)}: ` +
                    `swordsman slots=${swordsmanSlots?.length ?? 'NONE'}, ` +
                    `bowman slots=${bowmanSlots?.length ?? 'NONE'}`
            );

            expect(swordsmanSlots, `Castle ${castle.id} has no swordsman slot positions`).toBeDefined();
            expect(bowmanSlots, `Castle ${castle.id} has no bowman slot positions`).toBeDefined();
            expect(swordsmanSlots!.length).toBeGreaterThan(0);
            expect(bowmanSlots!.length).toBeGreaterThan(0);
        }

        game.destroy();
    });
});
