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
import { AnimationData, AnimationSequence, ANIMATION_DEFAULTS, ANIMATION_SEQUENCES } from '@/game/animation';
import type { SpriteEntry, AnimatedSpriteEntry } from '../types';

/**
 * Pin all frames' offsets to frame 0's offset so the sprite anchor stays stable
 * throughout the animation.
 */
function stabilizeFrameAnchors(frames: SpriteEntry[]): SpriteEntry[] {
    if (frames.length <= 1) return frames;
    const ref = frames[0]!;
    return frames.map(f =>
        f.offsetX === ref.offsetX && f.offsetY === ref.offsetY
            ? f
            : { ...f, offsetX: ref.offsetX, offsetY: ref.offsetY }
    );
}

export class AnimatedEntityCategory {
    /**
     * Shared animated entities (map objects, resources — race-independent).
     * Maps EntityType -> subType -> AnimatedSpriteEntry
     */
    private readonly sharedEntities: Map<EntityType, Map<number, AnimatedSpriteEntry>> = new Map();

    /**
     * Per-race animated entities (buildings and units).
     * Maps Race -> EntityType -> subType -> AnimatedSpriteEntry
     */
    private readonly byRace: Map<number, Map<EntityType, Map<number, AnimatedSpriteEntry>>> = new Map();

    /**
     * Register an animated entity with multiple directions and frames.
     *
     * @param entityType The entity type (Building, Unit, MapObject, etc.)
     * @param subType The specific type (BuildingType, UnitType, etc.)
     * @param directionFrames Map of direction index -> array of frames
     * @param frameDurationMs Duration per frame in milliseconds
     * @param loop Whether the animation loops
     * @param race Optional race for race-specific storage (buildings/units)
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity, complexity -- multi-path animation setup
    register(
        entityType: EntityType,
        subType: number,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: number
    ): void {
        if (directionFrames.size === 0) return;

        const directionMap = new Map<number, AnimationSequence>();
        let firstFrame: SpriteEntry | null = null;

        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;
            if (!firstFrame) firstFrame = frames[0]!;
            directionMap.set(direction, { frames, frameDurationMs, loop });
        }

        if (!firstFrame) return;

        const sequences = new Map<string, Map<number, AnimationSequence>>();

        if (entityType === EntityType.Unit) {
            // Idle sequence: just frame 0 for each direction
            const idleDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 0) {
                    idleDirectionMap.set(direction, {
                        frames: [frames[0]!],
                        frameDurationMs,
                        loop: false,
                    });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, idleDirectionMap);

            // Walk sequence: frames 1+ (skip standing frame)
            const walkDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 1) {
                    walkDirectionMap.set(direction, {
                        frames: frames.slice(1),
                        frameDurationMs,
                        loop,
                    });
                } else if (frames.length === 1) {
                    walkDirectionMap.set(direction, { frames, frameDurationMs, loop });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.WALK, walkDirectionMap);
        } else {
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, directionMap);
        }

        const animationData: AnimationData = {
            sequences,
            defaultSequence: ANIMATION_SEQUENCES.DEFAULT,
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
        subType: number,
        sequenceKey: string,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true,
        race?: number
    ): void {
        const entry =
            race !== undefined
                ? this.byRace.get(race)?.get(entityType)?.get(subType)
                : this.sharedEntities.get(entityType)?.get(subType);
        if (!entry) return;

        const directionMap = new Map<number, AnimationSequence>();
        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;
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
    getEntry(entityType: EntityType, subType: number, race?: number): AnimatedSpriteEntry | null {
        if (race !== undefined) {
            const raceEntry = this.byRace.get(race)?.get(entityType)?.get(subType);
            if (raceEntry) return raceEntry;
        }
        return this.sharedEntities.get(entityType)?.get(subType) ?? null;
    }

    /**
     * Check if an entity type/subtype has animation data.
     */
    hasAnimation(entityType: EntityType, subType: number, race?: number): boolean {
        return this.getEntry(entityType, subType, race)?.isAnimated ?? false;
    }

    clear(): void {
        this.sharedEntities.clear();
        this.byRace.clear();
    }

    /**
     * Expose internal maps for serialization.
     */
    getSharedEntities(): Map<EntityType, Map<number, AnimatedSpriteEntry>> {
        return this.sharedEntities;
    }

    getByRace(): Map<number, Map<EntityType, Map<number, AnimatedSpriteEntry>>> {
        return this.byRace;
    }

    /**
     * Directly insert into shared entities (used during deserialization).
     */
    setSharedEntry(entityType: EntityType, subTypeMap: Map<number, AnimatedSpriteEntry>): void {
        this.sharedEntities.set(entityType, subTypeMap);
    }

    /**
     * Directly insert into race-specific map (used during deserialization).
     */
    setByRaceEntry(race: number, entityType: EntityType, subTypeMap: Map<number, AnimatedSpriteEntry>): void {
        let raceMap = this.byRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.byRace.set(race, raceMap);
        }
        raceMap.set(entityType, subTypeMap);
    }
}
