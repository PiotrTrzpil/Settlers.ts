/**
 * Unit tests for WorldSounds: frame-synced animation sounds and event sounds,
 * with distance/pan, culling, per-frame budget and same-sound cooldown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorldSounds, findCrossedSound, type JobSound, type SoundListener, type SoundName } from '@/game/audio';
import { EntityVisualService, type AnimationPlayback } from '@/game/animation/entity-visual-service';
import { EventBus } from '@/game/event-bus';
import type { Entity } from '@/game/entity';

const AXE: JobSound[] = [{ sound: 'WORK_AXE', frame: 2 }];

function playback(sequenceKey: string, currentFrame: number, loop = true): AnimationPlayback {
    return {
        sequenceKey,
        currentFrame,
        loop,
        direction: 0,
        elapsedMs: 0,
        playing: true,
        hideOnComplete: false,
        reverse: false,
    };
}

describe('findCrossedSound', () => {
    it('fires when a fresh animation reaches the trigger frame', () => {
        expect(findCrossedSound(AXE, undefined, playback('WC', 1), 5)).toBeNull();
        expect(findCrossedSound(AXE, { sequenceKey: 'WC', frame: 1 }, playback('WC', 2), 5)).toBe('WORK_AXE');
    });

    it('fires again on every loop cycle', () => {
        // frames 6..7 → indices 1..2 in a 5-frame loop
        expect(findCrossedSound(AXE, { sequenceKey: 'WC', frame: 6 }, playback('WC', 7), 5)).toBe('WORK_AXE');
        expect(findCrossedSound(AXE, { sequenceKey: 'WC', frame: 7 }, playback('WC', 9), 5)).toBeNull();
    });

    it('fires only once for non-looping animations', () => {
        expect(findCrossedSound(AXE, { sequenceKey: 'WC', frame: 6 }, playback('WC', 7, false), 5)).toBeNull();
    });

    it('does not replay a backlog when an animation comes into earshot mid-way', () => {
        expect(findCrossedSound(AXE, undefined, playback('WC', 12), 5)).toBeNull();
    });

    it('treats a frame counter reset as a restart', () => {
        expect(findCrossedSound(AXE, { sequenceKey: 'WC', frame: 9 }, playback('WC', 2), 5)).toBe('WORK_AXE');
    });
});

describe('WorldSounds', () => {
    const listener: SoundListener = { x: 50, y: 50, radius: 20 };
    let eventBus: EventBus;
    let visuals: EntityVisualService;
    let entities: Map<number, Entity>;
    let play: ReturnType<typeof vi.fn<(name: SoundName, gain: number, pan: number) => number | null>>;
    let sounds: WorldSounds;

    function addEntity(id: number, x: number, y: number): void {
        entities.set(id, { id, x, y } as Entity);
        visuals.init(id);
    }

    beforeEach(() => {
        eventBus = new EventBus();
        visuals = new EntityVisualService();
        entities = new Map();
        play = vi.fn<(name: SoundName, gain: number, pan: number) => number | null>(() => 1);
        sounds = new WorldSounds({ eventBus, visualService: visuals, getEntity: id => entities.get(id), play });
        sounds.setJobSounds(new Map([['WC_CUT_TREE', AXE]]));
    });

    afterEach(() => sounds.destroy());

    it('plays an animation sound at the trigger frame, centered at full volume', () => {
        addEntity(1, 50, 50);
        visuals.play(1, 'WC_CUT_TREE', { loop: true });
        sounds.update(listener, 0, () => 8);
        visuals.update(250); // frame 0 → 2
        sounds.update(listener, 1000, () => 8);
        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith('WORK_AXE', 1, 0);
    });

    it('ignores entities outside the audible radius', () => {
        addEntity(1, 200, 50);
        visuals.play(1, 'WC_CUT_TREE', { loop: true });
        sounds.update(listener, 0, () => 8);
        visuals.update(250);
        sounds.update(listener, 1000, () => 8);
        expect(play).not.toHaveBeenCalled();
    });

    it('plays event sounds with distance attenuation and pan', () => {
        addEntity(2, 60, 50); // 10 tiles to the right
        sounds.update(listener, 0, () => null);
        eventBus.emit('combat:unitDefeated', { unitId: 2, defeatedBy: 1, level: 'info' });
        const [name, gain, pan] = play.mock.calls[0]!;
        expect(name).toBe('FIGHT_DIE');
        expect(gain).toBeCloseTo(0.65);
        expect(pan).toBeCloseTo(0.35);
    });

    it('throttles repeats of the same sound', () => {
        addEntity(3, 50, 50);
        sounds.update(listener, 0, () => null);
        eventBus.emit('tree:cut', { entityId: 3 });
        eventBus.emit('tree:cut', { entityId: 3 });
        expect(play).toHaveBeenCalledTimes(1);
        sounds.update(listener, 500, () => null);
        eventBus.emit('tree:cut', { entityId: 3 });
        expect(play).toHaveBeenCalledTimes(2);
    });

    it('stops listening to events after destroy', () => {
        addEntity(4, 50, 50);
        sounds.update(listener, 0, () => null);
        sounds.destroy();
        eventBus.emit('tree:cut', { entityId: 4 });
        expect(play).not.toHaveBeenCalled();
    });
});
