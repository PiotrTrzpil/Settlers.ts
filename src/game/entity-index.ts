/**
 * EntityIndex — fast lookup of entities by type, player, and subType.
 *
 * Maintained automatically by GameState on add/remove.
 * Eliminates full-entity-list scans for common query patterns:
 *   - "all buildings for player 1"
 *   - "all Woodcutter buildings for player 1"
 *   - "all units"
 *
 * Use .query() for a chainable EntityQuery builder, or the raw iterators
 * (ofType, ofTypeAndPlayer, ofTypePlayerAndSubType) for direct iteration.
 */

import type { Entity, EntityType } from './entity';
import { EntityQuery } from './entity-query';

/** Composite key for (type, player) lookups. */
function typePlayerKey(type: EntityType, player: number): number {
    // EntityType fits in low bits (0–5), player in the rest.
    return (player << 4) | type;
}

/** Entity resolver — looks up Entity by ID. */
type EntityResolver = (id: number) => Entity | undefined;

const EMPTY_SET: ReadonlySet<number> = new Set();

export class EntityIndex {
    private readonly resolve: EntityResolver;
    /** type → Set<entityId> */
    private readonly byType = new Map<EntityType, Set<number>>();
    /** (type, player) → Set<entityId> */
    private readonly byTypePlayer = new Map<number, Set<number>>();
    /** (type, player) → subType → Set<entityId> */
    private readonly byTypePlayerSubType = new Map<number, Map<number | string, Set<number>>>();

    constructor(resolve: EntityResolver) {
        this.resolve = resolve;
    }

    add(entityId: number, type: EntityType, player: number, subType: number | string): void {
        getOrCreate(this.byType, type).add(entityId);
        const tpKey = typePlayerKey(type, player);
        getOrCreate(this.byTypePlayer, tpKey).add(entityId);
        let subMap = this.byTypePlayerSubType.get(tpKey);
        if (!subMap) {
            subMap = new Map();
            this.byTypePlayerSubType.set(tpKey, subMap);
        }
        getOrCreate(subMap, subType).add(entityId);
    }

    remove(entityId: number, type: EntityType, player: number, subType: number | string): void {
        this.byType.get(type)?.delete(entityId);
        const tpKey = typePlayerKey(type, player);
        this.byTypePlayer.get(tpKey)?.delete(entityId);
        this.byTypePlayerSubType.get(tpKey)?.get(subType)?.delete(entityId);
    }

    // ── ID set accessors ───────────────────────────────────────────

    /** All entity IDs of the given type. */
    idsOfType(type: EntityType): ReadonlySet<number> {
        return this.byType.get(type) ?? EMPTY_SET;
    }

    /** All entity IDs of the given type owned by the given player. */
    idsOfTypeAndPlayer(type: EntityType, player: number): ReadonlySet<number> {
        return this.byTypePlayer.get(typePlayerKey(type, player)) ?? EMPTY_SET;
    }

    /** All entity IDs matching type, player, and subType. */
    idsOfTypePlayerAndSubType(type: EntityType, player: number, subType: number | string): ReadonlySet<number> {
        return this.byTypePlayerSubType.get(typePlayerKey(type, player))?.get(subType) ?? EMPTY_SET;
    }

    // ── Raw iterators ──────────────────────────────────────────────

    /** Iterate entities of the given type (resolves IDs to Entity objects). */
    *ofType(type: EntityType): IterableIterator<Entity> {
        const ids = this.byType.get(type);
        if (!ids) {
            return;
        }
        for (const id of ids) {
            const entity = this.resolve(id);
            if (entity) {
                yield entity;
            }
        }
    }

    /** Iterate entities of the given type and player (resolves IDs to Entity objects). */
    *ofTypeAndPlayer(type: EntityType, player: number): IterableIterator<Entity> {
        const ids = this.byTypePlayer.get(typePlayerKey(type, player));
        if (!ids) {
            return;
        }
        for (const id of ids) {
            const entity = this.resolve(id);
            if (entity) {
                yield entity;
            }
        }
    }

    /** Iterate entities matching type, player, and subType. */
    *ofTypePlayerAndSubType(type: EntityType, player: number, subType: number | string): IterableIterator<Entity> {
        const ids = this.byTypePlayerSubType.get(typePlayerKey(type, player))?.get(subType);
        if (!ids) {
            return;
        }
        for (const id of ids) {
            const entity = this.resolve(id);
            if (entity) {
                yield entity;
            }
        }
    }

    // ── Query builder ──────────────────────────────────────────────

    /** Create a chainable EntityQuery, selecting the narrowest index available. */
    query(type: EntityType, player?: number, subType?: number | string): EntityQuery {
        if (player !== undefined && subType !== undefined) {
            return new EntityQuery(this.ofTypePlayerAndSubType(type, player, subType));
        }
        if (player !== undefined) {
            return new EntityQuery(this.ofTypeAndPlayer(type, player));
        }
        return new EntityQuery(this.ofType(type));
    }

    clear(): void {
        this.byType.clear();
        this.byTypePlayer.clear();
        this.byTypePlayerSubType.clear();
    }
}

function getOrCreate<K>(map: Map<K, Set<number>>, key: K): Set<number> {
    let set = map.get(key);
    if (!set) {
        set = new Set();
        map.set(key, set);
    }
    return set;
}
