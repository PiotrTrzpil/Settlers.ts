/**
 * ComponentStore — uniform read-only view over per-entity state maps.
 *
 * Managers that hold `Map<entityId, T>` expose a `store` property implementing
 * this interface.  The interface is intentionally minimal so it can wrap any
 * existing manager without changing its public API.
 */

/** Read-only, iterable view of a per-entity state map. */
export interface ComponentStore<T> {
    get(entityId: number): T | undefined;
    has(entityId: number): boolean;
    readonly size: number;
    entries(): IterableIterator<[number, T]>;
}

/**
 * Wrap a plain `Map<number, T>` as a ComponentStore.
 *
 * The returned object delegates to the map — mutations to the map are visible
 * through the store because it captures the reference, not a snapshot.
 */
export function mapStore<T>(map: Map<number, T>): ComponentStore<T> {
    return {
        get(id: number) {
            return map.get(id);
        },
        has(id: number) {
            return map.has(id);
        },
        get size() {
            return map.size;
        },
        entries() {
            return map.entries();
        },
    };
}

/**
 * Wrap a `Set<number>` as a `ComponentStore<{ entityId: number }>`.
 *
 * Since a set has no associated value, `get()` synthesises a minimal
 * identity record `{ entityId }` — useful when the store participates
 * in `query()` joins purely as a membership filter.
 */
export function setStore(set: Set<number>): ComponentStore<{ entityId: number }> {
    return {
        get(id: number) {
            return set.has(id) ? { entityId: id } : undefined;
        },
        has(id: number) {
            return set.has(id);
        },
        get size() {
            return set.size;
        },
        *entries(): IterableIterator<[number, { entityId: number }]> {
            for (const id of set) {
                yield [id, { entityId: id }];
            }
        },
    };
}
