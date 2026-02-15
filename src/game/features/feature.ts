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
 *         const treeSystem = new TreeSystem(ctx.gameState, ctx.animationService);
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
import type { EventBus } from '../event-bus';
import type { AnimationService } from '../animation/index';

/**
 * Context provided to features during creation.
 * Contains shared services that features can use.
 */
export interface FeatureContext {
    /** Game state - entity management, movement system */
    gameState: GameState;

    /** Event bus for inter-feature communication */
    eventBus: EventBus;

    /** Animation service for entity animations */
    animationService: AnimationService;

    /**
     * Get exports from another feature.
     * Only available for features listed in dependencies.
     */
    getFeature<T>(featureId: string): T;
}

/**
 * Result of feature creation.
 * Contains the systems, managers, and exports the feature provides.
 */
export interface FeatureInstance {
    /** Tick systems to register with GameLoop */
    systems?: TickSystem[];

    /**
     * Exports that other features can access via ctx.getFeature().
     * Typically includes managers and key systems.
     */
    exports?: Record<string, unknown>;

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
