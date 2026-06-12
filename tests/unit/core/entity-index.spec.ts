/**
 * Unit tests for EntityIndex.query — index selection across the
 * (type, player?, subType?) parameter combinations.
 *
 * Regression: query(type, undefined, subType) used to silently drop the
 * subType constraint and return all entities of the type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityIndex } from '@/game/entity-index';
import { EntityType, type Entity } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';

function makeEntity(id: number, type: EntityType, player: number, subType: number | string): Entity {
    return {
        id,
        type,
        x: 0,
        y: 0,
        player,
        subType,
        race: Race.Roman,
        selectable: true,
        operational: true,
    };
}

let entities: Map<number, Entity>;
let index: EntityIndex;

function add(id: number, type: EntityType, player: number, subType: number | string): void {
    entities.set(id, makeEntity(id, type, player, subType));
    index.add(id, type, player, subType);
}

beforeEach(() => {
    entities = new Map();
    index = new EntityIndex(id => entities.get(id));

    add(1, EntityType.Unit, 0, UnitType.Carrier);
    add(2, EntityType.Unit, 0, UnitType.Woodcutter);
    add(3, EntityType.Unit, 1, UnitType.Carrier);
    add(4, EntityType.Building, 0, BuildingType.WoodcutterHut);
    add(5, EntityType.Building, 1, BuildingType.Sawmill);
});

describe('EntityIndex.query', () => {
    it('filters by type only', () => {
        expect(index.query(EntityType.Unit).count()).toBe(3);
        expect(index.query(EntityType.Building).count()).toBe(2);
    });

    it('filters by type and player', () => {
        const ids = index
            .query(EntityType.Unit, 0)
            .toArray()
            .map(e => e.id)
            .sort((a, b) => a - b);
        expect(ids).toEqual([1, 2]);
    });

    it('filters by type, player, and subType', () => {
        const ids = index.query(EntityType.Unit, 0, UnitType.Carrier).toArray();
        expect(ids.map(e => e.id)).toEqual([1]);
    });

    it('filters by type and subType across all players (player omitted)', () => {
        const ids = index
            .query(EntityType.Unit, undefined, UnitType.Carrier)
            .toArray()
            .map(e => e.id)
            .sort((a, b) => a - b);
        expect(ids).toEqual([1, 3]);
    });

    it('returns nothing for a subType no entity has (player omitted)', () => {
        expect(index.query(EntityType.Building, undefined, BuildingType.Castle).count()).toBe(0);
    });

    it('reflects removals in subType queries with player omitted', () => {
        index.remove(3, EntityType.Unit, 1, UnitType.Carrier);
        entities.delete(3);

        const ids = index.query(EntityType.Unit, undefined, UnitType.Carrier).toArray();
        expect(ids.map(e => e.id)).toEqual([1]);
    });
});
