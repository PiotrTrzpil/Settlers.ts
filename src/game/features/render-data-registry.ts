/**
 * Collects render data contributions from features.
 *
 * Features provide named getter functions that return plain data
 * (arrays, maps, primitives). The glue layer (use-renderer/frame-callbacks)
 * queries this registry instead of reaching into individual feature managers.
 *
 * Getters are called lazily per frame — only when the consuming pass is active.
 */
export class RenderDataRegistry {
    private readonly contributions = new Map<string, Map<string, () => unknown>>();

    /**
     * Register all render data contributions from a feature.
     * Called by FeatureRegistry during load().
     *
     * @throws if the feature is already registered
     */
    registerFeature(featureId: string, contributions: Record<string, () => unknown>): void {
        if (this.contributions.has(featureId)) {
            throw new Error(`RenderDataRegistry: feature '${featureId}' already registered`);
        }
        this.contributions.set(featureId, new Map(Object.entries(contributions)));
    }

    /**
     * Get a named contribution getter from a specific feature.
     * Returns undefined if the feature or slot is not registered.
     */
    get<T>(featureId: string, key: string): (() => T) | undefined {
        const featureContribs = this.contributions.get(featureId);
        if (!featureContribs) return undefined;
        const getter = featureContribs.get(key);
        if (!getter) return undefined;
        return getter as () => T;
    }

    /**
     * Get all contributions matching a slot name across all features.
     * Useful when multiple features contribute to the same data slot
     * (e.g., multiple features providing overlay markers).
     */
    getAllForSlot<T>(slotName: string): Array<{ featureId: string; getter: () => T }> {
        const results: Array<{ featureId: string; getter: () => T }> = [];
        this.contributions.forEach((slots, featureId) => {
            const getter = slots.get(slotName);
            if (getter) {
                results.push({ featureId, getter: getter as () => T });
            }
        });
        return results;
    }
}
