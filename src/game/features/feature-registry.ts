/**
 * FeatureRegistry - Manages feature lifecycle and dependency resolution.
 *
 * Responsibilities:
 * - Load features in dependency order
 * - Provide shared context to features
 * - Collect systems for registration with GameLoop
 * - Handle feature cleanup on destroy
 */

import type { TickSystem } from '../core/tick-system';
import { EventSubscriptionManager } from '../event-bus';
import type { EntityVisualService } from '../animation/entity-visual-service';
import type { EntityCleanupRegistry } from '../systems/entity-cleanup-registry';
import type { UnitReservationRegistry } from '../systems/unit-reservation';
import type { CoreDeps, FeatureDefinition, FeatureInstance, FeatureContext, BoundCommandHandler } from './feature';
import type { Command, CommandResult, CommandType } from '../commands';
import type { Persistable } from '../persistence';
import type { TerrainData } from '../terrain';
import type { RenderPassDefinition } from '../renderer/render-passes/types';
import { RenderDataRegistry } from './render-data-registry';
import { DiagnosticsRegistry } from './diagnostics-registry';
import { createLogger } from '@/utilities/logger';

const log = createLogger('FeatureRegistry');

/**
 * Configuration for FeatureRegistry.
 */
export interface FeatureRegistryConfig extends CoreDeps {
    visualService: EntityVisualService;
    cleanupRegistry: EntityCleanupRegistry;
    unitReservation: UnitReservationRegistry;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Registry that manages feature loading and lifecycle.
 */
export class FeatureRegistry {
    private readonly config: FeatureRegistryConfig;

    /** Loaded feature instances by ID */
    private readonly instances = new Map<string, FeatureInstance>();

    /** Auto-tracked event subscriptions per feature (from ctx.on()) */
    private readonly autoSubscriptions = new Map<string, EventSubscriptionManager>();

    /** Feature exports by ID */
    private readonly exports = new Map<string, Record<string, unknown>>();

    /** All systems from loaded features, with group labels */
    private readonly allSystems: { system: TickSystem; group: string }[] = [];

    /** Track loaded feature IDs for summary logging */
    private readonly loadedIds: string[] = [];

    /** Persistable managers collected in feature-load order */
    private readonly persistables: Persistable[] = [];

    /** Command handlers collected from features, keyed by command type */
    private readonly commandHandlers = new Map<CommandType, BoundCommandHandler>();

    /** Render data contributions from features */
    private readonly renderDataRegistry = new RenderDataRegistry();

    /** Render pass definitions from features */
    private readonly renderPassDefinitions: RenderPassDefinition[] = [];

    /** Diagnostics providers from features */
    private readonly diagnosticsRegistry = new DiagnosticsRegistry();

    constructor(config: FeatureRegistryConfig) {
        this.config = config;
    }

    /**
     * Register exports for a feature created outside the registry.
     * Enables incremental migration: manually-created managers become
     * accessible to registry features via ctx.getFeature().
     */
    registerExports(featureId: string, exports: Record<string, unknown>): void {
        if (this.instances.has(featureId)) {
            throw new Error(`Feature '${featureId}' already registered`);
        }
        this.instances.set(featureId, { exports });
        this.exports.set(featureId, exports);
        this.loadedIds.push(featureId);
    }

    /**
     * Load a single feature.
     * Dependencies must be loaded first.
     */
    load(definition: FeatureDefinition): void {
        if (this.instances.has(definition.id)) {
            log.warn(`Feature '${definition.id}' already loaded, skipping`);
            return;
        }

        // Check dependencies are loaded
        for (const depId of definition.dependencies ?? []) {
            if (!this.instances.has(depId)) {
                throw new Error(
                    `Feature '${definition.id}' depends on '${depId}' which is not loaded. ` +
                        `Load dependencies first or use loadAll() for automatic ordering.`
                );
            }
        }

        // Create context for this feature (with auto-tracked event subscriptions)
        const autoSubs = new EventSubscriptionManager();
        this.autoSubscriptions.set(definition.id, autoSubs);
        const ctx = this.createContext(definition.dependencies ?? [], autoSubs);

        // Create the feature instance
        const instance = definition.create(ctx);

        // Store instance and exports
        this.instances.set(definition.id, instance);
        if (instance.exports) {
            this.exports.set(definition.id, instance.exports);
        }

        // Collect systems with their group label
        if (instance.systems) {
            const group = instance.systemGroup ?? 'Other';
            for (const system of instance.systems) {
                this.allSystems.push({ system, group });
            }
        }

        // Collect plugin hooks (persistence, commands, render, diagnostics)
        this.collectPluginHooks(definition.id, instance);

        this.loadedIds.push(definition.id);
    }

    /**
     * Load multiple features in dependency order.
     * Automatically sorts features so dependencies are loaded first.
     */
    loadAll(definitions: FeatureDefinition[]): void {
        const countBefore = this.loadedIds.length;
        const sorted = this.topologicalSort(definitions);
        for (const def of sorted) {
            this.load(def);
        }
        const loaded = this.loadedIds.slice(countBefore);
        if (loaded.length > 0) {
            log.debug(`Loaded ${loaded.length} features: ${loaded.join(', ')}`);
        }
    }

    /** Register an externally-created system (not owned by a feature). */
    registerSystem(system: TickSystem, group: string): void {
        this.allSystems.push({ system, group });
    }

    /**
     * Get all systems from loaded features, with group labels.
     * Use this to register systems with GameLoop.
     */
    getSystems(): readonly { system: TickSystem; group: string }[] {
        return this.allSystems;
    }

    /**
     * Get all persistables from loaded features, in feature-load order.
     */
    getPersistables(): readonly Persistable[] {
        return this.persistables;
    }

    /**
     * Get all command handlers from loaded features.
     */
    getCommandHandlers(): ReadonlyMap<CommandType, BoundCommandHandler> {
        return this.commandHandlers;
    }

    /**
     * Get the render data registry with all feature contributions.
     */
    getRenderDataRegistry(): RenderDataRegistry {
        return this.renderDataRegistry;
    }

    /**
     * Get all render pass definitions from loaded features.
     */
    getRenderPassDefinitions(): readonly RenderPassDefinition[] {
        return this.renderPassDefinitions;
    }

    /**
     * Get the diagnostics registry with all feature providers.
     */
    getDiagnosticsRegistry(): DiagnosticsRegistry {
        return this.diagnosticsRegistry;
    }

    /**
     * Forward terrain data to all features that declared onTerrainReady.
     * Called in load order so features can safely access terrain-dependent
     * exports from their dependencies.
     */
    setTerrainData(terrain: TerrainData, resourceData?: Uint8Array): void {
        for (const id of this.loadedIds) {
            const instance = this.instances.get(id);
            instance?.onTerrainReady?.(terrain, resourceData);
        }
    }

    /**
     * Get exports from a loaded feature.
     */
    getFeatureExports<T>(featureId: string): T {
        const exports = this.exports.get(featureId);
        if (!exports) {
            throw new Error(`Feature '${featureId}' not loaded or has no exports`);
        }
        return exports as T;
    }

    /**
     * Destroy all loaded features.
     * Calls destroy() on each feature in reverse load order.
     */
    destroy(): void {
        // Destroy in reverse order (dependents before dependencies)
        const ids = [...this.instances.keys()].reverse();
        for (const id of ids) {
            const instance = this.instances.get(id);
            if (!instance) throw new Error(`FeatureRegistry: instance ${id} missing from internal map (destroy)`);
            // Auto-unsubscribe ctx.on() subscriptions before feature destroy
            this.autoSubscriptions.get(id)?.unsubscribeAll();
            instance.destroy?.();
        }
        // Destroy tick systems that have a destroy method
        for (const { system } of this.allSystems) {
            system.destroy?.();
        }
        this.instances.clear();
        this.exports.clear();
        this.autoSubscriptions.clear();
        this.allSystems.length = 0;
        this.persistables.length = 0;
        this.commandHandlers.clear();
        this.renderPassDefinitions.length = 0;
    }

    /**
     * Collect optional plugin hooks from a feature instance.
     * Extracted from load() to keep complexity under the limit.
     */
    private collectPluginHooks(featureId: string, instance: FeatureInstance): void {
        if (instance.persistence) {
            for (const persistable of instance.persistence) {
                this.persistables.push(persistable);
            }
        }

        if (instance.commands) {
            for (const [type, handler] of Object.entries(instance.commands)) {
                const cmdType = type as CommandType;
                if (this.commandHandlers.has(cmdType)) {
                    throw new Error(
                        `Feature '${featureId}' registers command '${type}' ` +
                            `which is already registered by another feature`
                    );
                }
                this.commandHandlers.set(cmdType, handler);
            }
        }

        if (instance.renderContributions) {
            this.renderDataRegistry.registerFeature(featureId, instance.renderContributions);
        }

        if (instance.renderPasses) {
            for (const pass of instance.renderPasses) {
                this.renderPassDefinitions.push(pass);
            }
        }

        if (instance.diagnostics) {
            this.diagnosticsRegistry.register(featureId, instance.diagnostics);
        }
    }

    /**
     * Create a context for a feature with access to dependencies.
     */
    private createContext(allowedDeps: string[], autoSubs: EventSubscriptionManager): FeatureContext {
        const allowedSet = new Set(allowedDeps);
        const eventBus = this.config.eventBus;

        return {
            gameState: this.config.gameState,
            eventBus,
            visualService: this.config.visualService,
            cleanupRegistry: this.config.cleanupRegistry,
            unitReservation: this.config.unitReservation,
            executeCommand: this.config.executeCommand,

            getFeature: <T>(featureId: string): T => {
                if (!allowedSet.has(featureId)) {
                    throw new Error(
                        `Feature tried to access '${featureId}' but it's not in dependencies. ` +
                            `Add '${featureId}' to the dependencies array.`
                    );
                }
                return this.getFeatureExports<T>(featureId);
            },

            on(event, handler) {
                autoSubs.subscribe(eventBus, event as any, handler as any);
            },
        };
    }

    /**
     * Topological sort of features by dependencies.
     * Returns features in order where dependencies come before dependents.
     */
    private topologicalSort(definitions: FeatureDefinition[]): FeatureDefinition[] {
        const byId = new Map(definitions.map(d => [d.id, d]));
        const sorted: FeatureDefinition[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();

        const visit = (def: FeatureDefinition) => {
            if (visited.has(def.id)) return;

            if (visiting.has(def.id)) {
                throw new Error(`Circular dependency detected involving '${def.id}'`);
            }

            visiting.add(def.id);

            for (const depId of def.dependencies ?? []) {
                const dep = byId.get(depId);
                if (dep) {
                    visit(dep);
                }
                // If dep not in definitions, assume it's already loaded externally
            }

            visiting.delete(def.id);
            visited.add(def.id);
            sorted.push(def);
        };

        for (const def of definitions) {
            visit(def);
        }

        return sorted;
    }
}
