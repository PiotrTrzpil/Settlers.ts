import { Howl } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SoundType, SOUND_LIBRARY, IAudioManager } from './audio-definitions';
import { Race } from '@/game/renderer/sprite-metadata';

/**
 * Controls music playback with crossfade support.
 *
 * IMPORTANT: This class is designed to NEVER allow music overlap.
 * All state transitions go through stopAllMusicImmediately() first.
 */
export class MusicController {
    private static log = new LogHandler('MusicController');

    /** The single currently playing music track */
    private currentMusic: Howl | null = null;
    private _currentMusicId: string | null = null;

    /** Track being faded out (will be stopped after fade) */
    private fadingOutMusic: Howl | null = null;

    /** Playlist context for auto-advance */
    private currentRacePlaylist: Race | null = null;
    private lastMusicId: string | null = null;

    /** Timeout ID for auto-advancing playlist */
    private autoAdvanceTimeoutId: ReturnType<typeof setTimeout> | null = null;

    /** Timeout ID for fade-out cleanup */
    private fadeOutTimeoutId: ReturnType<typeof setTimeout> | null = null;

    /** Music prefix mapping by race */
    private static readonly RACE_MUSIC_PREFIX: Record<Race, string> = {
        [Race.Roman]: 'MUSIC_ROMAN',
        [Race.Viking]: 'MUSIC_VIKING',
        [Race.Mayan]: 'MUSIC_MAYAN',
        [Race.DarkTribe]: 'MUSIC_DARK',
        [Race.Trojan]: 'MUSIC_TROJAN',
    };

    /** Pending music for autoplay policy */
    private pendingMusicId: string | null = null;
    private pendingFadeDuration: number = 1000;

    private _enabled = true;

    /** Re-entrancy guard - prevents overlapping playMusic calls */
    private isTransitioning = false;

    constructor(private soundManager: IAudioManager) { }

    public get currentMusicId(): string | null {
        return this._currentMusicId;
    }

    public get enabled(): boolean {
        return this._enabled;
    }

    public isPlaying(): boolean {
        return this.currentMusic?.playing() ?? false;
    }

    /**
     * Stop all currently playing/fading music and cancel timeouts.
     * @param clearPending If true, also clears any pending music request
     */
    private stopAllMusicImmediately(clearPending = true): void {
        // Cancel all pending timeouts
        if (this.autoAdvanceTimeoutId !== null) {
            clearTimeout(this.autoAdvanceTimeoutId);
            this.autoAdvanceTimeoutId = null;
        }
        if (this.fadeOutTimeoutId !== null) {
            clearTimeout(this.fadeOutTimeoutId);
            this.fadeOutTimeoutId = null;
        }

        // Stop and cleanup current music
        if (this.currentMusic) {
            this.currentMusic.off(); // Remove ALL event handlers
            this.currentMusic.stop();
            this.currentMusic.unload();
            this.currentMusic = null;
        }

        // Stop and cleanup fading music
        if (this.fadingOutMusic) {
            this.fadingOutMusic.off();
            this.fadingOutMusic.stop();
            this.fadingOutMusic.unload();
            this.fadingOutMusic = null;
        }

        this._currentMusicId = null;

        // Only clear pending if explicitly requested (e.g., stopMusic() call)
        // Don't clear during transitions so queued requests aren't lost
        if (clearPending) {
            this.pendingMusicId = null;
        }
    }

    public stopMusic(): void {
        this.stopAllMusicImmediately(true);
    }

    public toggleMusic(enabled: boolean): void {
        this._enabled = enabled;

        if (!enabled) {
            this.stopAllMusicImmediately(true); // Clear everything including pending
            return;
        }

        // Don't restart if already playing
        if (this.currentMusic?.playing()) {
            return;
        }

        // Resume logic - try to find something appropriate to play
        if (this.lastMusicId) {
            this.playMusic(this.lastMusicId);
        } else if (this.currentRacePlaylist) {
            this.playRandomMusic(this.currentRacePlaylist);
        } else {
            this.playRandomMusic(Race.Roman);
        }
    }

    public retryPendingMusic(): void {
        if (this.pendingMusicId && this._enabled) {
            MusicController.log.debug(`Retrying pending music: ${this.pendingMusicId}`);
            const id = this.pendingMusicId;
            const fade = this.pendingFadeDuration;
            this.pendingMusicId = null;
            this.playMusic(id, fade);
        }
    }

    /** Cancel any pending auto-advance timer */
    private cancelPendingAutoAdvance(): void {
        if (this.autoAdvanceTimeoutId !== null) {
            clearTimeout(this.autoAdvanceTimeoutId);
            this.autoAdvanceTimeoutId = null;
        }
    }

    /** Handle crossfade from current music to new music */
    private performCrossfade(fadeDuration: number): void {
        if (this.currentMusic && this.currentMusic.playing()) {
            // Stop any existing fade-out cleanup
            if (this.fadeOutTimeoutId !== null) {
                clearTimeout(this.fadeOutTimeoutId);
                this.fadeOutTimeoutId = null;
            }

            // Clean up any previous fading music first
            if (this.fadingOutMusic) {
                this.fadingOutMusic.off();
                this.fadingOutMusic.stop();
                this.fadingOutMusic.unload();
            }

            // Move current to fading
            this.fadingOutMusic = this.currentMusic;
            this.fadingOutMusic.off(); // Remove all handlers
            this.currentMusic = null;

            // Start fade out
            this.fadingOutMusic.fade(this.fadingOutMusic.volume(), 0, fadeDuration);

            // Schedule cleanup
            const musicToCleanup = this.fadingOutMusic;
            this.fadeOutTimeoutId = setTimeout(() => {
                this.fadeOutTimeoutId = null;
                if (musicToCleanup) {
                    musicToCleanup.stop();
                    musicToCleanup.unload();
                }
                if (this.fadingOutMusic === musicToCleanup) {
                    this.fadingOutMusic = null;
                }
            }, fadeDuration + 100);
        } else {
            // No music playing - ensure clean state (but preserve any queued request)
            this.stopAllMusicImmediately(false);
        }
    }

    public playMusic(soundId: string, fadeDuration = 1000): void {
        if (!this._enabled) {
            return;
        }

        // Re-entrancy guard
        if (this.isTransitioning) {
            MusicController.log.debug(`playMusic called during transition, queuing: ${soundId}`);
            this.pendingMusicId = soundId;
            this.pendingFadeDuration = fadeDuration;
            return;
        }

        // Check for suspended audio context (autoplay policy)
        if (typeof Howler !== 'undefined' && Howler.ctx && Howler.ctx.state === 'suspended') {
            this.pendingMusicId = soundId;
            this.pendingFadeDuration = fadeDuration;
            MusicController.log.debug(`AudioContext suspended, queuing music: ${soundId}`);
            return;
        }

        const config = SOUND_LIBRARY.find(s => s.id === soundId);
        if (!config) {
            MusicController.log.warn(`Music ID not found: ${soundId}`);
            return;
        }

        // If exact same music is already playing, do nothing
        if (this._currentMusicId === soundId && this.currentMusic?.playing()) {
            return;
        }

        // Load new music first to ensure it's valid
        const newMusic = this.soundManager.loadSound(config);
        if (!newMusic) {
            MusicController.log.warn(`Failed to load music: ${soundId}`);
            return;
        }

        this.isTransitioning = true;

        try {
            this.cancelPendingAutoAdvance();
            this.performCrossfade(fadeDuration);

            // Start new music
            newMusic.volume(0);
            newMusic.play();

            // Calculate and apply target volume
            const volMultiplier = this.soundManager.getMusicVolumeMultiplier();
            const baseVol = config.volume ?? 1.0;
            const targetVol = baseVol * volMultiplier;
            newMusic.fade(0, targetVol, fadeDuration);

            // Setup auto-advance handler (only if we have a playlist context)
            newMusic.once('end', () => {
                // Guard: only advance if this is still the current music
                if (this.currentMusic !== newMusic) {
                    return;
                }
                if (!this.currentRacePlaylist || !this._enabled) {
                    return;
                }

                MusicController.log.debug('Track finished, advancing playlist...');
                this.autoAdvanceTimeoutId = setTimeout(() => {
                    this.autoAdvanceTimeoutId = null;
                    if (this.currentRacePlaylist && this._enabled) {
                        this.playRandomMusic(this.currentRacePlaylist);
                    }
                }, 500);
            });

            // Update state
            this.currentMusic = newMusic;
            this._currentMusicId = soundId;
            this.lastMusicId = soundId;

            MusicController.log.debug(`Playing music: ${soundId}`);
        } finally {
            this.isTransitioning = false;
        }
    }

    public playRandomMusic(race: Race): void {
        this.currentRacePlaylist = race;

        const prefix = MusicController.RACE_MUSIC_PREFIX[race];

        // Filter: Match prefix, is music, NOT a battle track
        const tracks = SOUND_LIBRARY.filter(s =>
            s.type === SoundType.Music &&
            s.id.startsWith(prefix) &&
            !s.id.includes('FIGHT')
        );

        if (tracks.length === 0) {
            MusicController.log.warn(`No music found for race: ${Race[race]}`);
            return;
        }

        // Avoid repeating the last track if we have options
        const availableTracks = tracks.length > 1 && this.lastMusicId
            ? tracks.filter(t => t.id !== this.lastMusicId)
            : tracks;

        const randomTrack = availableTracks[Math.floor(Math.random() * availableTracks.length)];
        this.playMusic(randomTrack.id);
    }

    public updateVolume(): void {
        if (this.currentMusic && this._currentMusicId) {
            const config = SOUND_LIBRARY.find(s => s.id === this._currentMusicId);
            const baseVol = config?.volume ?? 1.0;
            const volMultiplier = this.soundManager.getMusicVolumeMultiplier();
            this.currentMusic.volume(baseVol * volMultiplier);
        }
    }
}
