import type { FeatureDiagnostics } from './feature';

/**
 * Collects diagnostics providers from features.
 * The debug panel queries all providers on-demand.
 */
export class DiagnosticsRegistry {
    private readonly providers = new Map<string, () => FeatureDiagnostics>();

    /** Register a diagnostics provider for a feature. */
    register(featureId: string, provider: () => FeatureDiagnostics): void {
        if (this.providers.has(featureId)) {
            throw new Error(`DiagnosticsRegistry: duplicate provider for '${featureId}'`);
        }
        this.providers.set(featureId, provider);
    }

    /** Get diagnostics from all features (called on-demand, not per-frame). */
    getAll(): FeatureDiagnostics[] {
        const results: FeatureDiagnostics[] = [];
        for (const provider of this.providers.values()) {
            results.push(provider());
        }
        return results;
    }

    /** Get diagnostics for a specific feature. */
    get(featureId: string): FeatureDiagnostics | undefined {
        const provider = this.providers.get(featureId);
        if (!provider) return undefined;
        return provider();
    }
}
