/**
 * Unit tests for LuaRuntime
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

    describe('execute', () => {
        it('should execute simple Lua code', () => {
            expect(() => runtime.execute('x = 1 + 1')).not.toThrow();
        });

        it('should throw on syntax errors', () => {
            expect(() => runtime.execute('if then end')).toThrow(/parse error/i);
        });

        it('should throw on runtime errors', () => {
            expect(() => runtime.execute('error("test error")')).toThrow(/test error/);
        });
    });

    describe('eval', () => {
        it('should evaluate expressions and return results', () => {
            expect(runtime.eval<number>('1 + 2')).toBe(3);
            expect(runtime.eval<string>('"hello"')).toBe('hello');
            expect(runtime.eval<boolean>('true')).toBe(true);
        });

        it('should handle return statements', () => {
            expect(runtime.eval<number>('return 42')).toBe(42);
        });

        it('should handle nil values', () => {
            expect(runtime.eval('nil')).toBeUndefined();
        });
    });

    describe('globals', () => {
        it('should set and get global variables', () => {
            runtime.setGlobal('myVar', 123);
            expect(runtime.getGlobal('myVar')).toBe(123);
        });

        it('should handle different types', () => {
            runtime.setGlobal('num', 3.14);
            runtime.setGlobal('str', 'hello');
            runtime.setGlobal('bool', true);

            expect(runtime.getGlobal('num')).toBe(3.14);
            expect(runtime.getGlobal('str')).toBe('hello');
            expect(runtime.getGlobal('bool')).toBe(true);
        });

        it('should handle arrays', () => {
            runtime.setGlobal('arr', [1, 2, 3]);
            runtime.execute('result = arr[1] + arr[2] + arr[3]');
            expect(runtime.getGlobal('result')).toBe(6);
        });

        it('should handle objects', () => {
            runtime.setGlobal('obj', { a: 1, b: 2 });
            runtime.execute('result = obj.a + obj.b');
            expect(runtime.getGlobal('result')).toBe(3);
        });
    });

    describe('functions', () => {
        it('should call Lua functions', () => {
            runtime.execute('function add(a, b) return a + b end');
            expect(runtime.callFunction('add', 2, 3)).toBe(5);
        });

        it('should return undefined for non-existent functions', () => {
            expect(runtime.callFunction('nonexistent')).toBeUndefined();
        });

        it('should check if function exists', () => {
            runtime.execute('function test() end');
            expect(runtime.hasFunction('test')).toBe(true);
            expect(runtime.hasFunction('nonexistent')).toBe(false);
        });
    });

    describe('table operations', () => {
        it('should create tables', () => {
            runtime.createTable('MyTable');
            expect(runtime.eval('type(MyTable)')).toBe('table');
        });

        it('should set table fields', () => {
            runtime.createTable('T');
            runtime.setTableField('T', 'x', 10);
            runtime.setTableField('T', 'y', 20);
            expect(runtime.eval<number>('T.x')).toBe(10);
            expect(runtime.eval<number>('T.y')).toBe(20);
        });

        it('should register functions in tables', () => {
            runtime.createTable('Math');
            runtime.registerFunction('Math', 'double', (n: number) => n * 2);
            expect(runtime.eval<number>('Math.double(5)')).toBe(10);
        });
    });

    describe('registered functions', () => {
        it('should call JS functions from Lua', () => {
            let called = false;
            runtime.registerGlobalFunction('notify', () => {
                called = true;
            });
            runtime.execute('notify()');
            expect(called).toBe(true);
        });

        it('should pass arguments correctly', () => {
            let receivedArgs: unknown[] = [];
            runtime.registerGlobalFunction('capture', (...args: unknown[]) => {
                receivedArgs = args;
            });
            runtime.execute('capture(1, "hello", true)');
            expect(receivedArgs).toEqual([1, 'hello', true]);
        });

        it('should return values to Lua', () => {
            runtime.registerGlobalFunction('getAnswer', () => 42);
            runtime.execute('answer = getAnswer()');
            expect(runtime.getGlobal('answer')).toBe(42);
        });
    });

    describe('sandboxing', () => {
        it('should not have os library', () => {
            expect(runtime.eval('os')).toBeUndefined();
        });

        it('should not have io library', () => {
            expect(runtime.eval('io')).toBeUndefined();
        });

        it('should not have loadfile', () => {
            expect(runtime.eval('loadfile')).toBeUndefined();
        });

        it('should not have dofile', () => {
            expect(runtime.eval('dofile')).toBeUndefined();
        });

        it('should have safe libraries', () => {
            expect(runtime.eval('type(math)')).toBe('table');
            expect(runtime.eval('type(string)')).toBe('table');
            expect(runtime.eval('type(table)')).toBe('table');
        });
    });

    describe('destruction', () => {
        it('should throw when using destroyed runtime', () => {
            runtime.destroy();
            expect(() => runtime.execute('x = 1')).toThrow(/destroyed/i);
        });

        it('should be safe to destroy multiple times', () => {
            runtime.destroy();
            expect(() => runtime.destroy()).not.toThrow();
        });
    });
});
