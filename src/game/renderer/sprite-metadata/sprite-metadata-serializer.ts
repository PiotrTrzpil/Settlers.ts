/**
 * SpriteMetadataSerializer
 *
 * Handles serialization and deserialization of all sprite category data
 * for caching purposes. Converts Maps to arrays for JSON compatibility
 * and back again on load.
 *
 * @module renderer/sprite-metadata
 */

import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { AnimationSequence } from '@/game/animation';
import { mapToArray, arrayToMap } from './sprite-metadata-helpers';
import {
    BuildingSpriteCategory,
    UnitSpriteCategory,
    MapObjectSpriteCategory,
    GoodSpriteCategory,
    DecorationSpriteCategory,
    AnimatedEntityCategory,
} from './categories';
import type { AnimatedSpriteEntry, SpriteEntry } from './types';

/** Serialized form for a single AnimatedSpriteEntry (Maps converted to arrays) */
type SerializedAnimEntry = {
    staticSprite: SpriteEntry;
    isAnimated: boolean;
    animationData: {
        defaultSequence: string;
        sequences: Array<[string, Array<[number, AnimationSequence]>]>;
    };
};

// ============================================================
// Helpers
// ============================================================

function serializeAnimEntry(entry: AnimatedSpriteEntry): SerializedAnimEntry {
    const sequences = mapToArray(entry.animationData.sequences).map(([seqKey, dirMap]) => {
        return [seqKey, mapToArray(dirMap)] as [string, Array<[number, AnimationSequence]>];
    });
    return {
        ...entry,
        animationData: {
            ...entry.animationData,
            sequences,
        },
    };
}

function deserializeAnimEntry(entryData: any): AnimatedSpriteEntry {
    const sequences = new Map<string, Map<number, AnimationSequence>>();
    if (entryData.animationData?.sequences) {
        for (const [seqKey, dirArr] of entryData.animationData.sequences) {
            sequences.set(seqKey, arrayToMap(dirArr));
        }
    }
    return {
        ...entryData,
        animationData: { ...entryData.animationData, sequences },
    };
}

// ============================================================
// SpriteMetadataSerializer
// ============================================================

/**
 * Serializes and deserializes sprite category data for caching.
 * Operates on category instances directly, keeping all Map/array
 * conversion logic in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- static utility namespace for serialization
export class SpriteMetadataSerializer {
    /**
     * Serialize all category data into a plain JSON-compatible record.
     */
    static serialize(
        buildings: BuildingSpriteCategory,
        units: UnitSpriteCategory,
        mapObjects: MapObjectSpriteCategory,
        goods: GoodSpriteCategory,
        decoration: DecorationSpriteCategory,
        animated: AnimatedEntityCategory,
        loadedRaces: ReadonlySet<number>
    ): Record<string, unknown> {
        // Per-race buildings
        const serializedBuildings = mapToArray(buildings.getRaceMap()).map(([race, typeMap]) => [
            race,
            mapToArray(typeMap),
        ]);

        // Per-race units
        const serializedUnits = mapToArray(units.getRaceMap()).map(([race, typeMap]) => [
            race,
            mapToArray(typeMap).map(([k, v]) => [k, mapToArray(v)]),
        ]);

        // Shared animated entities (map objects, resources)
        const serializedAnimatedEntities = mapToArray(animated.getSharedEntities()).map(([entityType, subTypeMap]) => [
            entityType,
            mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)]),
        ]);

        // Race-specific animated entities (buildings, units)
        const serializedAnimatedByRace = mapToArray(animated.getByRace()).map(([race, entityTypeMap]) => {
            const entityTypes = mapToArray(entityTypeMap).map(([entityType, subTypeMap]) => [
                entityType,
                mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)]),
            ]);
            return [race, entityTypes];
        });

        return {
            buildingsByRace: serializedBuildings,
            mapObjects: mapToArray(mapObjects.getEntries()),
            goods: mapToArray(goods.getEntries()).map(([k, v]) => [k, mapToArray(v)]),
            unitsByRace: serializedUnits,
            flags: mapToArray(decoration.getFlagsMap()),
            territoryDots: mapToArray(decoration.getTerritoryDotsMap()),
            animatedEntities: serializedAnimatedEntities,
            animatedByRace: serializedAnimatedByRace,
            loadedRaces: [...loadedRaces],
        };
    }

    /**
     * Deserialize cached data back into category instances.
     * Returns populated category instances ready for use.
     */
    static deserialize(data: any): {
        buildings: BuildingSpriteCategory;
        units: UnitSpriteCategory;
        mapObjects: MapObjectSpriteCategory;
        goods: GoodSpriteCategory;
        decoration: DecorationSpriteCategory;
        animated: AnimatedEntityCategory;
        loadedRaces: Set<number>;
    } {
        const buildings = new BuildingSpriteCategory();
        const units = new UnitSpriteCategory();
        const mapObjects = new MapObjectSpriteCategory();
        const goods = new GoodSpriteCategory();
        const decoration = new DecorationSpriteCategory();
        const animated = new AnimatedEntityCategory();
        const loadedRaces = new Set<number>();

        SpriteMetadataSerializer.deserializeBuildings(data, buildings, loadedRaces);
        SpriteMetadataSerializer.deserializeUnits(data, units, loadedRaces);
        SpriteMetadataSerializer.deserializeMapObjects(data, mapObjects);
        SpriteMetadataSerializer.deserializeGoods(data, goods);
        SpriteMetadataSerializer.deserializeDecoration(data, decoration);
        SpriteMetadataSerializer.deserializeAnimated(data, animated);
        SpriteMetadataSerializer.deserializeLegacyLoadedRaces(data, loadedRaces);

        return { buildings, units, mapObjects, goods, decoration, animated, loadedRaces };
    }

    // ---- Private deserialization helpers ----

    private static deserializeBuildings(data: any, buildings: BuildingSpriteCategory, loadedRaces: Set<number>): void {
        if (data.buildingsByRace) {
            for (const [race, typeArr] of data.buildingsByRace) {
                buildings.setRaceEntry(race, arrayToMap(typeArr));
                loadedRaces.add(race);
            }
        } else if (data.buildings) {
            // Legacy: single-race buildings stored without race key — treat as Race.Roman (10)
            buildings.setRaceEntry(10, arrayToMap(data.buildings));
            loadedRaces.add(10);
        }
    }

    private static deserializeUnits(data: any, units: UnitSpriteCategory, loadedRaces: Set<number>): void {
        if (data.unitsByRace) {
            for (const [race, typeArr] of data.unitsByRace) {
                units.setRaceEntry(
                    race,
                    new Map(
                        (typeArr as Array<[UnitType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [k, arrayToMap(v)])
                    )
                );
                loadedRaces.add(race);
            }
        } else if (data.units) {
            // Legacy: single-race units — treat as Race.Roman (10)
            units.setRaceEntry(
                10,
                new Map(
                    (data.units as Array<[UnitType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [k, arrayToMap(v)])
                )
            );
            loadedRaces.add(10);
        }
    }

    private static deserializeMapObjects(data: any, mapObjects: MapObjectSpriteCategory): void {
        if (data.mapObjects) mapObjects.setEntries(arrayToMap(data.mapObjects));
    }

    private static deserializeGoods(data: any, goods: GoodSpriteCategory): void {
        if (data.goods) {
            goods.setEntries(
                new Map(
                    (data.goods as Array<[EMaterialType, Array<[number, SpriteEntry]>]>).map(([k, v]) => [
                        k,
                        arrayToMap(v),
                    ])
                )
            );
        }
    }

    private static deserializeDecoration(data: any, decoration: DecorationSpriteCategory): void {
        if (data.flags) decoration.setFlagsMap(arrayToMap(data.flags));
        if (data.territoryDots) decoration.setTerritoryDotsMap(arrayToMap(data.territoryDots));
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity -- legacy format compat requires branching
    private static deserializeAnimated(data: any, animated: AnimatedEntityCategory): void {
        // Shared animated entities (map objects, resources)
        if (data.animatedEntities) {
            for (const [entityType, subTypeArr] of data.animatedEntities) {
                const subTypeMap = new Map<number, AnimatedSpriteEntry>();
                for (const [subType, entryData] of subTypeArr) {
                    subTypeMap.set(subType, deserializeAnimEntry(entryData));
                }
                animated.setSharedEntry(entityType, subTypeMap);
            }
        }

        // Race-specific animated entities (buildings, units)
        if (data.animatedByRace) {
            for (const [race, entityTypeArr] of data.animatedByRace) {
                for (const [entityType, subTypeArr] of entityTypeArr) {
                    const subTypeMap = new Map<number, AnimatedSpriteEntry>();
                    for (const [subType, entryData] of subTypeArr) {
                        subTypeMap.set(subType, deserializeAnimEntry(entryData));
                    }
                    animated.setByRaceEntry(race, entityType, subTypeMap);
                }
            }
        }

        // Legacy format: animatedBuildings, animatedMapObjects, animatedUnits
        SpriteMetadataSerializer.deserializeLegacyAnimated(data.animatedBuildings, EntityType.Building, animated);
        SpriteMetadataSerializer.deserializeLegacyAnimated(data.animatedMapObjects, EntityType.MapObject, animated);
        SpriteMetadataSerializer.deserializeLegacyAnimated(data.animatedUnits, EntityType.Unit, animated);
    }

    private static deserializeLegacyAnimated(
        legacyData: Array<[number, any]> | undefined,
        entityType: EntityType,
        animated: AnimatedEntityCategory
    ): void {
        if (!legacyData) return;
        const subTypeMap = new Map<number, AnimatedSpriteEntry>();
        for (const [type, entryData] of legacyData) {
            subTypeMap.set(type, deserializeAnimEntry(entryData));
        }
        animated.setSharedEntry(entityType, subTypeMap);
    }

    private static deserializeLegacyLoadedRaces(data: any, loadedRaces: Set<number>): void {
        if (data.loadedRaces) {
            for (const race of data.loadedRaces) loadedRaces.add(race);
        }
    }
}
