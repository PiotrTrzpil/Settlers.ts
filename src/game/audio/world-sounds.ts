/**
 * WorldSounds — positional sound effects for things happening on the map.
 *
 * - Animation sounds: when a playing animation (jobPart, e.g. WC_CUT_TREE) reaches the
 *   frame listed in GameData/jobSoundList.xml, its sound plays at the entity.
 * - Event sounds: deaths, falling trees and tower archers, driven by game events.
 *
 * Only entities near the camera are heard; volume and stereo pan follow the camera.
 * This is presentation only — it never touches game state.
 */

import type { EventBus } from '@/game/event-bus';
import { EventSubscriptionManager } from '@/game/event-bus';
import type { Entity } from '@/game/entity';
import type { SoundName } from './sound-manifest';
import type { JobSound } from './job-sound-list';
import { positionalMix, tileDistance, type SoundListener } from './sound-position';

/** The parts of an entity's animation playback that sound timing needs. */
export interface AnimationFrameState {
    sequenceKey: string;
    direction: number;
    currentFrame: number;
    loop: boolean;
}

/** Source of currently playing animations (implemented by EntityVisualService). */
export interface AnimationSource {
    forEachAnimation(visit: (entityId: number, animation: Readonly<AnimationFrameState>) => void): void;
}

/** Number of frames in an entity's current animation, or null if unknown. */
export type FrameCountLookup = (entity: Entity, animation: Readonly<AnimationFrameState>) => number | null;

export interface WorldSoundsDeps {
    eventBus: EventBus;
    visualService: AnimationSource;
    getEntity: (id: number) => Entity | undefined;
    play: (name: SoundName, gain: number, pan: number) => number | null;
}

/** Max new sounds started per frame (keeps big crowds from turning into noise). */
const MAX_SOUNDS_PER_FRAME = 4;
/** Minimum time between two plays of the same sound. */
const SAME_SOUND_COOLDOWN_MS = 120;

interface TrackedAnimation {
    sequenceKey: string;
    frame: number;
}

export class WorldSounds {
    private jobSounds = new Map<string, JobSound[]>();
    private tracked = new Map<number, TrackedAnimation>();
    private lastPlayed = new Map<SoundName, number>();
    private readonly subscriptions = new EventSubscriptionManager();
    private listener: SoundListener | null = null;
    private nowMs = 0;
    private budget = MAX_SOUNDS_PER_FRAME;

    constructor(private readonly deps: WorldSoundsDeps) {
        const { eventBus } = deps;
        this.subscriptions.subscribe(eventBus, 'combat:unitDefeated', e => this.playAtEntity('FIGHT_DIE', e.unitId));
        this.subscriptions.subscribe(eventBus, 'tree:cut', e => this.playAtEntity('WORK_TREEFALL', e.entityId));
        this.subscriptions.subscribe(eventBus, 'garrison:bowmanFired', e =>
            this.playAtEntity('FIGHT_BOW', e.buildingId)
        );
    }

    setJobSounds(jobSounds: Map<string, JobSound[]>): void {
        this.jobSounds = jobSounds;
    }

    /** Call once per rendered frame, after animations have advanced. */
    update(listener: SoundListener, nowMs: number, frameCount: FrameCountLookup): void {
        this.listener = listener;
        this.nowMs = nowMs;
        this.budget = MAX_SOUNDS_PER_FRAME;

        const next = new Map<number, TrackedAnimation>();
        this.deps.visualService.forEachAnimation((entityId, animation) => {
            const sounds = this.jobSounds.get(animation.sequenceKey);
            if (!sounds) {
                return;
            }
            const entity = this.deps.getEntity(entityId);
            if (!entity || !this.isAudible(entity)) {
                return;
            }
            const previous = this.tracked.get(entityId);
            next.set(entityId, { sequenceKey: animation.sequenceKey, frame: animation.currentFrame });
            const sound = findCrossedSound(sounds, previous, animation, frameCount(entity, animation));
            if (sound) {
                this.playAt(sound, entity);
            }
        });
        this.tracked = next;
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
        this.tracked.clear();
    }

    private playAtEntity(name: SoundName, entityId: number): void {
        const entity = this.deps.getEntity(entityId);
        if (entity) {
            this.playAt(name, entity);
        }
    }

    private isAudible(entity: Entity): boolean {
        return this.listener !== null && tileDistance(entity, this.listener) <= this.listener.radius;
    }

    private playAt(name: SoundName, entity: Entity): void {
        const listener = this.listener;
        if (!listener || this.budget <= 0) {
            return;
        }
        const mix = positionalMix(listener, entity);
        if (!mix) {
            return;
        }
        const last = this.lastPlayed.get(name);
        if (last !== undefined && this.nowMs - last < SAME_SOUND_COOLDOWN_MS) {
            return;
        }
        this.lastPlayed.set(name, this.nowMs);
        this.budget--;
        this.deps.play(name, mix.gain, mix.pan);
    }
}

/**
 * Return the sound whose trigger frame the animation passed since the last update, if any.
 * Handles looping (frame counter keeps growing; trigger repeats every `frameCount` frames)
 * and restarts (counter went backwards or the sequence changed).
 */
export function findCrossedSound(
    sounds: readonly JobSound[],
    previous: TrackedAnimation | undefined,
    animation: Readonly<AnimationFrameState>,
    frameCount: number | null
): SoundName | null {
    const now = animation.currentFrame;
    let from: number;
    if (!previous || previous.sequenceKey !== animation.sequenceKey) {
        // Fresh start → include frame 0. Came into earshot mid-animation → no backlog.
        from = now <= 1 ? -1 : now;
    } else if (now < previous.frame) {
        from = -1;
    } else {
        from = previous.frame;
    }

    const cycle = animation.loop && frameCount ? frameCount : null;
    if (cycle !== null) {
        from = Math.max(from, now - cycle);
    }
    for (let f = from + 1; f <= now; f++) {
        const index = cycle !== null ? f % cycle : f;
        const hit = sounds.find(s => s.frame === index);
        if (hit) {
            return hit.sound;
        }
    }
    return null;
}
