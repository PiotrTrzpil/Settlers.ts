/**
 * PersistenceRegistry — collects Persistable managers and orchestrates
 * snapshot creation/restoration in dependency order.
 *
 * Registration declares ordering constraints via `after` keys.
 * The registry topologically sorts persistables so that dependencies
 * are serialized/deserialized first.
 */

import type { Persistable } from './types';

interface PersistenceRegistration {
    persistable: Persistable;
    /** persistKeys that must be serialized/deserialized before this one */
    after: string[];
}

export class PersistenceRegistry {
    private readonly registrations: PersistenceRegistration[] = [];
    private sortedCache: PersistenceRegistration[] | null = null;

    register(persistable: Persistable, after: string[] = []): void {
        if (this.registrations.some(r => r.persistable.persistKey === persistable.persistKey)) {
            throw new Error(`PersistenceRegistry: duplicate key '${persistable.persistKey}'`);
        }
        this.registrations.push({ persistable, after });
        this.sortedCache = null;
    }

    /** Create the feature-state portion of a snapshot. */
    serializeAll(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const { persistable } of this.sorted()) {
            result[persistable.persistKey] = persistable.serialize();
        }
        return result;
    }

    /** Restore feature state from a snapshot, in dependency order. */
    deserializeAll(snapshot: Record<string, unknown>): void {
        for (const { persistable } of this.sorted()) {
            const data = snapshot[persistable.persistKey];
            if (data !== undefined) {
                persistable.deserialize(data);
            }
        }
    }

    /** Get registrations in topological order (cached). */
    private sorted(): PersistenceRegistration[] {
        if (!this.sortedCache) {
            this.sortedCache = topologicalSort(this.registrations);
        }
        return this.sortedCache;
    }
}

function topologicalSort(registrations: PersistenceRegistration[]): PersistenceRegistration[] {
    const byKey = new Map(registrations.map(r => [r.persistable.persistKey, r]));
    const sorted: PersistenceRegistration[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(reg: PersistenceRegistration): void {
        const key = reg.persistable.persistKey;
        if (visited.has(key)) {
            return;
        }
        if (visiting.has(key)) {
            throw new Error(`PersistenceRegistry: cycle involving '${key}'`);
        }
        visiting.add(key);
        for (const dep of reg.after) {
            const depReg = byKey.get(dep);
            if (depReg) {
                visit(depReg);
            }
        }
        visiting.delete(key);
        visited.add(key);
        sorted.push(reg);
    }

    for (const reg of registrations) {
        visit(reg);
    }
    return sorted;
}
