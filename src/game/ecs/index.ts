/**
 * ECS-lite utilities — ComponentStore interface and cross-cutting queries.
 *
 * Public API:
 * - Types: ComponentStore<T>
 * - Helpers: mapStore(map) — wrap a Map as a ComponentStore
 * - Queries: query(a, b, ...) — intersect multiple stores
 *            queryCount(a, b, ...) — count intersecting entities
 */

export type { ComponentStore } from './component-store';
export { mapStore, setStore } from './component-store';
export { query, queryCount } from './query';
