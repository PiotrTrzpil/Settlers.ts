const EMPTY_SET: ReadonlySet<never> = Object.freeze(new Set<never>());

/**
 * A secondary index over an IndexedMap.
 * Maps an index key to the set of primary keys that produce that index key.
 */
export interface Index<IK, K> {
    /** Get all primary keys that map to this index key. Returns empty set if none. */
    get(indexKey: IK): ReadonlySet<K>;
    /** Number of distinct index keys. */
    readonly size: number;
}

type IndexKeyFn<IK, K> = (key: K, value: unknown) => IK | null | IK[];

interface IndexEntry<IK, K> {
    keyFn: IndexKeyFn<IK, K>;
    buckets: Map<IK, Set<K>>;
    /** Cached index keys per primary key, for correct removal after in-place mutation. */
    lastKeys: Map<K, IK[]>;
}

/**
 * A Map<K, V> wrapper that maintains derived secondary indexes.
 *
 * Indexes are declared via addIndex() before any data is inserted.
 * They are automatically updated on set() and delete().
 */
export class IndexedMap<K, V> {
    private readonly data = new Map<K, V>();
    private readonly indexes: IndexEntry<unknown, K>[] = [];

    /** All entries (delegates to internal Map). */
    get size(): number {
        return this.data.size;
    }

    // --- Primary Map API ---

    get(key: K): V | undefined {
        return this.data.get(key);
    }

    has(key: K): boolean {
        return this.data.has(key);
    }

    set(key: K, value: V): void {
        if (this.data.has(key)) {
            this.removeFromIndexes(key);
        }
        this.data.set(key, value);
        this.addToIndexes(key, value);
    }

    delete(key: K): boolean {
        const value = this.data.get(key);
        if (value === undefined && !this.data.has(key)) {
            return false;
        }
        this.removeFromIndexes(key);
        this.data.delete(key);
        return true;
    }

    clear(): void {
        this.data.clear();
        for (const idx of this.indexes) {
            idx.buckets.clear();
            idx.lastKeys.clear();
        }
    }

    values(): IterableIterator<V> {
        return this.data.values();
    }

    entries(): IterableIterator<[K, V]> {
        return this.data.entries();
    }

    keys(): IterableIterator<K> {
        return this.data.keys();
    }

    forEach(fn: (value: V, key: K) => void): void {
        this.data.forEach(fn);
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.data.entries();
    }

    /**
     * Declare a secondary index.
     * @param keyFn Maps (key, value) to an index key, or null to exclude from this index.
     *   May return an array to index under multiple keys (for multi-value indexes).
     */
    addIndex<IK>(keyFn: (key: K, value: V) => IK | null | IK[]): Index<IK, K> {
        const entry: IndexEntry<IK, K> = {
            keyFn: keyFn as (key: K, value: unknown) => IK | null | IK[],
            buckets: new Map<IK, Set<K>>(),
            lastKeys: new Map<K, IK[]>(),
        };

        // Index any existing entries
        for (const [key, value] of this.data) {
            const indexKeys = this.resolveIndexKeys(entry, key, value);
            entry.lastKeys.set(key, indexKeys);
            for (const ik of indexKeys) {
                this.addToBucket(entry, ik, key);
            }
        }

        this.indexes.push(entry as IndexEntry<unknown, K>);

        const index: Index<IK, K> = {
            get(indexKey: IK): ReadonlySet<K> {
                return entry.buckets.get(indexKey) ?? (EMPTY_SET as ReadonlySet<K>);
            },
            get size(): number {
                return entry.buckets.size;
            },
        };

        return index;
    }

    /**
     * Notify that a value's indexed fields have changed without calling set().
     * Re-runs all index key functions for this entry and updates indexes.
     * Use sparingly — prefer set() when possible.
     */
    reindex(key: K): void {
        const value = this.data.get(key);
        if (value === undefined && !this.data.has(key)) {
            throw new Error(`IndexedMap.reindex: key not found`);
        }
        this.removeFromIndexes(key);
        this.addToIndexes(key, value as V);
    }

    /** Access the underlying Map (for APIs that require Map/ReadonlyMap). */
    get raw(): ReadonlyMap<K, V> {
        return this.data;
    }

    // --- Internal helpers ---

    private resolveIndexKeys<IK>(entry: IndexEntry<IK, K>, key: K, value: V): IK[] {
        const result = entry.keyFn(key, value);
        if (result === null) {
            return [];
        }
        if (Array.isArray(result)) {
            return result;
        }
        return [result];
    }

    private addToBucket<IK>(entry: IndexEntry<IK, K>, indexKey: IK, primaryKey: K): void {
        let bucket = entry.buckets.get(indexKey);
        if (!bucket) {
            bucket = new Set<K>();
            entry.buckets.set(indexKey, bucket);
        }
        bucket.add(primaryKey);
    }

    private removeBucket<IK>(entry: IndexEntry<IK, K>, indexKey: IK, primaryKey: K): void {
        const bucket = entry.buckets.get(indexKey);
        if (!bucket) {
            return;
        }
        bucket.delete(primaryKey);
        if (bucket.size === 0) {
            entry.buckets.delete(indexKey);
        }
    }

    private addToIndexes(key: K, value: V): void {
        for (const idx of this.indexes) {
            const indexKeys = this.resolveIndexKeys(idx, key, value);
            idx.lastKeys.set(key, indexKeys);
            for (const ik of indexKeys) {
                this.addToBucket(idx, ik, key);
            }
        }
    }

    private removeFromIndexes(key: K): void {
        for (const idx of this.indexes) {
            const cachedKeys = idx.lastKeys.get(key);
            if (cachedKeys) {
                for (const ik of cachedKeys) {
                    this.removeBucket(idx, ik, key);
                }
                idx.lastKeys.delete(key);
            }
        }
    }
}
