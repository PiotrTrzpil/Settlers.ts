/**
 * AnimatedEntityCategory
 *
 * Manages animated sprite entries for all entity types.
 * - Shared storage (animatedEntities): race-independent (map objects, resources)
 * - Per-race storage (animatedByRace): buildings and units
 *
 * @module renderer/sprite-metadata/categories
 */

import { EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';
import { AnimationData, AnimationSequence, ANIMATION_DEFAULTS } from '@/game/animation/animation';
import type { SpriteEntry, AnimatedSpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

// ============================================================
// Serialization types and helpers (module-private)
// ============================================================

/** Serialized form for a single AnimatedSpriteEntry (Maps converted to arrays) */
type SerializedAnimEntry = {
    staticSprite: SpriteEntry;
    isAnimated: boolean;
    animationData: {
        defaultSequence: string;
        sequences: Array<[string, Array<[number, AnimationSequence]>]>;
    };
};

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

function deserializeAnimEntry(entryData: SerializedAnimEntry): AnimatedSpriteEntry {
    const sequences = new Map<string, Map<number, AnimationSequence>>();
    for (const [seqKey, dirArr] of entryData.animationData.sequences) {
        sequences.set(seqKey, arrayToMap(dirArr));
    }
    return {
        ...entryData,
        animationData: { ...entryData.animationData, sequences },
    };
}

// ============================================================
// Serialized shape aliases (module-private)
// ============================================================

type SerializedSubTypeMap = Array<[number | string, SerializedAnimEntry]>;
type SerializedEntityTypeMap = Array<[EntityType, SerializedSubTypeMap]>;

type SerializedByRace = Array<[Race, SerializedEntityTypeMap]>;

// ============================================================
// AnimatedEntityCategory
// ============================================================

/**
 * Pin all frames' offsets to frame 0's offset so the sprite anchor stays stable
 * throughout the animation.
 */
function stabilizeFrameAnchors(frames: SpriteEntry[]): SpriteEntry[] {
    if (frames.length <= 1) {
        return frames;
    }
    const ref = frames[0]!;
    return frames.map(f =>
        f.offsetX === ref.offsetX && f.offsetY === ref.offsetY
            ? f
            : { ...f, offsetX: ref.offsetX, offsetY: ref.offsetY }
    );
}

export class AnimatedEntityCategory implements SerializableSpriteCategory {
    /**
     * Shared animated entities (map objects, resources — race-independent).
     * Maps EntityType -> subType -> AnimatedSpriteEntry
     */
    private readonly sharedEntities: Map<EntityType, Map<number | string, AnimatedSpriteEntry>> = new Map();

    /**
     * Per-race animated entities (buildings and units).
     * Maps Race -> EntityType -> subType -> AnimatedSpriteEntry
     */
    private readonly byRace: Map<Race, Map<EntityType, Map<number | string, AnimatedSpriteEntry>>> = new Map();

    /**
     * Register an animated entity with multiple directions and frames.
     *
     * @param entityType The entity type (Building, Unit, MapObject, etc.)
     * @param subType The specific type (BuildingType, UnitType, etc.)
     * @param directionFrames Map of direction index -> array of frames
     * @param frameDurationMs Duration per frame in milliseconds
     * @param loop Whether the animation loops
     * @param race Optional race for race-specific storage (buildings/units)
     * @param walkSequenceKey For units: the XML sequence key for the walk animation (e.g. 'WC_WALK').
     *        All frames are registered under walkKey. Frame 0 is the standing pose (shown when
     *        stopped=true/idle); frames 1+ form the walk cycle.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- multi-path animation setup
    register(
        entityType: EntityType,
        subType: number | string,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: Race,
        walkSequenceKey?: string
    ): void {
        if (directionFrames.size === 0) {
            return;
        }

        const directionMap = new Map<number, AnimationSequence>();
        let firstFrame: SpriteEntry | null = null;

        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) {
                continue;
            }
            if (!firstFrame) {
                firstFrame = frames[0]!;
            }
            directionMap.set(direction, { frames, frameDurationMs, loop });
        }

        if (!firstFrame) {
            return;
        }

        const sequences = new Map<string, Map<number, AnimationSequence>>();

        if (entityType === EntityType.Unit && walkSequenceKey) {
            // Register the walk animation under the XML walk key.
            // All frames are included: frame 0 is the standing/idle pose,
            // frames 1+ are the walk cycle. setIdleAnimation uses stopped=true
            // (currentFrame=0) to show the standing pose; startWalkAnimation
            // plays the full sequence in a loop.
            const walkDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 0) {
                    walkDirectionMap.set(direction, { frames, frameDurationMs, loop });
                }
            }
            sequences.set(walkSequenceKey, walkDirectionMap);
        } else {
            // Non-unit entities (buildings, map objects) or units without a walk key
            // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
            const defaultKey = walkSequenceKey ?? 'default';
            sequences.set(defaultKey, directionMap);
        }

        // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
        const defaultSequence = walkSequenceKey ?? 'default';
        const animationData: AnimationData = {
            sequences,
            defaultSequence,
        };

        const entry: AnimatedSpriteEntry = {
            staticSprite: firstFrame,
            animationData,
            isAnimated: directionFrames.size > 0,
        };

        const isRaceSpecific =
            race !== undefined && (entityType === EntityType.Building || entityType === EntityType.Unit);
        if (isRaceSpecific) {
            let raceMap = this.byRace.get(race);
            if (!raceMap) {
                raceMap = new Map();
                this.byRace.set(race, raceMap);
            }
            let subTypeMap = raceMap.get(entityType);
            if (!subTypeMap) {
                subTypeMap = new Map();
                raceMap.set(entityType, subTypeMap);
            }
            subTypeMap.set(subType, entry);
        } else {
            let subTypeMap = this.sharedEntities.get(entityType);
            if (!subTypeMap) {
                subTypeMap = new Map();
                this.sharedEntities.set(entityType, subTypeMap);
            }
            subTypeMap.set(subType, entry);
        }
    }

    /**
     * Register an additional animation sequence on an already-registered animated entity.
     */
    registerSequence(
        entityType: EntityType,
        subType: number | string,
        sequenceKey: string,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: Race
    ): void {
        const entry =
            race !== undefined
                ? this.byRace.get(race)?.get(entityType)?.get(subType)
                : this.sharedEntities.get(entityType)?.get(subType);
        if (!entry) {
            return;
        }

        const directionMap = new Map<number, AnimationSequence>();
        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) {
                continue;
            }
            directionMap.set(direction, { frames: stabilizeFrameAnchors(frames), frameDurationMs, loop });
        }

        if (directionMap.size > 0) {
            entry.animationData.sequences.set(sequenceKey, directionMap);
        }
    }

    /**
     * Get animated entity data. Checks race-specific storage first (for buildings/units),
     * then falls back to shared storage (for map objects, resources).
     */
    getEntry(entityType: EntityType, subType: number | string, race?: Race): AnimatedSpriteEntry | undefined {
        if (race !== undefined) {
            const raceEntry = this.byRace.get(race)?.get(entityType)?.get(subType);
            if (raceEntry) {
                return raceEntry;
            }
        }
        return this.sharedEntities.get(entityType)?.get(subType);
    }

    /**
     * Check if an entity type/subtype has animation data.
     */
    hasAnimation(entityType: EntityType, subType: number | string, race?: Race): boolean {
        // eslint-disable-next-line no-restricted-syntax -- entry may not exist for this entity type/subtype; false is correct for "no animation"
        return this.getEntry(entityType, subType, race)?.isAnimated ?? false;
    }

    clear(): void {
        this.sharedEntities.clear();
        this.byRace.clear();
    }

    // ============================================================
    // Serialization
    // ============================================================

    /**
     * Serialize sharedEntities to a JSON-safe array structure.
     */
    serializeShared(): SerializedEntityTypeMap {
        return mapToArray(this.sharedEntities).map(([entityType, subTypeMap]) => [
            entityType,
            mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)]),
        ]);
    }

    /**
     * Serialize byRace to a JSON-safe array structure.
     */
    serializeByRace(): SerializedByRace {
        return mapToArray(this.byRace).map(([race, entityTypeMap]) => [
            race,
            mapToArray(entityTypeMap).map(([entityType, subTypeMap]) => [
                entityType,
                mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)]),
            ]),
        ]);
    }

    /**
     * Serialize both shared and byRace data as an opaque blob.
     * Satisfies the SerializableSpriteCategory interface.
     */
    serialize(): unknown {
        return {
            shared: this.serializeShared(),
            byRace: this.serializeByRace(),
        };
    }

    /**
     * Reconstruct an AnimatedEntityCategory from serialized shared and byRace data.
     */
    static deserialize(sharedData: unknown, byRaceData: unknown): AnimatedEntityCategory {
        const category = new AnimatedEntityCategory();

        for (const [entityType, subTypeArr] of sharedData as SerializedEntityTypeMap) {
            const subTypeMap = new Map<number | string, AnimatedSpriteEntry>();
            for (const [subType, entryData] of subTypeArr) {
                subTypeMap.set(subType, deserializeAnimEntry(entryData));
            }
            category.sharedEntities.set(entityType, subTypeMap);
        }

        for (const [race, entityTypeArr] of byRaceData as SerializedByRace) {
            const entityTypeMap = new Map<EntityType, Map<number | string, AnimatedSpriteEntry>>();
            for (const [entityType, subTypeArr] of entityTypeArr) {
                const subTypeMap = new Map<number | string, AnimatedSpriteEntry>();
                for (const [subType, entryData] of subTypeArr) {
                    subTypeMap.set(subType, deserializeAnimEntry(entryData));
                }
                entityTypeMap.set(entityType, subTypeMap);
            }
            category.byRace.set(race, entityTypeMap);
        }

        return category;
    }
}
