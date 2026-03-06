/**
 * Persistable — contract for managers that contribute to game snapshots.
 *
 * Managers implement this to participate in the persistence registry.
 * The registry calls serialize() during snapshot creation and
 * deserialize() during restoration, in topological order.
 */
export interface Persistable<S = unknown> {
    /** Unique key in the snapshot object. Must be stable across versions. */
    readonly persistKey: string;

    /**
     * Serialize all owned state into a JSON-safe value.
     * Called once per snapshot. Returns the full serialized state for this manager.
     */
    serialize(): S;

    /**
     * Restore state from a previously serialized value.
     * Called once during snapshot restoration.
     * May assume that dependencies (declared via `after`) are already restored.
     */
    deserialize(data: S): void;
}
