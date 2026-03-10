/**
 * Persistence module — registry-driven game state serialization.
 *
 * Public API:
 * - Types: Persistable<S>
 * - Registry: PersistenceRegistry
 */

export type { Persistable } from './types';
export { PersistenceRegistry } from './persistence-registry';
export { PersistentMap, PersistentValue } from './persistent-store';
export type { PersistableStore, StoreSerializer } from './persistent-store';
