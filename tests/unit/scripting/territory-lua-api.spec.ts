/**
 * Unit tests for territory-backed Lua functions: Game.IsAreaOwned and Map.GetOwner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaScriptSystem } from '@/game/scripting/lua-script-system';
import type { TerritoryQuery } from '@/game/scripting/api/territory-query';
import { GameState } from '@/game/game-state';
import { ConstructionSiteManager, ConstructionWorkerDemands } from '@/game/features/building-construction';
import { EventBus } from '@/game/event-bus';
import { createTestMap } from '../helpers/test-map';

const SIZE = 64;

/** Player 1 owns the square x,y in [10, 30]; everything else is unclaimed. */
const fakeTerritory: TerritoryQuery = {
    getOwner: ({ x, y }) => (x >= 10 && x <= 30 && y >= 10 && y <= 30 ? 1 : -1),
};

describe('Lua territory API', () => {
    let gameState: GameState;
    let constructionSiteManager: ConstructionSiteManager;
    const systems: LuaScriptSystem[] = [];

    function createSystem(territory?: TerritoryQuery): LuaScriptSystem {
        const system = new LuaScriptSystem({
            gameState,
            constructionSiteManager,
            mapWidth: SIZE,
            mapHeight: SIZE,
            territory,
        });
        system.initialize();
        systems.push(system);
        return system;
    }

    function evalLua(system: LuaScriptSystem, expr: string): unknown {
        expect(system.loadScriptCode(`_r = ${expr}`)).toBe(true);
        return system.getGlobal('_r');
    }

    beforeEach(() => {
        const eventBus = new EventBus();
        gameState = new GameState(eventBus, createTestMap(SIZE, SIZE).terrain, () => 0);
        constructionSiteManager = new ConstructionSiteManager(
            eventBus,
            gameState.rng,
            {} as any,
            new ConstructionWorkerDemands(eventBus)
        );
    });

    afterEach(() => {
        for (const s of systems.splice(0)) {
            s.destroy();
        }
    });

    it('Map.GetOwner returns the owning player or -1', () => {
        const sys = createSystem(fakeTerritory);
        expect(evalLua(sys, 'Map.GetOwner(20, 20)')).toBe(1);
        expect(evalLua(sys, 'Map.GetOwner(5, 5)')).toBe(-1);
    });

    it('Game.IsAreaOwned returns 1 only when the whole circle is owned (works with `== 1`)', () => {
        const sys = createSystem(fakeTerritory);
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 20, 20, 5) == 1')).toBe(true);
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 20, 20, 10)')).toBe(1);
        // Circle spills past the owned square
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 20, 20, 11)')).toBe(0);
        // Wrong player
        expect(evalLua(sys, 'Game.IsAreaOwned(2, 20, 20, 1)')).toBe(0);
        // Single tile
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 10, 10, 0)')).toBe(1);
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 9, 10, 0)')).toBe(0);
        // Fully off-map
        expect(evalLua(sys, 'Game.IsAreaOwned(1, -100, -100, 2)')).toBe(0);
    });

    it('falls back to "unowned" when no territory is wired in', () => {
        const sys = createSystem();
        expect(evalLua(sys, 'Map.GetOwner(20, 20)')).toBe(-1);
        expect(evalLua(sys, 'Game.IsAreaOwned(1, 20, 20, 1)')).toBe(0);
    });
});
