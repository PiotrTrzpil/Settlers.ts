/**
 * Persistence module — registry-driven game state serialization
 * with deterministic replay support.
 *
 * Public API:
 * - Types: Persistable<S>, replay types
 * - Registry: PersistenceRegistry
 * - Replay: CommandJournal, KeyframeManager, ReplayEngine, IndexedDbStore
 */

export type { Persistable } from './types';
export { PersistenceRegistry } from './persistence-registry';
export { PersistentMap, PersistentValue } from './persistent-store';
export type { PersistableStore, StoreSerializer } from './persistent-store';

// Replay persistence
export { CommandJournal } from './command-journal';
export { KeyframeManager, DEFAULT_KEYFRAME_INTERVAL } from './keyframe-manager';
export { replay } from './replay-engine';
export {
    open as openIndexedDbStore,
    saveSession,
    getSession,
    getLatestSession,
    listSessions,
    deleteSession,
    saveKeyframe,
    getLatestKeyframe,
    saveJournal,
    getJournal,
} from './indexed-db-store';
export type {
    JournalEntry,
    CommandJournalData,
    Keyframe,
    SaveSession,
    SimulationSettings,
    ReplayResult,
    StateHash,
} from './replay-types';
