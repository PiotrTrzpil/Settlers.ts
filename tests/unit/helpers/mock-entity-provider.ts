/**
 * Mock EntityProvider for unit tests.
 * Auto-creates entities on first access to simplify test setup.
 */

import type { Entity, EntityProvider } from '@/game/entity';
import { EntityType, UnitType } from '@/game/entity';

/**
 * Mock entity provider that auto-creates entities when accessed.
 * This simplifies test setup - no need to manually create entities
 * before creating carrier/building state.
 */
export class MockEntityProvider implements EntityProvider {
    private entityMap = new Map<number, Entity>();
    private _entities: Entity[] = [];

    get entities(): Entity[] {
        return this._entities;
    }

    getEntity(id: number): Entity | undefined {
        // Auto-create entity if it doesn't exist (simplifies test setup)
        if (!this.entityMap.has(id)) {
            const entity: Entity = {
                id,
                type: EntityType.Unit,
                subType: UnitType.Carrier,
                x: 0,
                y: 0,
                player: 0,
            };
            this.entityMap.set(id, entity);
            this._entities.push(entity);
        }
        return this.entityMap.get(id);
    }

    /**
     * Manually add an entity with specific properties.
     */
    addEntity(entity: Entity): Entity {
        this.entityMap.set(entity.id, entity);
        this._entities.push(entity);
        return entity;
    }

    /**
     * Clear all entities.
     */
    clear(): void {
        this.entityMap.clear();
        this._entities = [];
    }
}
