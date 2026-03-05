/**
 * Unit tests for LuaEventDispatcher — Lua event system boundary tests.
 *
 * Tests event registration from Lua, dispatch with arguments,
 * multi-handler execution, error resilience, and handler management.
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

    it('should register, dispatch, and count handlers with arguments', () => {
        runtime.execute(`
            tickCount = 0
            receivedX = 0
            receivedY = 0
            Events.TICK(function() tickCount = tickCount + 1 end)
            Events.TICK(function() tickCount = tickCount + 10 end)
            Events.COMMAND(function(x, y)
                receivedX = x
                receivedY = y
            end)
        `);

        expect(dispatcher.hasHandlers('TICK')).toBe(true);
        expect(dispatcher.getHandlerCount('TICK')).toBe(2);

        // Multiple dispatch
        dispatcher.dispatch('TICK');
        dispatcher.dispatch('TICK');
        expect(runtime.getGlobal('tickCount')).toBe(22);

        // Args passed through
        dispatcher.dispatch('COMMAND', 100, 200);
        expect(runtime.getGlobal('receivedX')).toBe(100);
        expect(runtime.getGlobal('receivedY')).toBe(200);

        // Dispatch to unregistered event is safe
        expect(() => dispatcher.dispatch('FIVE_TICKS')).not.toThrow();
    });

    it('should continue dispatching when a handler throws', () => {
        runtime.execute(`
            results = {}
            Events.TICK(function() table.insert(results, 1) end)
            Events.TICK(function() error("test error") end)
            Events.TICK(function() table.insert(results, 3) end)
        `);

        expect(() => dispatcher.dispatch('TICK')).not.toThrow();

        const results = runtime.getGlobal('results') as number[];
        expect(results).toContain(1);
        expect(results).toContain(3);
    });

    it('should clear handlers selectively and globally', () => {
        runtime.execute(`
            Events.TICK(function() end)
            Events.FIVE_TICKS(function() end)
            Events.VICTORY_CONDITION_CHECK(function() end)
        `);

        dispatcher.clearHandlers('TICK');
        expect(dispatcher.hasHandlers('TICK')).toBe(false);
        expect(dispatcher.hasHandlers('FIVE_TICKS')).toBe(true);

        dispatcher.clearAllHandlers();
        expect(dispatcher.hasHandlers('FIVE_TICKS')).toBe(false);
        expect(dispatcher.hasHandlers('VICTORY_CONDITION_CHECK')).toBe(false);
    });
});
