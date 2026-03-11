import { describe, it, expect } from 'vitest';
import { IndexedMap } from '../../../src/game/utils/indexed-map';

interface Person {
    name: string;
    city: string;
    tags: string[];
}

describe('IndexedMap', () => {
    describe('basic set/get/delete with single index', () => {
        it('indexes entries on set and retrieves via index', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            map.set(2, { name: 'Bob', city: 'Berlin', tags: [] });
            map.set(3, { name: 'Carol', city: 'Paris', tags: [] });

            expect(map.size).toBe(3);
            expect(byCity.get('Berlin')).toEqual(new Set([1, 2]));
            expect(byCity.get('Paris')).toEqual(new Set([3]));
            expect(byCity.size).toBe(2);
        });

        it('removes index entries on delete', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            map.set(2, { name: 'Bob', city: 'Berlin', tags: [] });

            map.delete(1);

            expect(map.size).toBe(1);
            expect(byCity.get('Berlin')).toEqual(new Set([2]));
        });

        it('cleans up empty index buckets on delete', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            map.delete(1);

            expect(byCity.size).toBe(0);
            expect(byCity.get('Berlin').size).toBe(0);
        });

        it('delete returns false for missing keys', () => {
            const map = new IndexedMap<number, string>();
            expect(map.delete(999)).toBe(false);
        });
    });

    describe('multi-value index', () => {
        it('indexes under multiple keys from array return', () => {
            const map = new IndexedMap<number, Person>();
            const byTag = map.addIndex<string>((_k, v) => v.tags);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: ['dev', 'lead'] });
            map.set(2, { name: 'Bob', city: 'Paris', tags: ['dev'] });

            expect(byTag.get('dev')).toEqual(new Set([1, 2]));
            expect(byTag.get('lead')).toEqual(new Set([1]));
            expect(byTag.size).toBe(2);
        });

        it('removes all multi-value index entries on delete', () => {
            const map = new IndexedMap<number, Person>();
            const byTag = map.addIndex<string>((_k, v) => v.tags);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: ['dev', 'lead'] });
            map.delete(1);

            expect(byTag.get('dev').size).toBe(0);
            expect(byTag.get('lead').size).toBe(0);
            expect(byTag.size).toBe(0);
        });
    });

    describe('null keyFn return', () => {
        it('excludes entries when keyFn returns null', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => (v.city === '' ? null : v.city));

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            map.set(2, { name: 'Bob', city: '', tags: [] });

            expect(byCity.get('Berlin')).toEqual(new Set([1]));
            expect(byCity.size).toBe(1);
        });

        it('returns shared empty set for missing index keys', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            const result1 = byCity.get('nowhere');
            const result2 = byCity.get('also-nowhere');

            expect(result1.size).toBe(0);
            expect(result2.size).toBe(0);
            // Should be the same frozen empty set
            expect(result1).toBe(result2);
        });
    });

    describe('reindex() after mutation', () => {
        it('updates index when value is mutated and reindexed', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            expect(byCity.get('Berlin')).toEqual(new Set([1]));

            // Mutate in place
            map.get(1)!.city = 'Paris';
            map.reindex(1);

            expect(byCity.get('Berlin').size).toBe(0);
            expect(byCity.get('Paris')).toEqual(new Set([1]));
        });

        it('throws when reindexing a nonexistent key', () => {
            const map = new IndexedMap<number, string>();
            map.addIndex<string>((_k, v) => v);

            expect(() => map.reindex(999)).toThrow('key not found');
        });
    });

    describe('set() overwrite updates indexes', () => {
        it('removes old index entry and adds new one on overwrite', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            // eslint-disable-next-line sonarjs/no-element-overwrite -- intentional: testing index update on overwrite
            map.set(1, { name: 'Alice', city: 'Paris', tags: [] });

            expect(byCity.get('Berlin').size).toBe(0);
            expect(byCity.get('Paris')).toEqual(new Set([1]));
            expect(map.size).toBe(1);
        });

        it('handles overwrite from null index to valid index', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => (v.city === '' ? null : v.city));

            map.set(1, { name: 'Alice', city: '', tags: [] });
            expect(byCity.size).toBe(0);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            expect(byCity.get('Berlin')).toEqual(new Set([1]));
        });
    });

    describe('clear() empties all indexes', () => {
        it('removes all data and index entries', () => {
            const map = new IndexedMap<number, Person>();
            const byCity = map.addIndex<string>((_k, v) => v.city);
            const byTag = map.addIndex<string>((_k, v) => v.tags);

            map.set(1, { name: 'Alice', city: 'Berlin', tags: ['dev'] });
            map.set(2, { name: 'Bob', city: 'Paris', tags: ['dev', 'lead'] });

            map.clear();

            expect(map.size).toBe(0);
            expect(byCity.size).toBe(0);
            expect(byTag.size).toBe(0);
            expect(byCity.get('Berlin').size).toBe(0);
            expect(byTag.get('dev').size).toBe(0);
        });
    });

    describe('Map API delegation', () => {
        it('supports iteration via entries, keys, values, forEach, Symbol.iterator', () => {
            const map = new IndexedMap<number, string>();
            map.set(1, 'a');
            map.set(2, 'b');

            expect([...map.keys()]).toEqual([1, 2]);
            expect([...map.values()]).toEqual(['a', 'b']);
            expect([...map.entries()]).toEqual([
                [1, 'a'],
                [2, 'b'],
            ]);

            const collected: [number, string][] = [];
            map.forEach((v, k) => collected.push([k, v]));
            expect(collected).toEqual([
                [1, 'a'],
                [2, 'b'],
            ]);

            expect([...map]).toEqual([
                [1, 'a'],
                [2, 'b'],
            ]);
        });

        it('has() returns correct boolean', () => {
            const map = new IndexedMap<number, string>();
            map.set(1, 'a');
            expect(map.has(1)).toBe(true);
            expect(map.has(2)).toBe(false);
        });

        it('raw returns a readonly view of the internal map', () => {
            const map = new IndexedMap<number, string>();
            map.set(1, 'a');

            const raw = map.raw;
            expect(raw.get(1)).toBe('a');
            expect(raw.size).toBe(1);
        });
    });

    describe('addIndex on populated map', () => {
        it('indexes existing entries when addIndex is called after data insertion', () => {
            const map = new IndexedMap<number, Person>();
            map.set(1, { name: 'Alice', city: 'Berlin', tags: [] });
            map.set(2, { name: 'Bob', city: 'Paris', tags: [] });

            const byCity = map.addIndex<string>((_k, v) => v.city);

            expect(byCity.get('Berlin')).toEqual(new Set([1]));
            expect(byCity.get('Paris')).toEqual(new Set([2]));
        });
    });
});
