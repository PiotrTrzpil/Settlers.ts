/**
 * EntityQuery — lazy, chainable entity query builder.
 *
 * Wraps an Iterable<Entity> source and applies filters lazily.
 * Designed for one-shot use: create a query chain, call one terminal operation.
 *
 * Usage:
 *   entityIndex.query(EntityType.Building, player, BuildingType.Woodcutter)
 *     .filter(e => e.operational)
 *     .inRadius(center, 20)
 *     .nearest(center)
 */

import type { Entity, Tile } from './entity';
import { distSq } from './core/distance';

export class EntityQuery implements Iterable<Entity> {
    constructor(private readonly source: Iterable<Entity>) {}

    /** Keep only entities matching a predicate. */
    filter(predicate: (e: Entity) => boolean): EntityQuery {
        return new EntityQuery(filterIter(this.source, predicate));
    }

    /** Keep only entities within a radius of a center point. */
    inRadius(center: Tile, radius: number): EntityQuery {
        const r2 = radius * radius;
        return new EntityQuery(filterIter(this.source, e => distSq(e, center) <= r2));
    }

    /** Keep only entities within a rectangular tile region. */
    inRect(topLeft: Tile, bottomRight: Tile): EntityQuery {
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);
        return new EntityQuery(filterIter(this.source, e => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY));
    }

    // ── Terminal operations ───────────────────────────────────────

    /** Count matching entities. */
    count(): number {
        let n = 0;
        const iter = this.source[Symbol.iterator]();
        while (!iter.next().done) {
            n++;
        }
        return n;
    }

    /** Collect all matching entities into an array. */
    toArray(): Entity[] {
        return [...this.source];
    }

    /** Get the first matching entity, or undefined. */
    first(): Entity | undefined {
        const result = this.source[Symbol.iterator]().next();
        return result.done ? undefined : result.value;
    }

    /** Check if any matching entity exists. */
    some(): boolean {
        return !this.source[Symbol.iterator]().next().done;
    }

    /** Find the nearest entity to a center point. */
    nearest(center: Tile): Entity | undefined {
        let best: Entity | undefined;
        let bestDist = Infinity;
        for (const e of this.source) {
            const d = distSq(e, center);
            if (d < bestDist) {
                bestDist = d;
                best = e;
            }
        }
        return best;
    }

    /** Find the nearest entity, returning both entity and squared distance. */
    nearestWithCost(center: Tile): { entity: Entity; distSq: number } | undefined {
        let best: Entity | undefined;
        let bestDist = Infinity;
        for (const e of this.source) {
            const d = distSq(e, center);
            if (d < bestDist) {
                bestDist = d;
                best = e;
            }
        }
        return best ? { entity: best, distSq: bestDist } : undefined;
    }

    /** Iterate matching entities with a callback. */
    forEach(callback: (e: Entity) => void): void {
        for (const e of this.source) {
            callback(e);
        }
    }

    [Symbol.iterator](): Iterator<Entity> {
        return this.source[Symbol.iterator]();
    }
}

function* filterIter(source: Iterable<Entity>, predicate: (e: Entity) => boolean): IterableIterator<Entity> {
    for (const e of source) {
        if (predicate(e)) {
            yield e;
        }
    }
}
