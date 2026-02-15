/**
 * Unit tests for LuaScriptSystem
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaScriptSystem } from '@/game/scripting/lua-script-system';
import { GameState } from '@/game/game-state';
import { BuildingStateManager } from '@/game/features/building-construction';
import { EventBus } from '@/game/event-bus';

describe('LuaScriptSystem', () => {
    let gameState: GameState;
    let scriptSystem: LuaScriptSystem;
    let buildingStateManager: BuildingStateManager;

    beforeEach(() => {
        const eventBus = new EventBus();
        gameState = new GameState(eventBus);
        buildingStateManager = new BuildingStateManager({
            entityProvider: gameState,
            eventBus,
        });
        scriptSystem = new LuaScriptSystem({
            gameState,
            buildingStateManager,
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

    describe('initialization', () => {
        it('should initialize successfully', () => {
            scriptSystem.initialize();
            expect(scriptSystem.ready).toBe(true);
        });

        it('should not be ready before initialization', () => {
            expect(scriptSystem.ready).toBe(false);
        });

        it('should handle double initialization gracefully', () => {
            scriptSystem.initialize();
            expect(() => scriptSystem.initialize()).not.toThrow();
        });
    });

    describe('script loading', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should load valid scripts', () => {
            const result = scriptSystem.loadScriptCode(`
                function test()
                    return 42
                end
            `);
            expect(result).toBe(true);
            expect(scriptSystem.hasScript).toBe(true);
        });

        it('should reject invalid scripts', () => {
            const result = scriptSystem.loadScriptCode('');
            expect(result).toBe(false);
        });

        it('should report syntax errors', () => {
            const result = scriptSystem.loadScriptCode('if then end');
            expect(result).toBe(false);
        });

        it('should fail if not initialized', () => {
            const uninitSystem = new LuaScriptSystem({
                gameState,
                buildingStateManager,
                mapWidth: 128,
                mapHeight: 128,
            });
            const result = uninitSystem.loadScriptCode('x = 1');
            expect(result).toBe(false);
            uninitSystem.destroy();
        });
    });

    describe('API availability', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should have Game table', () => {
            scriptSystem.loadScriptCode('result = type(Game)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Settlers table', () => {
            scriptSystem.loadScriptCode('result = type(Settlers)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Buildings table', () => {
            scriptSystem.loadScriptCode('result = type(Buildings)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Map table', () => {
            scriptSystem.loadScriptCode('result = type(Map)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Goods table', () => {
            scriptSystem.loadScriptCode('result = type(Goods)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Events table', () => {
            scriptSystem.loadScriptCode('result = type(Events)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have Debug table', () => {
            scriptSystem.loadScriptCode('result = type(Debug)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });

        it('should have AI table', () => {
            scriptSystem.loadScriptCode('result = type(AI)');
            expect(scriptSystem.getGlobal('result')).toBe('table');
        });
    });

    describe('tick events', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should dispatch TICK event', () => {
            scriptSystem.loadScriptCode(`
                tickCount = 0
                Events.TICK(function()
                    tickCount = tickCount + 1
                end)
            `);

            scriptSystem.tick(0.016);
            scriptSystem.tick(0.016);
            scriptSystem.tick(0.016);

            expect(scriptSystem.getGlobal('tickCount')).toBe(3);
        });

        it('should dispatch FIRST_TICK events on first tick', () => {
            scriptSystem.loadScriptCode(`
                firstTickNew = false
                firstTickLoaded = false
                Events.FIRST_TICK_OF_NEW_GAME(function()
                    firstTickNew = true
                end)
                Events.FIRST_TICK_OF_NEW_OR_LOADED_GAME(function()
                    firstTickLoaded = true
                end)
            `);

            scriptSystem.tick(0.016);

            expect(scriptSystem.getGlobal('firstTickNew')).toBe(true);
            expect(scriptSystem.getGlobal('firstTickLoaded')).toBe(true);
        });

        it('should not dispatch first tick events twice', () => {
            scriptSystem.loadScriptCode(`
                firstTickCount = 0
                Events.FIRST_TICK_OF_NEW_GAME(function()
                    firstTickCount = firstTickCount + 1
                end)
            `);

            scriptSystem.tick(0.016);
            scriptSystem.tick(0.016);
            scriptSystem.tick(0.016);

            expect(scriptSystem.getGlobal('firstTickCount')).toBe(1);
        });

        it('should dispatch FIVE_TICKS every 5 ticks', () => {
            scriptSystem.loadScriptCode(`
                fiveTickCount = 0
                Events.FIVE_TICKS(function()
                    fiveTickCount = fiveTickCount + 1
                end)
            `);

            for (let i = 0; i < 15; i++) {
                scriptSystem.tick(0.016);
            }

            expect(scriptSystem.getGlobal('fiveTickCount')).toBe(3);
        });
    });

    describe('function calls', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should call Lua functions', () => {
            scriptSystem.loadScriptCode(`
                function add(a, b)
                    return a + b
                end
            `);

            const result = scriptSystem.callFunction('add', 5, 3);
            expect(result).toBe(8);
        });

        it('should check if function exists', () => {
            scriptSystem.loadScriptCode('function myFunc() end');
            expect(scriptSystem.hasFunction('myFunc')).toBe(true);
            expect(scriptSystem.hasFunction('nonExistent')).toBe(false);
        });
    });

    describe('globals', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should set and get globals', () => {
            scriptSystem.setGlobal('testValue', 42);
            expect(scriptSystem.getGlobal('testValue')).toBe(42);
        });
    });

    describe('destruction', () => {
        it('should clean up properly', () => {
            scriptSystem.initialize();
            scriptSystem.loadScriptCode('x = 1');

            scriptSystem.destroy();

            expect(scriptSystem.ready).toBe(false);
            expect(scriptSystem.hasScript).toBe(false);
        });

        it('should be safe to destroy multiple times', () => {
            scriptSystem.initialize();
            scriptSystem.destroy();
            expect(() => scriptSystem.destroy()).not.toThrow();
        });
    });

    describe('time tracking', () => {
        beforeEach(() => {
            scriptSystem.initialize();
        });

        it('should track game time', () => {
            expect(scriptSystem.time).toBe(0);

            scriptSystem.tick(0.5);
            expect(scriptSystem.time).toBeCloseTo(0.5);

            scriptSystem.tick(0.5);
            expect(scriptSystem.time).toBeCloseTo(1.0);
        });
    });
});
