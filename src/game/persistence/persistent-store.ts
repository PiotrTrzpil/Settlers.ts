/**
 * PersistentMap and PersistentValue — auto-persisting state stores.
 *
 * These are the canonical way for features to hold mutable state that
 * participates in save/load.  Both implement Persistable, so features
 * just list them in `persistence` and the registry handles the rest.
 *
 * PersistentMap<T>  — per-entity state (Map<entityId, T>)
 * PersistentValue<T> — singleton system state (single T value)
 *
 * Custom (de)serializers are optional — plain JSON-safe types don't need them.
 */

import type { Persistable } from './types';
import type { ComponentStore } from '../ecs/component-store';

// ---------------------------------------------------------------------------
// Serializer contract (optional per store)
// ---------------------------------------------------------------------------

export interface StoreSerializer<T> {
    serialize: (value: T) => unknown;
    deserialize: (raw: unknown) => T;
}

// ---------------------------------------------------------------------------
// PersistentMap<T> — entity-keyed component store with auto-persistence
// ---------------------------------------------------------------------------

/**
 * Wraps `Map<number, T>` and auto-implements `Persistable`.
 *
 * The key is always an entity ID, but *which* entity depends on the domain:
 * unit entityId for runtimes, carrier entityId for transport jobs,
 * building entityId for inventories, etc.
 *
 * Also satisfies the read-only `ComponentStore<T>` interface for ECS queries.
 */
export class PersistentMap<T> implements Persistable<Record<number, unknown>>, ComponentStore<T> {
    readonly persistKey: string;
    private readonly data = new Map<number, T>();
    private readonly serializer?: StoreSerializer<T>;

    constructor(key: string, serializer?: StoreSerializer<T>) {
        this.persistKey = key;
        this.serializer = serializer;
    }

    /** Access the underlying Map for APIs that require Map/ReadonlyMap (e.g. sortedEntries). */
    get raw(): Map<number, T> {
        return this.data;
    }

    // --- Map API (satisfies ReadonlyMap<number, T>) ---
    get(entityId: number): T | undefined {
        return this.data.get(entityId);
    }
    has(entityId: number): boolean {
        return this.data.has(entityId);
    }
    set(entityId: number, value: T): void {
        this.data.set(entityId, value);
    }
    delete(entityId: number): boolean {
        return this.data.delete(entityId);
    }
    get size(): number {
        return this.data.size;
    }
    keys(): IterableIterator<number> {
        return this.data.keys();
    }
    entries(): IterableIterator<[number, T]> {
        return this.data.entries();
    }
    values(): IterableIterator<T> {
        return this.data.values();
    }
    forEach(callbackfn: (value: T, key: number, map: ReadonlyMap<number, T>) => void): void {
        this.data.forEach(callbackfn as (value: T, key: number, map: Map<number, T>) => void);
    }
    [Symbol.iterator](): IterableIterator<[number, T]> {
        return this.data.entries();
    }
    clear(): void {
        this.data.clear();
    }

    // --- Persistable ---
    serialize(): Record<number, unknown> {
        const result: Record<number, unknown> = {};
        for (const [id, v] of this.data) {
            result[id] = this.serializer ? this.serializer.serialize(v) : v;
        }
        return result;
    }

    deserialize(data: Record<number, unknown>): void {
        this.data.clear();
        for (const [id, raw] of Object.entries(data)) {
            this.data.set(Number(id), this.serializer ? this.serializer.deserialize(raw) : (raw as T));
        }
    }
}

// ---------------------------------------------------------------------------
// PersistentValue<T> — singleton store with auto-persistence
// ---------------------------------------------------------------------------

/**
 * Wraps a single value of type T.
 *
 * For system-wide state that isn't entity-keyed: RNG seed, request lists,
 * in-flight counts, terrain diffs, etc.
 */
export class PersistentValue<T> implements Persistable<unknown> {
    readonly persistKey: string;
    private value: T;
    private readonly serializer?: StoreSerializer<T>;

    constructor(key: string, defaultValue: T, serializer?: StoreSerializer<T>) {
        this.persistKey = key;
        this.value = defaultValue;
        this.serializer = serializer;
    }

    get(): T {
        return this.value;
    }
    set(value: T): void {
        this.value = value;
    }

    // --- Persistable ---
    serialize(): unknown {
        return this.serializer ? this.serializer.serialize(this.value) : this.value;
    }

    deserialize(data: unknown): void {
        this.value = this.serializer ? this.serializer.deserialize(data) : (data as T);
    }
}

// ---------------------------------------------------------------------------
// Union type for feature persistence declarations
// ---------------------------------------------------------------------------

/** Any store that can appear in `FeatureInstance.persistence`. */
export type PersistableStore = PersistentMap<any> | PersistentValue<any> | Persistable;
