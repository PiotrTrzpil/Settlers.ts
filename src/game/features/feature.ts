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

import type { FeatureTickSystem, TickPhase } from '../core/tick-phase';
import type { GameState } from '../game-state';
import type { EventBus, EventHandler, GameEvents } from '../event-bus';
import type { EntityVisualService } from '../animation/entity-visual-service';
import type { EntityCleanupRegistry } from '../systems/entity-cleanup-registry';
import type { UnitCommitmentQuery, UnitCommitmentWriter } from '../systems/unit-commitment';
import type { Command, CommandResult, CommandType, ExecuteCommand } from '../commands';
import type { Persistable } from '../persistence';
import type { TerrainData } from '../terrain';
import type { RenderPassDefinition } from '../renderer/render-passes/types';
import type { TickScheduler } from '../systems/tick-scheduler';
import type { ChoreoSystem } from '../systems/choreo';
import type { GameplaySettings } from '../game-settings';

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
     * Who owns each unit (read side). `get(id) === undefined` ⇔ idle — the one idle definition.
     * Written only by settler-tasks' JobService (assign / cancel / hold / releaseHold).
     */
    unitCommitments: UnitCommitmentQuery;

    /**
     * Claim the commitment write side. Called exactly once per game, by settler-tasks (JobService);
     * any second call throws (Invariant 3 of docs/designs/job-ownership.md).
     */
    claimUnitCommitmentWriter(): UnitCommitmentWriter;

    /** Execute a game command. Available to all features at creation time. */
    executeCommand: ExecuteCommand;

    /** Shared tick scheduler for deferred callbacks. */
    tickScheduler: TickScheduler;

    /**
     * Choreography executor registry. Each feature registers the executors for the task
     * types whose domain it owns (goods → material-transfer, DIG_TILE → construction, …).
     * Every ChoreoTaskType must be registered by the end of feature loading (asserted at startup).
     */
    choreoSystem: ChoreoSystem;

    /** Map terrain (ground types, heights, dimensions). Available to all features at creation time. */
    terrain: TerrainData;

    /**
     * Per-tile ore resource data from the map file.
     * Nullable by design: synthetic maps (test map, empty map) carry no resource layer.
     */
    resourceData: Uint8Array | null;

    /** Gameplay-rule settings (live view of the user's settings, e.g. combatControllable). */
    gameplaySettings: GameplaySettings;

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

    /**
     * Tick systems to register with GameLoop. A bare system runs in the feature's `tickPhase`;
     * a `{ system, phase }` entry runs in its own phase (for a feature whose systems belong
     * to different points of the tick).
     *
     * @example systems: [constructionSystem, { system: demandSystem, phase: TickPhase.ConstructionDemand }]
     */
    systems?: FeatureTickSystem[];

    /**
     * Default tick phase for this feature's bare `systems` entries. Required when any entry
     * is a bare system. Phases fix the tick order across features; within a phase, systems
     * run in feature load order, then `systems` array order. See {@link TickPhase}.
     */
    tickPhase?: TickPhase;

    /**
     * Exports that other features can access via ctx.getFeature().
     * Typically includes managers and key systems.
     */
    exports?: Record<string, any>;

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

    /**
     * Called after every feature's `onRestoreComplete`, in feature-load order. settler-tasks uses it
     * to build and resume the restored jobs, so a `restoreFailed` reaches owners whose domain state
     * is already rebuilt (see "Restore ordering" in docs/designs/job-ownership.md).
     */
    onRestoreResume?(): void;
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
