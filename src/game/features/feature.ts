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
 *             persistence: [treeSystem],  // or 'none' if no persistent state
 *         };
 *     },
 * };
 * ```
 */

import type { TickSystem } from '../core/tick-system';
import type { GameState } from '../game-state';
import type { EventBus, EventHandler, GameEvents } from '../event-bus';
import type { EntityVisualService } from '../animation/entity-visual-service';
import type { EntityCleanupRegistry } from '../systems/entity-cleanup-registry';
import type { UnitReservationRegistry } from '../systems/unit-reservation';
import type { Command, CommandResult, CommandType, ExecuteCommand } from '../commands';
import type { Persistable } from '../persistence';
import type { TerrainData } from '../terrain';
import type { RenderPassDefinition } from '../renderer/render-passes/types';
import type { TickScheduler } from '../systems/tick-scheduler';

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

    /**
     * Registry for units committed to a feature-managed task.
     * Reserve a unit to prevent player move commands from interrupting it.
     * Release when the task completes, is cancelled, or the unit is removed.
     *
     * @example
     * ctx.unitReservation.reserve(unitId);   // unit is walking to barracks / tower
     * ctx.unitReservation.release(unitId);   // training done / garrison arrived
     */
    unitReservation: UnitReservationRegistry;

    /** Execute a game command. Available to all features at creation time. */
    executeCommand: ExecuteCommand;

    /** Shared tick scheduler for deferred callbacks. */
    tickScheduler: TickScheduler;

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
     * ctx.on('unit:spawned', ({ unitId }) => manager.register(unitId));
     */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void;
}

/**
 * A command handler that a feature provides.
 * The feature binds its own dependencies at creation time.
 */
export type BoundCommandHandler = (cmd: Command) => CommandResult;

/**
 * Entry in the persistence array.
 * A bare Persistable (no ordering constraints) or an object with explicit `after` keys
 * for finer-grained ordering within the PersistenceRegistry.
 */
export type PersistenceEntry = Persistable | { persistable: Persistable; after: string[] };

/**
 * Render data contribution from a feature.
 * Each key identifies a named data slot that the glue layer reads.
 * Values are getter functions called once per frame.
 *
 * Return types must be plain data (arrays, maps, primitives).
 * No renderer types (WebGL, SpriteEntry, etc.).
 */
export type RenderContributions = Record<string, () => unknown>;

/**
 * Diagnostic data a feature can provide for the debug panel.
 * Each entry is a labeled section with key-value pairs.
 */
export interface FeatureDiagnostics {
    label: string;
    sections: DiagnosticSection[];
}

export interface DiagnosticSection {
    label: string;
    entries: DiagnosticEntry[];
}

export interface DiagnosticEntry {
    key: string;
    value: string | number | boolean;
}

/**
 * Result of feature creation.
 * Contains the systems, managers, and exports the feature provides.
 */
export interface FeatureInstance {
    // === Existing (unchanged) ===

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

    // === New: Self-registration hooks ===

    /**
     * Persistable managers owned by this feature.
     * Registered with PersistenceRegistry automatically.
     * Ordering derived from feature dependencies.
     *
     * Use 'none' for features that have no persistent state.
     * This field is required so that omitting it is a compile error —
     * preventing the "forgot to persist" bug.
     */
    persistence: PersistenceEntry[] | 'none';

    /**
     * Command handlers owned by this feature.
     * Keys are CommandType strings. Handlers have dependencies pre-bound.
     */
    commands?: Partial<Record<CommandType, BoundCommandHandler>>;

    /**
     * Render data this feature contributes per frame.
     * Keys are named slots. Values are getter functions returning plain data.
     * The glue layer reads these and maps them to PassContext fields.
     */
    renderContributions?: RenderContributions;

    /**
     * Custom render passes this feature provides.
     * Pass classes live physically in the feature folder but are
     * architecturally renderer-layer code.
     */
    renderPasses?: RenderPassDefinition[];

    /**
     * Diagnostic data provider for the debug panel.
     * Called on-demand (not every frame).
     */
    diagnostics?: () => FeatureDiagnostics;

    /**
     * Called after all entities and feature stores have been restored from a snapshot.
     * Use this to rebuild derived state (spatial indices, caches, etc.) that is not
     * persisted independently. Called in feature-load (dependency) order.
     */
    onRestoreComplete?(): void;
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
