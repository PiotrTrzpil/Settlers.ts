/**
 * EntityIndex — fast lookup of entities by type and player.
 *
 * Maintained automatically by GameState on add/remove.
 * Eliminates full-entity-list scans for the common query patterns:
 *   - "all buildings for player 1"
 *   - "all units"
 *   - "all map objects"
 */

import type { Entity, EntityType } from './entity';

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

    constructor(resolve: EntityResolver) {
        this.resolve = resolve;
    }

    add(entityId: number, type: EntityType, player: number): void {
        getOrCreate(this.byType, type).add(entityId);
        getOrCreate(this.byTypePlayer, typePlayerKey(type, player)).add(entityId);
    }

    remove(entityId: number, type: EntityType, player: number): void {
        this.byType.get(type)?.delete(entityId);
        this.byTypePlayer.get(typePlayerKey(type, player))?.delete(entityId);
    }

    /** All entity IDs of the given type. */
    idsOfType(type: EntityType): ReadonlySet<number> {
        return this.byType.get(type) ?? EMPTY_SET;
    }

    /** All entity IDs of the given type owned by the given player. */
    idsOfTypeAndPlayer(type: EntityType, player: number): ReadonlySet<number> {
        return this.byTypePlayer.get(typePlayerKey(type, player)) ?? EMPTY_SET;
    }

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

    clear(): void {
        this.byType.clear();
        this.byTypePlayer.clear();
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
