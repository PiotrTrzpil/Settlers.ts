/**
 * Unit tests for LuaRuntime — Lua integration boundary tests.
 *
 * Tests JS<->Lua interop (values, functions, tables), error handling,
 * sandboxing (dangerous libraries removed), and destruction lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LuaRuntime } from '@/game/scripting/lua-runtime';

describe('LuaRuntime', () => {
    let runtime: LuaRuntime;

    beforeEach(() => {
        runtime = new LuaRuntime();
    });

    afterEach(() => {
        runtime.destroy();
    });

    it('should execute code, evaluate expressions, and handle errors', () => {
        // Execute
        expect(() => runtime.execute('x = 1 + 1')).not.toThrow();

        // Eval with return
        expect(runtime.eval<number>('1 + 2')).toBe(3);
        expect(runtime.eval<string>('"hello"')).toBe('hello');
        expect(runtime.eval<number>('return 42')).toBe(42);
        expect(runtime.eval('nil')).toBeUndefined();

        // Errors
        expect(() => runtime.execute('if then end')).toThrow(/parse error/i);
        expect(() => runtime.execute('error("test error")')).toThrow(/test error/);
    });

    it('should pass values bidirectionally: globals, arrays, objects', () => {
        // Scalars
        runtime.setGlobal('num', 3.14);
        runtime.setGlobal('str', 'hello');
        runtime.setGlobal('bool', true);
        expect(runtime.getGlobal('num')).toBe(3.14);
        expect(runtime.getGlobal('str')).toBe('hello');
        expect(runtime.getGlobal('bool')).toBe(true);

        // Array (Lua 1-indexed)
        runtime.setGlobal('arr', [1, 2, 3]);
        runtime.execute('result = arr[1] + arr[2] + arr[3]');
        expect(runtime.getGlobal('result')).toBe(6);

        // Object
        runtime.setGlobal('obj', { a: 1, b: 2 });
        runtime.execute('result2 = obj.a + obj.b');
        expect(runtime.getGlobal('result2')).toBe(3);
    });

    it('should call Lua functions and register JS functions callable from Lua', () => {
        // Lua function
        runtime.execute('function add(a, b) return a + b end');
        expect(runtime.callFunction('add', 2, 3)).toBe(5);
        expect(runtime.hasFunction('add')).toBe(true);
        expect(runtime.hasFunction('nonexistent')).toBe(false);
        expect(runtime.callFunction('nonexistent')).toBeUndefined();

        // JS function with args and return value
        let receivedArgs: unknown[] = [];
        runtime.registerGlobalFunction('capture', (...args: unknown[]) => {
            receivedArgs = args;
        });
        runtime.execute('capture(1, "hello", true)');
        expect(receivedArgs).toEqual([1, 'hello', true]);

        runtime.registerGlobalFunction('getAnswer', () => 42);
        runtime.execute('answer = getAnswer()');
        expect(runtime.getGlobal('answer')).toBe(42);
    });

    it('should support table creation and function registration in tables', () => {
        runtime.createTable('Math');
        runtime.setTableField('Math', 'x', 10);
        runtime.registerFunction('Math', 'double', (n: number) => n * 2);

        expect(runtime.eval('type(Math)')).toBe('table');
        expect(runtime.eval<number>('Math.x')).toBe(10);
        expect(runtime.eval<number>('Math.double(5)')).toBe(10);
    });

    it('should sandbox: no os, io, loadfile, dofile; but has math, string, table', () => {
        expect(runtime.eval('os')).toBeUndefined();
        expect(runtime.eval('io')).toBeUndefined();
        expect(runtime.eval('loadfile')).toBeUndefined();
        expect(runtime.eval('dofile')).toBeUndefined();

        expect(runtime.eval('type(math)')).toBe('table');
        expect(runtime.eval('type(string)')).toBe('table');
        expect(runtime.eval('type(table)')).toBe('table');
    });

    it('should throw when used after destruction, and handle double destroy', () => {
        runtime.destroy();
        expect(() => runtime.execute('x = 1')).toThrow(/destroyed/i);
        expect(() => runtime.destroy()).not.toThrow();
    });
});
