/**
 * FeatureRegistry - Manages feature lifecycle and dependency resolution.
 *
 * Responsibilities:
 * - Load features in dependency order
 * - Provide shared context to features
 * - Collect systems for registration with GameLoop
 * - Handle feature cleanup on destroy
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import type { EventBus } from '../event-bus';
import type { EntityVisualService } from '../animation/entity-visual-service';
import type { EntityCleanupRegistry } from '../systems/entity-cleanup-registry';
import type { FeatureDefinition, FeatureInstance, FeatureContext } from './feature';
import type { Command, CommandResult } from '../commands';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('FeatureRegistry');

/**
 * Configuration for FeatureRegistry.
 */
export interface FeatureRegistryConfig {
    gameState: GameState;
    eventBus: EventBus;
    visualService: EntityVisualService;
    cleanupRegistry: EntityCleanupRegistry;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Registry that manages feature loading and lifecycle.
 */
export class FeatureRegistry {
    private readonly config: FeatureRegistryConfig;

    /** Loaded feature instances by ID */
    private readonly instances = new Map<string, FeatureInstance>();

    /** Feature exports by ID */
    private readonly exports = new Map<string, Record<string, unknown>>();

    /** All systems from loaded features */
    private readonly allSystems: TickSystem[] = [];

    /** Track loaded feature IDs for summary logging */
    private readonly loadedIds: string[] = [];

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

        // Create context for this feature
        const ctx = this.createContext(definition.dependencies ?? []);

        // Create the feature instance
        const instance = definition.create(ctx);

        // Store instance and exports
        this.instances.set(definition.id, instance);
        if (instance.exports) {
            this.exports.set(definition.id, instance.exports);
        }

        // Collect systems
        if (instance.systems) {
            this.allSystems.push(...instance.systems);
        }

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

    /**
     * Get all systems from loaded features.
     * Use this to register systems with GameLoop.
     */
    getSystems(): TickSystem[] {
        return this.allSystems;
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
            if (instance.destroy) {
                instance.destroy();
            }
        }
        this.instances.clear();
        this.exports.clear();
        this.allSystems.length = 0;
    }

    /**
     * Create a context for a feature with access to dependencies.
     */
    private createContext(allowedDeps: string[]): FeatureContext {
        const allowedSet = new Set(allowedDeps);

        return {
            gameState: this.config.gameState,
            eventBus: this.config.eventBus,
            visualService: this.config.visualService,
            cleanupRegistry: this.config.cleanupRegistry,
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
