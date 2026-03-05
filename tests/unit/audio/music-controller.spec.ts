/**
 * Unit tests for MusicController
 *
 * Tests the state machine: enable/disable, crossfade transitions,
 * auto-advance lifecycle. Howl is mocked since we can't play audio
 * in tests — we verify state transitions, not audio output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal Howler module mock — MusicController imports Howl and Howler.ctx.
// The actual Howl instances are provided via IAudioManager.loadSound in each test.
vi.mock('howler', () => ({
    Howl: vi.fn(),
    Howler: { ctx: { state: 'running' } },
}));

import { MusicController, IAudioManager } from '@/game/audio';

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

describe('MusicController', () => {
    let controller: MusicController;
    let mockSoundManager: IAudioManager;
    let mockHowlInstance: ReturnType<typeof createMockHowl>;

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

    it('should track currentMusicId and stop cleanly', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

        controller.stopMusic();
        expect(controller.currentMusicId).toBeNull();
    });

    it('should skip duplicate plays of the same track', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        mockHowlInstance.playing.mockReturnValue(true);

        const loadSpy = mockSoundManager.loadSound as ReturnType<typeof vi.fn>;
        loadSpy.mockClear();
        controller.playMusic('MUSIC_ROMAN_01');
        expect(loadSpy).not.toHaveBeenCalled();
    });

    it('should not play when disabled, and resume last track when re-enabled', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');

        // Disable stops music
        controller.toggleMusic(false);
        expect(controller.currentMusicId).toBeNull();
        expect(controller.enabled).toBe(false);

        // Can't play while disabled
        controller.playMusic('MUSIC_ROMAN_02');
        expect(controller.currentMusicId).toBeNull();

        // Re-enable resumes last track
        (mockSoundManager.loadSound as ReturnType<typeof vi.fn>).mockReturnValue(createMockHowl());
        controller.toggleMusic(true);
        expect(mockSoundManager.loadSound).toHaveBeenCalled();
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
    });

    it('should crossfade: fade out old track when playing new one', () => {
        const firstHowl = createMockHowl(true);
        const secondHowl = createMockHowl();
        const loadSpy = mockSoundManager.loadSound as ReturnType<typeof vi.fn>;
        loadSpy.mockReturnValueOnce(firstHowl).mockReturnValueOnce(secondHowl);

        controller.playMusic('MUSIC_ROMAN_01');
        controller.playMusic('MUSIC_ROMAN_02');

        expect(firstHowl.fade).toHaveBeenCalled();
        expect(firstHowl.off).toHaveBeenCalled();
        expect(secondHowl.play).toHaveBeenCalled();
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');
    });

    it('should cancel auto-advance on stop and not auto-advance stale tracks', () => {
        vi.useFakeTimers();

        const firstHowl = createMockHowl();
        const secondHowl = createMockHowl();
        const loadSpy = mockSoundManager.loadSound as ReturnType<typeof vi.fn>;
        loadSpy.mockReturnValueOnce(firstHowl).mockReturnValueOnce(secondHowl);

        controller.playMusic('MUSIC_ROMAN_01');

        // Get end handler from first track
        const endHandler = firstHowl.once.mock.calls.find(call => call[0] === 'end')?.[1];
        expect(endHandler).toBeDefined();

        // Play different track (first is now stale)
        firstHowl.playing.mockReturnValue(true);
        controller.playMusic('MUSIC_ROMAN_02');

        // Trigger stale end handler
        endHandler?.();
        vi.advanceTimersByTime(1000);

        // Should still be on second track
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');

        vi.useRealTimers();
    });
});
