/**
 * Feature module system for self-registering game features.
 *
 * Features are self-contained modules that provide:
 * - Systems (TickSystem implementations for per-frame logic)
 * - Managers (state containers with CRUD operations)
 * - Event handlers (EventBus subscriptions)
 *
 * Features declare their dependencies and receive a context with shared services.
 * The FeatureRegistry handles instantiation order and wiring.
 *
 * @example
 * ```ts
 * export const TreeFeature: FeatureDefinition = {
 *     id: 'trees',
 *     dependencies: [],
 *     create(ctx) {
 *         const treeSystem = new TreeSystem({
 *             gameState: ctx.gameState, visualService: ctx.visualService,
 *             eventBus: ctx.eventBus, executeCommand: ctx.executeCommand,
 *         });
 *         return {
 *             systems: [treeSystem],
 *             exports: { treeSystem },
 *         };
 *     },
 * };
 * ```
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import type { EventBus, EventHandler, GameEvents } from '../event-bus';
import type { EntityVisualService } from '../animation/entity-visual-service';
import type { EntityCleanupRegistry } from '../systems/entity-cleanup-registry';
import type { Command, CommandResult } from '../commands';
import type { TerrainData } from '../terrain';

/**
 * Minimal shared dependencies injected into almost every system and manager.
 * Extend this in *Config interfaces instead of redeclaring the two fields.
 */
export interface CoreDeps {
    gameState: GameState;
    eventBus: EventBus;
}

/**
 * Context provided to features during creation.
 * Contains shared services that features can use.
 */
export interface FeatureContext extends CoreDeps {
    /** Visual service for entity visual state (variation + animation) */
    visualService: EntityVisualService;

    /**
     * Central registry for entity:removed cleanup.
     * Register handlers here instead of subscribing to entity:removed directly.
     *
     * @example
     * ctx.cleanupRegistry.onEntityRemoved(entityId => myMap.delete(entityId));
     */
    cleanupRegistry: EntityCleanupRegistry;

    /** Execute a game command. Available to all features at creation time. */
    executeCommand: (cmd: Command) => CommandResult;

    /**
     * Get exports from another feature.
     * Only available for features listed in dependencies.
     */
    getFeature<T>(featureId: string): T;

    /**
     * Subscribe to an event with automatic cleanup on feature destroy.
     * Replaces manual EventSubscriptionManager boilerplate.
     *
     * @example
     * ctx.on('unit:spawned', ({ entityId }) => manager.register(entityId));
     */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void;
}

/**
 * Result of feature creation.
 * Contains the systems, managers, and exports the feature provides.
 */
export interface FeatureInstance {
    /** Tick systems to register with GameLoop */
    systems?: TickSystem[];

    /** Group label for tick systems (e.g. 'Units', 'Buildings', 'Logistics'). Defaults to 'Other'. */
    systemGroup?: string;

    /**
     * Exports that other features can access via ctx.getFeature().
     * Typically includes managers and key systems.
     */
    exports?: Record<string, any>;

    /**
     * Late-init callback invoked after terrain data is loaded.
     * Called in dependency order so features can safely access
     * terrain-dependent exports from their dependencies.
     */
    onTerrainReady?(terrain: TerrainData, resourceData?: Uint8Array): void;

    /**
     * Cleanup function called when the feature is destroyed.
     * Use for event unsubscription and resource cleanup.
     */
    destroy?: () => void;
}

/**
 * Definition of a feature module.
 * Features are created in dependency order by the FeatureRegistry.
 */
export interface FeatureDefinition {
    /** Unique feature identifier */
    id: string;

    /**
     * IDs of features this feature depends on.
     * Dependencies are created first and available via ctx.getFeature().
     */
    dependencies?: string[];

    /**
     * Create the feature instance.
     * Called by FeatureRegistry with the shared context.
     */
    create(ctx: FeatureContext): FeatureInstance;
}
