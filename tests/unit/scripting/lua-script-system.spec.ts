/**
 * Unit tests for LuaScriptSystem — integration of Lua runtime with game state.
 *
 * Tests initialization lifecycle, script loading, tick event dispatch
 * (including FIRST_TICK and FIVE_TICKS semantics), and destruction cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaScriptSystem } from '@/game/scripting/lua-script-system';
import { GameState } from '@/game/game-state';
import { ConstructionSiteManager } from '@/game/features/building-construction';
import { EventBus } from '@/game/event-bus';

describe('LuaScriptSystem', () => {
    let gameState: GameState;
    let scriptSystem: LuaScriptSystem;
    let constructionSiteManager: ConstructionSiteManager;

    beforeEach(() => {
        const eventBus = new EventBus();
        gameState = new GameState(eventBus);
        constructionSiteManager = new ConstructionSiteManager(eventBus, gameState.rng, {} as any);
        scriptSystem = new LuaScriptSystem({
            gameState,
            constructionSiteManager,
            mapWidth: 128,
            mapHeight: 128,
            localPlayer: 0,
            playerCount: 2,
            difficulty: 1,
            debugEnabled: true,
        });
    });

    afterEach(() => {
        scriptSystem.destroy();
    });

    it('should initialize, load scripts, and reject invalid input', () => {
        expect(scriptSystem.ready).toBe(false);
        scriptSystem.initialize();
        expect(scriptSystem.ready).toBe(true);

        // Double init is safe
        expect(() => scriptSystem.initialize()).not.toThrow();

        // Valid script
        expect(scriptSystem.loadScriptCode('function test() return 42 end')).toBe(true);
        expect(scriptSystem.hasScript).toBe(true);

        // Empty and syntax errors rejected
        expect(scriptSystem.loadScriptCode('')).toBe(false);
        expect(scriptSystem.loadScriptCode('if then end')).toBe(false);
    });

    it('should fail to load scripts when not initialized', () => {
        const uninitSystem = new LuaScriptSystem({
            gameState,
            constructionSiteManager,
            mapWidth: 128,
            mapHeight: 128,
        });
        expect(uninitSystem.loadScriptCode('x = 1')).toBe(false);
        uninitSystem.destroy();
    });

    it('should expose required API tables (Game, Settlers, Buildings, Map, Events, etc.)', () => {
        scriptSystem.initialize();
        const tables = ['Game', 'Settlers', 'Buildings', 'Map', 'Goods', 'Events', 'Debug', 'AI'];
        for (const name of tables) {
            scriptSystem.loadScriptCode(`_result_${name} = type(${name})`);
            expect(scriptSystem.getGlobal(`_result_${name}`)).toBe('table');
        }
    });

    it('should dispatch tick events with correct semantics', () => {
        scriptSystem.initialize();
        scriptSystem.loadScriptCode(`
            tickCount = 0
            firstTickNew = false
            firstTickCount = 0
            fiveTickCount = 0

            Events.TICK(function() tickCount = tickCount + 1 end)
            Events.FIRST_TICK_OF_NEW_GAME(function()
                firstTickNew = true
                firstTickCount = firstTickCount + 1
            end)
            Events.FIRST_TICK_OF_NEW_OR_LOADED_GAME(function() end)
            Events.FIVE_TICKS(function() fiveTickCount = fiveTickCount + 1 end)
        `);

        // First tick fires FIRST_TICK events
        scriptSystem.tick(0.016);
        expect(scriptSystem.getGlobal('firstTickNew')).toBe(true);

        // Run 14 more ticks (15 total)
        for (let i = 0; i < 14; i++) {
            scriptSystem.tick(0.016);
        }

        expect(scriptSystem.getGlobal('tickCount')).toBe(15);
        expect(scriptSystem.getGlobal('firstTickCount')).toBe(1); // Only once
        expect(scriptSystem.getGlobal('fiveTickCount')).toBe(3); // Every 5 ticks
    });

    it('should call Lua functions and set/get globals', () => {
        scriptSystem.initialize();
        scriptSystem.loadScriptCode('function add(a, b) return a + b end');
        expect(scriptSystem.callFunction('add', 5, 3)).toBe(8);
        expect(scriptSystem.hasFunction('add')).toBe(true);
        expect(scriptSystem.hasFunction('nonExistent')).toBe(false);

        scriptSystem.setGlobal('testValue', 42);
        expect(scriptSystem.getGlobal('testValue')).toBe(42);
    });

    it('should track game time and clean up on destruction', () => {
        scriptSystem.initialize();
        expect(scriptSystem.time).toBe(0);

        scriptSystem.tick(0.5);
        scriptSystem.tick(0.5);
        expect(scriptSystem.time).toBeCloseTo(1.0);

        scriptSystem.loadScriptCode('x = 1');
        scriptSystem.destroy();
        expect(scriptSystem.ready).toBe(false);
        expect(scriptSystem.hasScript).toBe(false);

        // Safe to destroy again
        expect(() => scriptSystem.destroy()).not.toThrow();
    });
});
