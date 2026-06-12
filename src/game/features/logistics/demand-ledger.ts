/**
 * DemandLedger — declarative standing orders for material delivery.
 *
 * Replaces the ticket-based DemandQueue. Instead of scanners emitting
 * unit-demand tickets and deduplicating against their own output, each
 * (building, material) pair holds at most one standing order ("keep this
 * stocked"). The actual shortfall (deficit) is derived at read time from
 * live inventory + the transport job store — see demand-deficit.ts.
 *
 * Consequences:
 * - Demands can never be lost or duplicated: a cancelled job simply makes
 *   the derived deficit positive again.
 * - Dispatch ordering honours material priority (boards before gold) and
 *   serves entries least-recently-first, so no building can starve others.
 *
 * NOT persisted — targets are re-seeded from world state on first tick
 * by the scanner systems (material-requests, construction).
 */

import { type EMaterialType, getMaterialPriority } from '../../economy/material-type';

/**
 * Priority levels for material demands.
 * Lower numeric value = higher priority.
 */
export enum DemandPriority {
    /** Urgent demands (military, critical) */
    High = 0,
    /** Standard production/construction demands */
    Normal = 1,
    /** Low priority (stockpiling, storage imports) */
    Low = 2,
}

/** A standing order: keep (building, material) stocked. */
export interface DemandTarget {
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    priority: DemandPriority;
    /**
     * Absolute amount still to deliver (construction costs), or null to
     * fill available slot capacity (production inputs, storage imports).
     */
    target: number | null;
    /** Cap on total incoming transport jobs (storage import parallelism cap). */
    maxIncoming: number;
    /** Game time when this entry last got a job assigned — for fair rotation. */
    lastServedAt: number;
}

export interface SetTargetOptions {
    priority: DemandPriority;
    /** Absolute remaining amount. Omit (or null) to fill capacity. */
    target?: number | null;
    /** Cap on concurrent incoming jobs. Defaults to unlimited. */
    maxIncoming?: number;
}

/**
 * Holds standing orders keyed by (building, material), sorted for dispatch by
 * (demand priority, material priority, least recently served).
 */
export class DemandLedger {
    private readonly entries = new Map<string, DemandTarget>();

    /** Secondary index: buildingId → entry keys. */
    private readonly byBuilding = new Map<number, Set<string>>();

    /** Cached dispatch-ordered entries, rebuilt on mutation. */
    private sortedCache: readonly DemandTarget[] = [];
    private sortedCacheDirty = true;

    /** Accumulated game time in seconds. */
    private gameTime = 0;

    /** Advance the internal game clock. Call once per tick with the game delta time. */
    advanceTime(dt: number): void {
        this.gameTime += dt;
    }

    /** Get the current accumulated game time in seconds. */
    getGameTime(): number {
        return this.gameTime;
    }

    /**
     * Create or update the standing order for (building, material).
     * An absolute target of 0 removes the order.
     */
    setTarget(buildingId: number, material: EMaterialType, options: SetTargetOptions): void {
        if (options.target === 0) {
            this.clearTarget(buildingId, material);
            return;
        }
        const key = entryKey(buildingId, material);
        const existing = this.entries.get(key);
        if (existing) {
            existing.priority = options.priority;
            existing.target = options.target === undefined ? null : options.target;
            existing.maxIncoming = options.maxIncoming === undefined ? Infinity : options.maxIncoming;
        } else {
            this.entries.set(key, {
                buildingId,
                materialType: material,
                priority: options.priority,
                target: options.target === undefined ? null : options.target,
                maxIncoming: options.maxIncoming === undefined ? Infinity : options.maxIncoming,
                lastServedAt: -Infinity,
            });
            this.addToBuildingIndex(buildingId, key);
        }
        this.sortedCacheDirty = true;
    }

    /** Remove the standing order for (building, material). */
    clearTarget(buildingId: number, material: EMaterialType): void {
        const key = entryKey(buildingId, material);
        if (this.entries.delete(key)) {
            this.removeFromBuildingIndex(buildingId, key);
            this.sortedCacheDirty = true;
        }
    }

    /** Remove all standing orders for a building. Returns the number removed. */
    clearBuilding(buildingId: number): number {
        const keys = this.byBuilding.get(buildingId);
        if (!keys || keys.size === 0) {
            return 0;
        }
        const count = keys.size;
        for (const key of keys) {
            this.entries.delete(key);
        }
        this.byBuilding.delete(buildingId);
        this.sortedCacheDirty = true;
        return count;
    }

    /** Mark an entry as served (a job was just created for it) — moves it to the back of its class. */
    markServed(entry: DemandTarget): void {
        entry.lastServedAt = this.gameTime;
        this.sortedCacheDirty = true;
    }

    /**
     * All entries in dispatch order:
     * demand priority → material priority → least recently served → buildingId.
     */
    getSortedEntries(): readonly DemandTarget[] {
        if (this.sortedCacheDirty) {
            const sorted = [...this.entries.values()];
            sorted.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                const mp = getMaterialPriority(a.materialType) - getMaterialPriority(b.materialType);
                if (mp !== 0) {
                    return mp;
                }
                if (a.lastServedAt !== b.lastServedAt) {
                    return a.lastServedAt - b.lastServedAt;
                }
                return a.buildingId - b.buildingId;
            });
            this.sortedCache = sorted;
            this.sortedCacheDirty = false;
        }
        return this.sortedCache;
    }

    /** Standing order for (building, material), if any. */
    getTarget(buildingId: number, material: EMaterialType): DemandTarget | undefined {
        return this.entries.get(entryKey(buildingId, material));
    }

    /** All standing orders for a building. */
    getTargetsForBuilding(buildingId: number): DemandTarget[] {
        const keys = this.byBuilding.get(buildingId);
        if (!keys) {
            return [];
        }
        const result: DemandTarget[] = [];
        for (const key of keys) {
            result.push(this.entries.get(key)!);
        }
        return result;
    }

    /** All standing orders (for diagnostics). */
    getAllTargets(): IterableIterator<DemandTarget> {
        return this.entries.values();
    }

    /** Total standing-order count. */
    get size(): number {
        return this.entries.size;
    }

    /** Clear all state. */
    clear(): void {
        this.entries.clear();
        this.byBuilding.clear();
        this.sortedCacheDirty = true;
        this.gameTime = 0;
    }

    // ── Internal helpers ──

    private addToBuildingIndex(buildingId: number, key: string): void {
        let set = this.byBuilding.get(buildingId);
        if (!set) {
            set = new Set();
            this.byBuilding.set(buildingId, set);
        }
        set.add(key);
    }

    private removeFromBuildingIndex(buildingId: number, key: string): void {
        const set = this.byBuilding.get(buildingId);
        if (!set) {
            return;
        }
        set.delete(key);
        if (set.size === 0) {
            this.byBuilding.delete(buildingId);
        }
    }
}

function entryKey(buildingId: number, material: EMaterialType): string {
    return `${buildingId}:${material}`;
}
