/**
 * CarrierRegistry — lightweight set-based carrier membership tracker.
 *
 * Replaces the former CarrierManager class. CarrierState was { entityId } —
 * pure identity with no payload — so a Set<number> + ComponentStore adapter
 * is all that's needed.
 */

import type { EntityProvider } from '../entity';
import { EntityType, UnitType } from '../entity';
import { type ComponentStore, setStore } from '../ecs';
import { createLogger } from '@/utilities/logger';

const log = createLogger('CarrierRegistry');

export interface CarrierRegistryConfig {
    entityProvider: EntityProvider;
}

export class CarrierRegistry {
    private readonly entityProvider: EntityProvider;
    private readonly ids = new Set<number>();

    /** ComponentStore for ECS-style queries (e.g. `query(carrierRegistry.store, gameState.store)`). */
    readonly store: ComponentStore<{ entityId: number }> = setStore(this.ids);

    constructor(config: CarrierRegistryConfig) {
        this.entityProvider = config.entityProvider;
    }

    register(entityId: number): void {
        if (!this.entityProvider.getEntity(entityId)) {
            throw new Error(`Cannot register carrier: entity ${entityId} not found`);
        }
        if (this.ids.has(entityId)) {
            throw new Error(`Carrier ${entityId} already registered`);
        }
        this.ids.add(entityId);
        log.debug(`Registered carrier ${entityId}`);
    }

    remove(entityId: number): boolean {
        return this.ids.delete(entityId);
    }

    has(entityId: number): boolean {
        return this.ids.has(entityId);
    }

    get size(): number {
        return this.ids.size;
    }

    [Symbol.iterator](): IterableIterator<number> {
        return this.ids.values();
    }

    clear(): void {
        this.ids.clear();
    }

    /**
     * Rebuild carrier registry from the entity table after replay/restore.
     * Scans all entities and registers those with UnitType.Carrier.
     */
    rebuildFromEntities(): void {
        this.ids.clear();
        for (const entity of this.entityProvider.entities) {
            if (entity.type === EntityType.Unit && entity.subType === UnitType.Carrier) {
                this.ids.add(entity.id);
            }
        }
        log.debug(`Rebuilt carrier registry: ${this.ids.size} carriers`);
    }
}
