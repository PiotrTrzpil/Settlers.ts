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

import { MusicController, type IAudioManager } from '@/game/audio';

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

type MockHowl = ReturnType<typeof createMockHowl>;

describe('MusicController', () => {
    let controller: MusicController;
    let mockSoundManager: IAudioManager;
    let mockHowlInstance: MockHowl;

    beforeEach(() => {
        vi.clearAllMocks();
        mockHowlInstance = createMockHowl();
        mockSoundManager = {
            loadSound: vi.fn().mockReturnValue(mockHowlInstance),
            getMusicVolumeMultiplier: vi.fn().mockReturnValue(0.5),
        } as unknown as IAudioManager;
        controller = new MusicController(mockSoundManager);
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    it('should play music and track current id', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
    });

    it('should stop music and clear current id', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        controller.stopMusic();
        expect(controller.currentMusicId).toBeNull();
    });

    it('should toggle music off and on, resuming last track', () => {
        controller.playMusic('MUSIC_ROMAN_01');
        controller.toggleMusic(false);
        expect(controller.currentMusicId).toBeNull();
        expect(controller.enabled).toBe(false);

        // Can't play while disabled
        controller.playMusic('MUSIC_ROMAN_02');
        expect(controller.currentMusicId).toBeNull();

        // Re-enable resumes last track
        const loadSpy = vi.mocked(mockSoundManager.loadSound as (...args: unknown[]) => unknown);
        loadSpy.mockReturnValue(createMockHowl());
        controller.toggleMusic(true);
        expect(loadSpy).toHaveBeenCalled();
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_01');
    });

    it('should crossfade: fade out old track when playing new one', () => {
        const firstHowl = createMockHowl(true);
        const secondHowl = createMockHowl();
        const loadSpy = vi.mocked(mockSoundManager.loadSound as (...args: unknown[]) => unknown);
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
        const loadSpy = vi.mocked(mockSoundManager.loadSound as (...args: unknown[]) => unknown);
        loadSpy.mockReturnValueOnce(firstHowl).mockReturnValueOnce(secondHowl);

        controller.playMusic('MUSIC_ROMAN_01');

        // Get end handler from first track
        const endHandler = firstHowl.once.mock.calls.find(call => call[0] === 'end')?.[1];
        expect(endHandler).toBeDefined();

        // Play different track (first is now stale)
        controller.playMusic('MUSIC_ROMAN_02');
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');

        // Fire the end callback from first track — should NOT auto-advance
        // since it's stale (a different track is now current)
        if (endHandler) {
            (endHandler as () => void)();
        }

        // Still playing second track — no third track loaded
        expect(controller.currentMusicId).toBe('MUSIC_ROMAN_02');
    });
});
