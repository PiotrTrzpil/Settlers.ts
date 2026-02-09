/**
 * Unit tests for LuaEventDispatcher
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaRuntime } from '@/game/scripting/lua-runtime';
import { LuaEventDispatcher } from '@/game/scripting/event-dispatcher';

describe('LuaEventDispatcher', () => {
    let runtime: LuaRuntime;
    let dispatcher: LuaEventDispatcher;

    beforeEach(() => {
        runtime = new LuaRuntime();
        dispatcher = new LuaEventDispatcher(runtime);
        dispatcher.registerEventsAPI();
    });

    afterEach(() => {
        dispatcher.clearAllHandlers();
        runtime.destroy();
    });

    describe('event registration', () => {
        it('should register event handlers via Lua', () => {
            runtime.execute(`
                Events.TICK(function()
                    tickCalled = true
                end)
            `);
            expect(dispatcher.hasHandlers('TICK')).toBe(true);
        });

        it('should support multiple handlers for same event', () => {
            runtime.execute(`
                counter = 0
                Events.TICK(function() counter = counter + 1 end)
                Events.TICK(function() counter = counter + 10 end)
            `);
            dispatcher.dispatch('TICK');
            expect(runtime.getGlobal('counter')).toBe(11);
        });

        it('should have no handlers initially', () => {
            expect(dispatcher.hasHandlers('TICK')).toBe(false);
            expect(dispatcher.getHandlerCount('TICK')).toBe(0);
        });
    });

    describe('event dispatch', () => {
        it('should call handlers when event is dispatched', () => {
            runtime.execute(`
                tickCount = 0
                Events.TICK(function()
                    tickCount = tickCount + 1
                end)
            `);

            dispatcher.dispatch('TICK');
            expect(runtime.getGlobal('tickCount')).toBe(1);

            dispatcher.dispatch('TICK');
            dispatcher.dispatch('TICK');
            expect(runtime.getGlobal('tickCount')).toBe(3);
        });

        it('should pass arguments to handlers', () => {
            runtime.execute(`
                receivedX = 0
                receivedY = 0
                Events.COMMAND(function(x, y)
                    receivedX = x
                    receivedY = y
                end)
            `);

            dispatcher.dispatch('COMMAND', 100, 200);
            expect(runtime.getGlobal('receivedX')).toBe(100);
            expect(runtime.getGlobal('receivedY')).toBe(200);
        });

        it('should do nothing if no handlers registered', () => {
            expect(() => dispatcher.dispatch('TICK')).not.toThrow();
        });
    });

    describe('handler management', () => {
        it('should clear handlers for specific event', () => {
            runtime.execute(`
                Events.TICK(function() end)
                Events.FIVE_TICKS(function() end)
            `);

            expect(dispatcher.hasHandlers('TICK')).toBe(true);
            expect(dispatcher.hasHandlers('FIVE_TICKS')).toBe(true);

            dispatcher.clearHandlers('TICK');

            expect(dispatcher.hasHandlers('TICK')).toBe(false);
            expect(dispatcher.hasHandlers('FIVE_TICKS')).toBe(true);
        });

        it('should clear all handlers', () => {
            runtime.execute(`
                Events.TICK(function() end)
                Events.FIVE_TICKS(function() end)
                Events.VICTORY_CONDITION_CHECK(function() end)
            `);

            dispatcher.clearAllHandlers();

            expect(dispatcher.hasHandlers('TICK')).toBe(false);
            expect(dispatcher.hasHandlers('FIVE_TICKS')).toBe(false);
            expect(dispatcher.hasHandlers('VICTORY_CONDITION_CHECK')).toBe(false);
        });

        it('should count handlers correctly', () => {
            runtime.execute(`
                Events.TICK(function() end)
                Events.TICK(function() end)
                Events.TICK(function() end)
            `);

            expect(dispatcher.getHandlerCount('TICK')).toBe(3);
        });
    });

    describe('error handling', () => {
        it('should continue to other handlers if one throws', () => {
            runtime.execute(`
                results = {}
                Events.TICK(function() table.insert(results, 1) end)
                Events.TICK(function() error("test error") end)
                Events.TICK(function() table.insert(results, 3) end)
            `);

            // Should not throw, errors are logged
            expect(() => dispatcher.dispatch('TICK')).not.toThrow();

            // First and third handlers should have run
            const results = runtime.getGlobal('results') as number[];
            expect(results).toContain(1);
            expect(results).toContain(3);
        });
    });

    describe('all event types', () => {
        const eventTypes = [
            'TICK',
            'FIVE_TICKS',
            'FIRST_TICK_OF_NEW_GAME',
            'FIRST_TICK_OF_NEW_OR_LOADED_GAME',
            'VICTORY_CONDITION_CHECK',
            'COMMAND',
            'SPACE',
        ];

        eventTypes.forEach(eventType => {
            it(`should support ${eventType} event`, () => {
                runtime.execute(`
                    Events.${eventType}(function()
                        eventFired_${eventType} = true
                    end)
                `);
                expect(dispatcher.hasHandlers(eventType as any)).toBe(true);
            });
        });
    });
});
