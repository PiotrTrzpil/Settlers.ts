/**
 * Interface for systems that update every game tick.
 * Systems register with the GameLoop instead of being called directly.
 */
export interface TickSystem {
    /** Called each fixed-timestep tick */
    tick(dt: number): void;

    /**
     * Optional: Called when an entity is removed from the game.
     * Systems that maintain per-entity state (Map<entityId, State>) should
     * implement this to clean up their internal state.
     *
     * This is called automatically by GameLoop for all registered systems.
     */
    onEntityRemoved?(entityId: number): void;

    /**
     * Optional: Called when the system is being destroyed (e.g., HMR reload, game exit).
     * Systems that subscribe to events MUST implement this to clean up subscriptions.
     *
     * Best practice: Use EventSubscriptionManager to track subscriptions,
     * then call subscriptions.unsubscribeAll() in destroy().
     *
     * This is called automatically by GameLoop.destroy() for all registered systems.
     */
    destroy?(): void;
}
