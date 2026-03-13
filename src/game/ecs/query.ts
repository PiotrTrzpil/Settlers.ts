/**
 * Cross-cutting queries over ComponentStores.
 *
 * Finds entities present in multiple stores simultaneously and yields
 * their combined state.  Iterates the smallest store for efficiency.
 */

import type { ComponentStore } from './component-store';

// ── Typed overloads (2 and 3 stores) ────────────────────────────────

/** Yield `[entityId, a, b]` for every entity present in both stores. */
export function query<A, B>(a: ComponentStore<A>, b: ComponentStore<B>): Array<[number, A, B]>;

/** Yield `[entityId, a, b, c]` for every entity present in all three stores. */
export function query<A, B, C>(
    a: ComponentStore<A>,
    b: ComponentStore<B>,
    c: ComponentStore<C>
): Array<[number, A, B, C]>;

export function query(...stores: ComponentStore<unknown>[]): Array<[number, ...unknown[]]> {
    // Pick the smallest store to iterate
    let smallest = stores[0]!;
    for (let i = 1; i < stores.length; i++) {
        if (stores[i]!.size < smallest.size) {
            smallest = stores[i]!;
        }
    }

    const results: Array<[number, ...unknown[]]> = [];

    for (const [id] of smallest.entries()) {
        const values: unknown[] = [];
        let allPresent = true;
        for (const store of stores) {
            const val = store.get(id);
            if (val === undefined) {
                allPresent = false;
                break;
            }
            values.push(val);
        }
        if (allPresent) {
            results.push([id, ...values]);
        }
    }

    return results;
}

/**
 * Count entities present in all given stores without allocating result tuples.
 */
export function queryCount(...stores: ComponentStore<unknown>[]): number {
    let smallest = stores[0]!;
    for (let i = 1; i < stores.length; i++) {
        if (stores[i]!.size < smallest.size) {
            smallest = stores[i]!;
        }
    }

    let count = 0;
    for (const [id] of smallest.entries()) {
        let allPresent = true;
        for (const store of stores) {
            if (!store.has(id)) {
                allPresent = false;
                break;
            }
        }
        if (allPresent) {
            count++;
        }
    }
    return count;
}
