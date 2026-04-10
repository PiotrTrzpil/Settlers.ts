/**
 * Integration test: execute StartResources.txt Lua script on a real map.
 *
 * Loads a real map via GameCore, wires up LuaScriptSystem with the game's
 * command pipeline, reads StartResources.txt from disk, and calls each
 * CreateStartResources* function for every player. Asserts exact settler
 * counts and verifies buildings/piles are created.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapLoader } from '@/resources/map/map-loader';
import { GameCore } from '@/game/game-core';
import { EntityType, UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings/building-type';
import { LuaScriptSystem } from '@/game/scripting/lua-script-system';
import { installRealGameData } from '../../helpers/test-game-data';

const MAP_DIR = path.resolve(__dirname, '../../../../public/Siedler4/Map');
const SCRIPT_PATH = path.resolve(__dirname, '../../../../public/Siedler4/Script/Internal/StartResources.txt');

const TEST_MAP = 'Campaign/AO_maya3.map';

installRealGameData();

function loadMap(relativePath: string) {
    const fullPath = path.join(MAP_DIR, relativePath);
    if (!fs.existsSync(fullPath)) return null;
    const buffer = fs.readFileSync(fullPath);
    const reader = new BinaryReader(new Uint8Array(buffer).buffer, 0, null, relativePath);
    return MapLoader.getLoader(reader);
}

function readScript(): string | null {
    if (!fs.existsSync(SCRIPT_PATH)) return null;
    return fs.readFileSync(SCRIPT_PATH, 'utf-8');
}

function createScriptSystem(game: GameCore): LuaScriptSystem {
    const system = new LuaScriptSystem({
        gameState: game.state,
        constructionSiteManager: game.services.constructionSiteManager,
        mapWidth: game.terrain.width,
        mapHeight: game.terrain.height,
        playerRaces: game.playerRaces,
        executeCommand: game.execute.bind(game),
    });
    system.initialize();
    return system;
}

function countPlayerEntities(game: GameCore, playerIndex: number) {
    const entities = game.state.entities.filter(e => e.player === playerIndex);

    const unitsByType = new Map<UnitType, number>();
    for (const u of entities) {
        if (u.type !== EntityType.Unit) continue;
        const t = u.subType as UnitType;
        unitsByType.set(t, (unitsByType.get(t) ?? 0) + 1);
    }

    return {
        buildings: entities.filter(e => e.type === EntityType.Building).length,
        piles: entities.filter(e => e.type === EntityType.StackedPile).length,
        guardTowers: entities.filter(
            e =>
                e.type === EntityType.Building &&
                (e.subType === BuildingType.GuardTowerSmall || e.subType === BuildingType.GuardTowerBig)
        ).length,
        unitsByType,
    };
}

// Expected settlers per level — values read directly from StartResources.txt.
// Settler counts are identical across all four races per level.
const EXPECTED: Record<string, Partial<Record<UnitType, number>>> = {
    CreateStartResourcesFew: {
        [UnitType.Builder]: 3,
        [UnitType.Digger]: 3,
        [UnitType.Smith]: 1,
        [UnitType.Miner]: 2,
        [UnitType.Carrier]: 16,
        [UnitType.Swordsman1]: 6,
        [UnitType.Bowman1]: 2,
        [UnitType.Geologist]: 2,
    },
    CreateStartResourcesMedium: {
        [UnitType.Builder]: 5,
        [UnitType.Digger]: 5,
        [UnitType.Smith]: 2,
        [UnitType.Miner]: 4,
        [UnitType.Carrier]: 32,
        [UnitType.Swordsman1]: 10,
        [UnitType.Bowman1]: 4,
        [UnitType.Geologist]: 3,
    },
    CreateStartResourcesMany: {
        [UnitType.Builder]: 2,
        [UnitType.Digger]: 2,
        [UnitType.Smith]: 3,
        [UnitType.Miner]: 6,
        [UnitType.Carrier]: 50,
        [UnitType.Swordsman1]: 12,
        [UnitType.Bowman1]: 6,
        [UnitType.Geologist]: 5,
        [UnitType.Donkey]: 3,
        [UnitType.Hunter]: 1,
    },
};

describe('StartResources.txt', () => {
    let game: GameCore | null = null;
    let scriptSystem: LuaScriptSystem | null = null;

    afterEach(() => {
        scriptSystem?.destroy();
        scriptSystem = null;
        game?.destroy();
        game = null;
    });

    for (const [funcName, expectedSettlers] of Object.entries(EXPECTED)) {
        it(`${funcName} spawns correct entities per player`, () => {
            const mapLoader = loadMap(TEST_MAP);
            if (!mapLoader) {
                console.log(`Skipping: ${TEST_MAP} not found`);
                return;
            }

            const scriptCode = readScript();
            if (!scriptCode) {
                console.log(`Skipping: StartResources.txt not found`);
                return;
            }

            game = new GameCore(mapLoader);
            scriptSystem = createScriptSystem(game);
            expect(scriptSystem.loadScriptCode(scriptCode, 'StartResources.txt')).toBe(true);

            const players = mapLoader.entityData!.players.filter(p => p.startX != null && p.startY != null);
            expect(players.length).toBeGreaterThan(0);

            // Snapshot before
            const before = new Map(players.map(p => [p.playerIndex, countPlayerEntities(game!, p.playerIndex)]));

            // Execute
            for (const player of players) {
                scriptSystem.callFunction(funcName, player.startX!, player.startY!, player.playerIndex, 0);
            }

            // Assert per player
            for (const player of players) {
                const pre = before.get(player.playerIndex)!;
                const post = countPlayerEntities(game!, player.playerIndex);
                const label = `P${player.playerIndex}`;

                // Guard tower
                expect(post.guardTowers - pre.guardTowers, `${label}: guard tower`).toBe(1);

                // Piles (count varies by race, just verify some were created)
                expect(post.piles - pre.piles, `${label}: piles`).toBeGreaterThanOrEqual(10);

                // Exact settler counts
                for (const [unitType, count] of Object.entries(expectedSettlers)) {
                    const delta =
                        (post.unitsByType.get(unitType as UnitType) ?? 0) -
                        (pre.unitsByType.get(unitType as UnitType) ?? 0);
                    expect(delta, `${label}: ${unitType}`).toBe(count);
                }
            }
        });
    }
});
