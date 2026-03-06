import type { RenderPassDefinition, PluggableRenderPass, RenderPassNeeds, RenderPassDeps } from './render-passes/types';
import { RenderLayer } from './render-passes/types';

/**
 * Ordered slot in the draw loop. Each slot holds one
 * instantiated pass with its metadata.
 */
export interface PassSlot {
    readonly id: string;
    readonly layer: RenderLayer;
    readonly priority: number;
    readonly needs: RenderPassNeeds;
    readonly pass: PluggableRenderPass;
}

const DEFAULT_PRIORITY = 100;

/**
 * Dynamic registry of render passes.
 * Replaces hardcoded pass fields in EntityRenderer.
 *
 * Lifecycle:
 *   1. register() / registerAll() — collect definitions
 *   2. init(deps) — instantiate passes, sort by layer+priority
 *   3. getPassesForLayer() / getAllPasses() — query during draw
 */
export class RenderPassRegistry {
    private readonly definitions: RenderPassDefinition[] = [];
    private slots: PassSlot[] = [];
    private readonly slotsByLayer = new Map<RenderLayer, PassSlot[]>();
    private readonly slotsById = new Map<string, PassSlot>();
    private initialized = false;

    /**
     * Register a pass definition. Must be called before init().
     */
    register(definition: RenderPassDefinition): void {
        if (this.initialized) {
            throw new Error(`RenderPassRegistry: cannot register '${definition.id}'` + ' after init()');
        }
        if (this.definitions.some(d => d.id === definition.id)) {
            throw new Error(`RenderPassRegistry: duplicate pass id` + ` '${definition.id}'`);
        }
        this.definitions.push(definition);
    }

    /**
     * Register multiple definitions at once.
     */
    registerAll(definitions: readonly RenderPassDefinition[]): void {
        for (const def of definitions) {
            this.register(def);
        }
    }

    /**
     * Instantiate all registered passes and sort by
     * layer then priority. Called once by EntityRenderer.init()
     * after GL context is available.
     */
    init(deps: RenderPassDeps): void {
        if (this.initialized) {
            throw new Error('RenderPassRegistry: init() called twice');
        }
        this.initialized = true;

        this.slots = this.definitions.map(def => ({
            id: def.id,
            layer: def.layer,
            priority: def.priority ?? DEFAULT_PRIORITY,
            needs: def.needs,
            pass: def.create(deps),
        }));

        this.slots.sort((a, b) => {
            if (a.layer !== b.layer) return a.layer - b.layer;
            return a.priority - b.priority;
        });

        // Build lookup indices
        for (const slot of this.slots) {
            // By layer
            let layerSlots = this.slotsByLayer.get(slot.layer);
            if (!layerSlots) {
                layerSlots = [];
                this.slotsByLayer.set(slot.layer, layerSlots);
            }
            layerSlots.push(slot);

            // By id
            this.slotsById.set(slot.id, slot);
        }
    }

    /**
     * Get all passes for a specific layer, in priority order.
     */
    getPassesForLayer(layer: RenderLayer): readonly PassSlot[] {
        this.assertInitialized();
        return this.slotsByLayer.get(layer) ?? [];
    }

    /**
     * Get all passes across all layers, in execution order
     * (layer first, then priority within layer).
     */
    getAllPasses(): readonly PassSlot[] {
        this.assertInitialized();
        return this.slots;
    }

    /**
     * Get a specific pass by ID (for profiling / debugging).
     */
    getPass(id: string): PluggableRenderPass | undefined {
        this.assertInitialized();
        return this.slotsById.get(id)?.pass;
    }

    private assertInitialized(): void {
        if (!this.initialized) {
            throw new Error('RenderPassRegistry: not initialized' + ' — call init() first');
        }
    }
}
