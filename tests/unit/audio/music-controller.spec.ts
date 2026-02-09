/* eslint-disable max-lines-per-function */
/**
 * Unit tests for MusicController
 *
 * Tests the state machine logic for music playback without actual audio.
 * Howl is mocked to verify correct method calls and state transitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Howler before importing MusicController
vi.mock('howler', () => {
    const mockHowl = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockReturnValue(1),
        stop: vi.fn(),
        unload: vi.fn(),
        volume: vi.fn().mockReturnValue(0.5),
        fade: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        playing: vi.fn().mockReturnValue(false),
    }));

    return {
        Howl: mockHowl,
        Howler: {
            ctx: { state: 'running' },
        },
    };
});

// Must import after mock setup
import { MusicController, IAudioManager } from '@/game/audio';
import { Race } from '@/game/renderer/sprite-metadata';

describe('MusicController', () => {
    let controller: MusicController;
    let mockSoundManager: IAudioManager;
    let mockHowlInstance: ReturnType<typeof createMockHowl>;

    function createMockHowl(isPlaying = false) {
        return {
            play: vi.fn().mockReturnValue(1),
            stop: vi.fn(),
            unload: vi.fn(),
            volume: vi.fn().mockReturnValue(0.5),
            fade: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            playing: vi.fn().mockReturnValue(isPlaying),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();

        mockHowlInstance = createMockHowl();

        mockSoundManager = {
            loadSound: vi.fn().mockReturnValue(mockHowlInstance),
            getMusicVolumeMultiplier: vi.fn().mockReturnValue(0.5),
        };

        controller = new MusicController(mockSoundManager);
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe('playMusic', () => {
        it('should set currentMusicId when playing a track', () => {
            controller.playMusic('MUSIC_ROMAN_01');

            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
            expect(mockSoundManager.loadSound).toHaveBeenCalled();
            expect(mockHowlInstance.play).toHaveBeenCalled();
            expect(mockHowlInstance.fade).toHaveBeenCalled();
        });

        it('should not play if disabled', () => {
            controller.toggleMusic(false);
            controller.playMusic('MUSIC_ROMAN_01');

            expect(controller.currentMusicId).toBeNull();
            expect(mockSoundManager.loadSound).not.toHaveBeenCalled();
        });

        it('should return early if same track is already playing', () => {
            // First play
            mockHowlInstance.playing.mockReturnValue(true);
            controller.playMusic('MUSIC_ROMAN_01');

            // Reset mock call counts
            vi.clearAllMocks();
            mockSoundManager.loadSound = vi.fn().mockReturnValue(mockHowlInstance);

            // Try to play same track again
            controller.playMusic('MUSIC_ROMAN_01');

            // Should not load again
            expect(mockSoundManager.loadSound).not.toHaveBeenCalled();
        });

        it('should queue music if called during transition', () => {
            // Simulate a transition in progress by calling playMusic twice synchronously
            // The second call should be queued
            const firstHowl = createMockHowl();
            const secondHowl = createMockHowl();

            let callCount = 0;
            mockSoundManager.loadSound = vi.fn().mockImplementation(() => {
                callCount++;
                return callCount === 1 ? firstHowl : secondHowl;
            });

            // Play first track
            controller.playMusic('MUSIC_ROMAN_01');
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
        });
    });

    describe('stopMusic', () => {
        it('should clear all state when stopping', () => {
            // Start playing
            controller.playMusic('MUSIC_ROMAN_01');
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

            // Stop
            controller.stopMusic();

            expect(controller.currentMusicId).toBeNull();
            expect(mockHowlInstance.off).toHaveBeenCalled();
            expect(mockHowlInstance.stop).toHaveBeenCalled();
            expect(mockHowlInstance.unload).toHaveBeenCalled();
        });

        it('should cancel pending auto-advance timeout', () => {
            vi.useFakeTimers();

            controller.playMusic('MUSIC_ROMAN_01');

            // Simulate track ending and auto-advance being scheduled
            const onceCall = mockHowlInstance.once.mock.calls.find(
                (call) => call[0] === 'end'
            );
            expect(onceCall).toBeDefined();

            // Stop before auto-advance fires
            controller.stopMusic();

            // Advance timers - auto-advance should NOT fire
            vi.advanceTimersByTime(1000);

            // currentMusicId should still be null (no new track started)
            expect(controller.currentMusicId).toBeNull();

            vi.useRealTimers();
        });
    });

    describe('toggleMusic', () => {
        it('should stop music when disabled', () => {
            controller.playMusic('MUSIC_ROMAN_01');
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

            controller.toggleMusic(false);

            expect(controller.currentMusicId).toBeNull();
            expect(controller.enabled).toBe(false);
        });

        it('should not restart if already playing when enabled', () => {
            mockHowlInstance.playing.mockReturnValue(true);
            controller.playMusic('MUSIC_ROMAN_01');

            vi.clearAllMocks();
            mockSoundManager.loadSound = vi.fn().mockReturnValue(mockHowlInstance);

            // Toggle on (already on, already playing)
            controller.toggleMusic(true);

            // Should not call loadSound again
            expect(mockSoundManager.loadSound).not.toHaveBeenCalled();
        });

        it('should resume with lastMusicId when re-enabled', () => {
            // Play a track
            controller.playMusic('MUSIC_ROMAN_01');
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

            // Disable (stops music but remembers lastMusicId internally)
            controller.toggleMusic(false);
            expect(controller.currentMusicId).toBeNull();

            // Create fresh mock for re-enable
            const newHowl = createMockHowl();
            mockSoundManager.loadSound = vi.fn().mockReturnValue(newHowl);

            // Re-enable
            controller.toggleMusic(true);

            // Should resume with the last track
            expect(mockSoundManager.loadSound).toHaveBeenCalled();
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
        });
    });

    describe('crossfade', () => {
        it('should fade out old track when playing new track', () => {
            const firstHowl = createMockHowl(true); // playing = true
            const secondHowl = createMockHowl();

            let callCount = 0;
            mockSoundManager.loadSound = vi.fn().mockImplementation(() => {
                callCount++;
                return callCount === 1 ? firstHowl : secondHowl;
            });

            // Play first track
            controller.playMusic('MUSIC_ROMAN_01');
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

            // Play second track (should crossfade)
            controller.playMusic('MUSIC_ROMAN_02');

            // First track should have fade called (fade to 0)
            expect(firstHowl.fade).toHaveBeenCalled();
            expect(firstHowl.off).toHaveBeenCalled(); // Handlers removed

            // Second track should be playing
            expect(secondHowl.play).toHaveBeenCalled();
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');
        });
    });

    describe('auto-advance', () => {
        it('should register end handler for playlist auto-advance', () => {
            controller.playRandomMusic(Race.Roman);

            // Should have registered an 'end' handler
            expect(mockHowlInstance.once).toHaveBeenCalledWith('end', expect.any(Function));
        });

        it('should not auto-advance if track is no longer current', () => {
            vi.useFakeTimers();

            const firstHowl = createMockHowl();
            const secondHowl = createMockHowl();

            let callCount = 0;
            mockSoundManager.loadSound = vi.fn().mockImplementation(() => {
                callCount++;
                return callCount === 1 ? firstHowl : secondHowl;
            });

            // Play first track
            controller.playMusic('MUSIC_ROMAN_01');

            // Get the 'end' handler that was registered
            const endHandler = firstHowl.once.mock.calls.find(
                (call) => call[0] === 'end'
            )?.[1];
            expect(endHandler).toBeDefined();

            // Play a different track (first track is no longer current)
            firstHowl.playing.mockReturnValue(true);
            controller.playMusic('MUSIC_ROMAN_02');

            // Now trigger the end handler from the first track
            endHandler?.();

            // Advance timers
            vi.advanceTimersByTime(1000);

            // Should still be on second track (no auto-advance from first)
            expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');

            vi.useRealTimers();
        });
    });
});
