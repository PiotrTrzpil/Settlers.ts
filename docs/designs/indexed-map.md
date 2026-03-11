# IndexedMap — Design

## Overview

A `Map<K, V>` wrapper that maintains derived secondary indexes, automatically updated on `set`/`delete`. Replaces O(n) linear scans across settler runtimes, transport jobs, and resource requests with O(1) index lookups.

## Current State

Multiple systems scan their entire Map on every query:
- `BuildingWorkerTracker.getWorkersForBuilding()` — scans all runtimes by `homeAssignment.buildingId`
- `BuildingWorkerTracker.findIdleSpecialist()` — scans all runtimes for idle + unassigned + matching type
- `CarrierAssigner.findBestBusyCarrier()` — scans all active jobs for `PickedUp` phase
- `RequestManager.getRequestsForBuilding()` / `cancelRequestsForBuilding()` — scans all requests by buildingId
- `LogisticsDispatcher.handleBuildingDestroyed()` — scans all active jobs by source/dest building

These are correct but O(n). IndexedMap makes them O(1) while keeping consistency automatic — no manual bookkeeping, no stale caches, no dirty flags.

## Summary for Review

- **Interpretation**: Build a generic `IndexedMap<K, V>` utility, then migrate the 5 identified scan sites to use it. Each site replaces a `Map` (or `PersistentMap`) with an `IndexedMap` and adds indexes matching their query patterns.
- **Key decisions**: IndexedMap is a standalone utility with no game dependencies. Indexes are declared at construction time via `addIndex()`. Multi-value indexes (one value maps to multiple index keys) are supported for the building-destruction case. The `PersistentMap` class gets an IndexedMap variant (`PersistentIndexedMap`) to avoid duplicating persistence logic.
- **Assumptions**: Index key functions are pure and fast (no side effects, no async). Indexes only need set-membership queries (not sorted iteration). The `findIdleSpecialist` and `findBestBusyCarrier` cases still need a linear scan of the *index bucket* (filtered by type/phase), but that bucket is much smaller than the full map.
- **Scope**: IndexedMap core + migration of the 5 identified sites. No other Map usages are changed.

## Conventions

- Optimistic programming: no `?.` or `?? fallback` on required values. `getOrThrow` pattern for lookups.
- Return `ReadonlySet` / `ReadonlyMap` from queries to prevent mutation.
- Files in `src/game/utils/`. Tests in `tests/unit/`.
- `PersistentMap` uses `number` keys and has a `raw` getter, `serialize`/`restore`, and `ComponentStore<T>` interface.
- Event-driven cache invalidation (e.g. `pendingCacheDirty`) already exists in RequestManager — indexes replace this pattern.

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | IndexedMap core | Generic indexed map data structure | — | `src/game/utils/indexed-map.ts`, `tests/unit/utils/indexed-map.spec.ts` |
| 2 | PersistentIndexedMap | Persistent variant with serialize/restore | 1 | `src/game/persistence/persistent-store.ts` |
| 3 | Migration — worker tracker | Add `byBuilding` index to runtimes | 1 | `src/game/features/settler-tasks/building-worker-tracker.ts`, `src/game/features/settler-tasks/settler-task-system.ts` |
| 4 | Migration — request manager | Add `byBuilding` index to requests | 1 | `src/game/features/logistics/request-manager.ts` |
| 5 | Migration — logistics jobs | Add `byBuilding` index to activeJobs via PersistentIndexedMap | 2 | `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/carrier-assigner.ts` |

## Shared Contracts

```typescript
// src/game/utils/indexed-map.ts

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

/**
 * A Map<K, V> wrapper that maintains derived secondary indexes.
 *
 * Indexes are declared via addIndex() before any data is inserted.
 * They are automatically updated on set() and delete().
 */
export class IndexedMap<K, V> {
    /** All entries (delegates to internal Map). */
    get size(): number;

    // --- Primary Map API ---
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    clear(): void;
    values(): IterableIterator<V>;
    entries(): IterableIterator<[K, V]>;
    keys(): IterableIterator<K>;
    forEach(fn: (value: V, key: K) => void): void;
    [Symbol.iterator](): IterableIterator<[K, V]>;

    /**
     * Declare a secondary index.
     * @param keyFn Maps (key, value) to an index key, or null to exclude from this index.
     *   May return an array to index under multiple keys (for multi-value indexes).
     */
    addIndex<IK>(keyFn: (key: K, value: V) => IK | null | IK[]): Index<IK, K>;

    /**
     * Notify that a value's indexed fields have changed without calling set().
     * Re-runs all index key functions for this entry and updates indexes.
     * Use sparingly — prefer set() when possible.
     */
    reindex(key: K): void;

    /** Access the underlying Map (for APIs that require Map/ReadonlyMap). */
    get raw(): ReadonlyMap<K, V>;
}
```

```typescript
// Addition to src/game/persistence/persistent-store.ts

/**
 * PersistentMap variant backed by IndexedMap.
 * Same persistence API (persistKey, serialize, restore) but supports addIndex().
 */
export class PersistentIndexedMap<T> implements Persistable<Record<number, unknown>>, ComponentStore<T> {
    readonly persistKey: string;

    constructor(key: string, serializer?: StoreSerializer<T>);

    // Full IndexedMap API (delegates to internal IndexedMap<number, T>)
    addIndex<IK>(keyFn: (key: number, value: T) => IK | null | IK[]): Index<IK, number>;
    reindex(key: number): void;

    // Same Map API as PersistentMap
    get raw(): ReadonlyMap<number, T>;
    // ... get, has, set, delete, clear, values, entries, keys, forEach, size
    // ... serialize(), restore()
}
```

## Subsystem Details

### 1. IndexedMap core
**Files**: `src/game/utils/indexed-map.ts`, `tests/unit/utils/indexed-map.spec.ts`
**Key decisions**:
- `addIndex` returns an `Index` handle — callers hold the handle, no string-based lookup. This is type-safe and avoids a `Map<string, Index>` registry.
- `keyFn` returning `null` means "exclude this entry from the index". Returning an array means "index under all these keys" (needed for jobs indexed by both source and dest building).
- `reindex(key)` removes old index entries and re-inserts — needed when mutable values change indexed fields (e.g., `runtime.homeAssignment` set to null, `request.status` changed). Callers must call `reindex()` after mutating indexed fields. This is the tradeoff for not requiring immutable values.
- `set()` on an existing key automatically removes old index entries before adding new ones.
- `get()` on an index key with no matches returns a shared empty `ReadonlySet` (not a new object each time).

**Tests**:
- Basic set/get/delete with single index
- Multi-value index (array return from keyFn)
- Null keyFn return (excluded entries)
- reindex() after mutation
- set() overwrite updates indexes
- clear() empties all indexes

### 2. PersistentIndexedMap
**Files**: `src/game/persistence/persistent-store.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Thin wrapper: holds an `IndexedMap<number, T>` internally instead of a plain `Map`. Delegates all operations.
- `restore()` calls `clear()` then `set()` for each entry — indexes rebuild automatically.
- Keep existing `PersistentMap` unchanged (not all maps need indexes).

### 3. Migration — worker tracker
**Files**: `src/game/features/settler-tasks/building-worker-tracker.ts`, `src/game/features/settler-tasks/settler-task-system.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Change `runtimes: Map<number, UnitRuntime>` → `IndexedMap<number, UnitRuntime>` in SettlerTaskSystem (where it's declared). BuildingWorkerTracker receives it via constructor.
- Add `byBuilding` index: `(id, runtime) => runtime.homeAssignment?.buildingId ?? null`
- `getWorkersForBuilding()` becomes `this.byBuilding.get(buildingId)` — returns a `ReadonlySet<number>` instead of `number[]`. Update return type.
- `claim()` and `release()` already call `set()` on the runtime… but they mutate `runtime.homeAssignment` in place. So after mutation, call `this.runtimes.reindex(settlerId)`. The reverse-lookup in `claim`/`release` (`for…of runtimes` to find settler ID from runtime reference) is no longer needed — callers already know the settler ID or can pass it.
- `findIdleSpecialist` stays as a scan for now — the "idle + unassigned" bucket changes every tick, and the nearest-distance logic requires iterating candidates anyway. The index saves nothing here until settler counts are very large.

### 4. Migration — request manager
**Files**: `src/game/features/logistics/request-manager.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Change `requests: Map<number, ResourceRequest>` → `IndexedMap<number, ResourceRequest>`
- Add `byBuilding` index: `(id, req) => req.buildingId`
- `getRequestsForBuilding()` uses `this.byBuilding.get(buildingId)` then filters by `activeOnly`. Still iterates the bucket, but bucket is small (few requests per building).
- `cancelRequestsForBuilding()` uses the same index — collect IDs from the bucket, sort, remove.
- `addRequest` uses `set()` → index updates automatically.
- `removeRequest` uses `delete()` → index updates automatically.
- The `pendingCacheDirty` mechanism is orthogonal (sorted cache, not an index) — leave it as-is.

### 5. Migration — logistics jobs
**Files**: `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/carrier-assigner.ts`
**Depends on**: Subsystem 2
**Key decisions**:
- Change `activeJobs: PersistentMap<TransportJobRecord>` → `PersistentIndexedMap<TransportJobRecord>` in LogisticsDispatcher.
- Add multi-value `byBuilding` index: `(carrierId, job) => [job.sourceBuilding, job.destBuilding]` — indexes under both source and dest. A single job appears in two index buckets.
- `handleBuildingDestroyed()` uses `this.byBuilding.get(buildingId)` to find affected jobs, then inspects each to determine if it's a source or dest match.
- `findBestBusyCarrier()` in CarrierAssigner: the `activeJobs` parameter type changes from `ReadonlyMap` to a type that exposes the index. Add a `byPhase` index: `(id, job) => job.phase`. The PickedUp scan becomes iteration over `byPhase.get(TransportPhase.PickedUp)`.
- After `TransportJobService.redirectSource()` mutates `job.sourceBuilding`, call `activeJobs.reindex(carrierId)`.
- CarrierAssigner receives the index handle or the full IndexedMap. Simplest: change `activeJobs` config type to expose both `ReadonlyMap` iteration and the phase index.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/utils/indexed-map.ts` | 1 | IndexedMap class and Index interface |
| `tests/unit/utils/indexed-map.spec.ts` | 1 | Unit tests for IndexedMap |

### Modified Files
| File | Change |
|------|--------|
| `src/game/persistence/persistent-store.ts` | Add `PersistentIndexedMap` class |
| `src/game/features/settler-tasks/settler-task-system.ts` | Change `runtimes` to `IndexedMap`, create `byBuilding` index |
| `src/game/features/settler-tasks/building-worker-tracker.ts` | Use `byBuilding` index in `getWorkersForBuilding`, add `reindex` calls in `claim`/`release` |
| `src/game/features/logistics/request-manager.ts` | Change `requests` to `IndexedMap`, add `byBuilding` index, update query methods |
| `src/game/features/logistics/logistics-dispatcher.ts` | Change `activeJobs` to `PersistentIndexedMap`, add `byBuilding` index, update `handleBuildingDestroyed` |
| `src/game/features/logistics/carrier-assigner.ts` | Accept phase index, update `findBestBusyCarrier` to use it |

## Verification
- Unit tests: IndexedMap add/remove/reindex with single and multi-value indexes
- `getWorkersForBuilding(buildingId)` returns correct settlers after assign/release cycles
- `cancelRequestsForBuilding()` finds and removes exactly the right requests
- `handleBuildingDestroyed()` finds jobs by source and dest building via index
- `findBestBusyCarrier()` only scans PickedUp-phase jobs (index bucket, not full map)
- All existing tests pass unchanged (behavioral equivalence)
