import { describe, it, expect, vi } from 'vitest';
import { PersistenceRegistry } from '@/game/persistence';
import type { Persistable } from '@/game/persistence';

function createMockPersistable(key: string, data: unknown) {
    return {
        persistKey: key,
        serialize: () => data,
        deserialize: vi.fn((_data: unknown) => {}),
    } satisfies Persistable;
}

describe('PersistenceRegistry', () => {
    describe('basic registration and serialization', () => {
        it('should serialize a single registered persistable', () => {
            const registry = new PersistenceRegistry();
            const mock = createMockPersistable('trees', [{ id: 1, growth: 3 }]);
            registry.register(mock);

            const snapshot = registry.serializeAll();

            expect(snapshot).toEqual({ trees: [{ id: 1, growth: 3 }] });
        });
    });

    describe('multiple persistables', () => {
        it('should include all registered persistables in serializeAll output', () => {
            const registry = new PersistenceRegistry();
            const trees = createMockPersistable('trees', [{ id: 1 }]);
            const stones = createMockPersistable('stones', [{ id: 2 }]);
            const carriers = createMockPersistable('carriers', [{ id: 3 }]);

            registry.register(trees);
            registry.register(stones);
            registry.register(carriers);

            const snapshot = registry.serializeAll();

            expect(snapshot).toEqual({
                trees: [{ id: 1 }],
                stones: [{ id: 2 }],
                carriers: [{ id: 3 }],
            });
        });
    });

    describe('deserialization', () => {
        it('should call deserialize on each persistable with correct data', () => {
            const registry = new PersistenceRegistry();
            const trees = createMockPersistable('trees', null);
            const stones = createMockPersistable('stones', null);

            registry.register(trees);
            registry.register(stones);

            const snapshot = {
                trees: [{ id: 1, growth: 5 }],
                stones: [{ id: 2, remaining: 8 }],
            };

            registry.deserializeAll(snapshot);

            expect(trees.deserialize).toHaveBeenCalledOnce();
            expect(trees.deserialize).toHaveBeenCalledWith([{ id: 1, growth: 5 }]);
            expect(stones.deserialize).toHaveBeenCalledOnce();
            expect(stones.deserialize).toHaveBeenCalledWith([{ id: 2, remaining: 8 }]);
        });
    });

    describe('topological ordering', () => {
        it('should serialize dependencies before dependents', () => {
            const registry = new PersistenceRegistry();
            const log: string[] = [];

            const a: Persistable = {
                persistKey: 'a',
                serialize: () => {
                    log.push('a');
                    return 'dataA';
                },
                deserialize: () => log.push('restore-a'),
            };

            const b: Persistable = {
                persistKey: 'b',
                serialize: () => {
                    log.push('b');
                    return 'dataB';
                },
                deserialize: () => log.push('restore-b'),
            };

            registry.register(b, ['a']);
            registry.register(a);

            log.length = 0;
            registry.serializeAll();
            expect(log).toEqual(['a', 'b']);

            log.length = 0;
            registry.deserializeAll({ a: 1, b: 2 });
            expect(log).toEqual(['restore-a', 'restore-b']);
        });
    });

    describe('complex dependency chain', () => {
        it('should handle A -> B -> C ordering', () => {
            const registry = new PersistenceRegistry();
            const log: string[] = [];

            const a: Persistable = {
                persistKey: 'a',
                serialize: () => {
                    log.push('a');
                    return null;
                },
                deserialize: () => log.push('restore-a'),
            };

            const b: Persistable = {
                persistKey: 'b',
                serialize: () => {
                    log.push('b');
                    return null;
                },
                deserialize: () => log.push('restore-b'),
            };

            const c: Persistable = {
                persistKey: 'c',
                serialize: () => {
                    log.push('c');
                    return null;
                },
                deserialize: () => log.push('restore-c'),
            };

            // Register in reverse order to prove sorting works
            registry.register(c, ['b']);
            registry.register(b, ['a']);
            registry.register(a);

            log.length = 0;
            registry.serializeAll();
            expect(log).toEqual(['a', 'b', 'c']);

            log.length = 0;
            registry.deserializeAll({ a: 1, b: 2, c: 3 });
            expect(log).toEqual(['restore-a', 'restore-b', 'restore-c']);
        });
    });

    describe('missing snapshot key', () => {
        it('should not call deserialize when key is absent from snapshot', () => {
            const registry = new PersistenceRegistry();
            const trees = createMockPersistable('trees', null);
            const stones = createMockPersistable('stones', null);

            registry.register(trees);
            registry.register(stones);

            registry.deserializeAll({ trees: [{ id: 1 }] });

            expect(trees.deserialize).toHaveBeenCalledOnce();
            expect(stones.deserialize).not.toHaveBeenCalled();
        });
    });

    describe('duplicate key rejection', () => {
        it('should throw when registering two persistables with the same key', () => {
            const registry = new PersistenceRegistry();
            const first = createMockPersistable('trees', null);
            const second = createMockPersistable('trees', null);

            registry.register(first);

            expect(() => registry.register(second)).toThrowError(/duplicate key 'trees'/);
        });
    });

    describe('cycle detection', () => {
        it('should throw when dependencies form a cycle', () => {
            const registry = new PersistenceRegistry();
            const a = createMockPersistable('a', null);
            const b = createMockPersistable('b', null);

            registry.register(a, ['b']);
            registry.register(b, ['a']);

            expect(() => registry.serializeAll()).toThrowError(/cycle involving/);
        });
    });
});
