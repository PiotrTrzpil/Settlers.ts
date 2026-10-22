/**
 * Unit tests for AmbientSounds: terrain classification, source rest times,
 * the concurrent-sound cap and animal buildings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AmbientSounds, classifyTerrain, type AmbientSoundsDeps, type SoundListener } from '@/game/audio';

const listener: SoundListener = { x: 50, y: 50, radius: 20 };

describe('classifyTerrain', () => {
    const noTrees = () => false;
    it.each([
        [0, 'ocean'],
        [8, 'ocean'],
        [97, 'river'],
        [48, 'beach'],
        [64, 'desert'],
        [32, 'mountain'],
        [128, 'mountain'],
        [80, 'swamp'],
    ])('ground type %i → %s', (groundType, source) => {
        expect(classifyTerrain(groundType, noTrees)).toBe(source);
    });

    it('plain land is forest only next to trees', () => {
        expect(classifyTerrain(16, () => true)).toBe('forest');
        expect(classifyTerrain(16, noTrees)).toBeNull();
    });
});

describe('AmbientSounds', () => {
    let deps: AmbientSoundsDeps;
    let play: ReturnType<typeof vi.fn<AmbientSoundsDeps['play']>>;
    let ground: number;

    beforeEach(() => {
        // 0.99 → never picks a building, lands near the edge of the circle
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        ground = 0;
        play = vi.fn<AmbientSoundsDeps['play']>(() => 2);
        deps = {
            groundTypeAt: () => ground,
            hasTreeNear: () => false,
            noisyBuildingsNear: () => [],
            play,
        };
    });

    afterEach(() => vi.restoreAllMocks());

    it('plays the sound for the sampled terrain, quieter than full volume', () => {
        new AmbientSounds(deps).update(listener, 0);
        expect(play).toHaveBeenCalledTimes(1);
        const [name, gain] = play.mock.calls[0]!;
        expect(name).toBe('AMB_OCEAN');
        expect(gain).toBeGreaterThan(0);
        expect(gain).toBeLessThan(0.5);
    });

    it('waits between attempts and lets a source rest while its clip plays', () => {
        const ambient = new AmbientSounds(deps);
        ambient.update(listener, 0);
        ambient.update(listener, 100); // too soon
        ambient.update(listener, 600); // ocean clip (2 s) still playing
        expect(play).toHaveBeenCalledTimes(1);
        ambient.update(listener, 2600);
        expect(play).toHaveBeenCalledTimes(2);
    });

    it('caps the number of ambient sounds playing together', () => {
        play.mockReturnValue(60);
        const ambient = new AmbientSounds(deps);
        const grounds = [0, 97, 48, 64, 32];
        grounds.forEach((g, i) => {
            ground = g;
            ambient.update(listener, i * 600);
        });
        expect(play).toHaveBeenCalledTimes(3);
    });

    it('stays silent on plain land without trees', () => {
        ground = 16;
        new AmbientSounds(deps).update(listener, 0);
        expect(play).not.toHaveBeenCalled();
    });

    it('plays animal noises from nearby farms', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.1); // < building chance
        deps.noisyBuildingsNear = () => [{ x: 52, y: 50, source: 'pigs' }];
        new AmbientSounds(deps).update(listener, 0);
        expect(play.mock.calls[0]![0]).toBe('ANIMAL_PIG');
    });

    it('does nothing when the sound was not extracted', () => {
        play.mockReturnValue(null);
        const ambient = new AmbientSounds(deps);
        ambient.update(listener, 0);
        ambient.update(listener, 600);
        expect(play).toHaveBeenCalledTimes(2); // no rest scheduled for a sound that never played
    });
});
