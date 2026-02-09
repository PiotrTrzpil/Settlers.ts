import { Howl } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SoundType, SOUND_LIBRARY, IAudioManager } from './audio-definitions';
import { Race } from '@/game/renderer/sprite-metadata';

export class MusicController {
    private static log = new LogHandler('MusicController');

    // Track music state
    private currentMusic: Howl | null = null;
    private _currentMusicId: string | null = null;
    private fadingOutMusic: Howl | null = null;
    private currentRacePlaylist: Race | null = null;
    private lastMusicId: string | null = null;

    /** Music prefix mapping by race */
    private static readonly RACE_MUSIC_PREFIX: Record<Race, string> = {
        [Race.Roman]: 'MUSIC_ROMAN',
        [Race.Viking]: 'MUSIC_VIKING',
        [Race.Mayan]: 'MUSIC_MAYAN',
        [Race.DarkTribe]: 'MUSIC_DARK',
        [Race.Trojan]: 'MUSIC_TROJAN',
    };

    // Pending music for autoplay policy
    private pendingMusicId: string | null = null;
    private pendingFadeDuration: number = 1000;
    private _enabled = true;

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

    public stopMusic(): void {
        // Stop current music
        if (this.currentMusic) {
            this.currentMusic.stop();
            this.currentMusic.unload();
            this.currentMusic = null;
        }

        // Stop any fading out music
        if (this.fadingOutMusic) {
            this.fadingOutMusic.stop();
            this.fadingOutMusic.unload();
            this.fadingOutMusic = null;
        }

        // Cancel any pending timeouts/retries
        this.pendingMusicId = null;
        this._currentMusicId = null;

        // Double check: Howler global stop (optional, but ensures safety if we track IDs)
        // For now, allow SFX to keep playing, so don't use Howler.stop() globally.
    }

    public toggleMusic(enabled: boolean): void {
        this._enabled = enabled;
        if (!enabled) {
            // Do not clear playlist so we can resume later
            this.stopMusic();
        } else {
            // Resume logic:
            // 1. Try to play specific current ID (unlikely if stopped)
            // 2. Try to play from current playlist (resumes race theme)
            // 3. Try to play last played track
            // 4. Fallback to Roman
            if (this._currentMusicId) {
                this.playMusic(this._currentMusicId);
            } else if (this.currentRacePlaylist) {
                this.playRandomMusic(this.currentRacePlaylist);
            } else if (this.lastMusicId) {
                this.playMusic(this.lastMusicId);
            } else {
                this.playRandomMusic(Race.Roman);
            }
        }
    }

    public retryPendingMusic(): void {
        if (this.pendingMusicId) {
            MusicController.log.info(`Retrying pending music: ${this.pendingMusicId}`);
            const id = this.pendingMusicId;
            const fade = this.pendingFadeDuration;
            this.pendingMusicId = null;
            this.playMusic(id, fade);
        }
    }

    public playMusic(soundId: string, fadeDuration = 1000): void {
        if (!this._enabled) {
            return;
        }

        // Check for suspended audio context (autoplay policy)
        // @ts-ignore - Howler types might not expose ctx fully or it's global
        if (typeof Howler !== 'undefined' && Howler.ctx && Howler.ctx.state === 'suspended') {
            this.pendingMusicId = soundId;
            this.pendingFadeDuration = fadeDuration;
            MusicController.log.info(`AudioContext suspended, queuing music: ${soundId}`);
            return;
        }

        const config = SOUND_LIBRARY.find(s => s.id === soundId);
        if (!config) {
            MusicController.log.warn(`Music ID not found: ${soundId}`);
            return;
        }

        // If same music is already playing, do nothing
        if (this._currentMusicId === soundId && this.currentMusic?.playing()) {
            return;
        }

        // Load new music first to ensure valid
        // We use SoundManager to load to reuse the same loading logic/cache if appropriate
        // (Though SoundManager might just delegate back if we aren't careful. 
        //  For now, let's assume SoundManager exposes loadSound or we duplicate the simple load logic here 
        //  since SoundManager loads SFX differently)
        const newMusic = this.soundManager.loadSound(config);

        if (!newMusic) {
            MusicController.log.warn(`Failed to load music: ${soundId}`);
            return;
        }

        // If we have music playing, fade it out
        if (this.currentMusic && this.currentMusic.playing()) {
            // Stop any existing fade out immediately
            if (this.fadingOutMusic) {
                this.fadingOutMusic.stop();
                this.fadingOutMusic.unload();
            }

            this.fadingOutMusic = this.currentMusic;
            this.currentMusic = null; // Detach immediately so new music takes over slot

            // Fade out old music
            this.fadingOutMusic.fade(this.fadingOutMusic.volume(), 0, fadeDuration);
            const musicToStop = this.fadingOutMusic;

            // Cleanup after fade
            setTimeout(() => {
                if (musicToStop) {
                    musicToStop.stop();
                    musicToStop.unload();
                }
                if (this.fadingOutMusic === musicToStop) {
                    this.fadingOutMusic = null;
                }
            }, fadeDuration + 100);
        } else {
            // Just ensure everything is stopped if not playing
            this.stopMusic();
        }

        // Start new music
        newMusic.volume(0);
        newMusic.play();

        // Calculate target volume
        // We need to access volumes from SoundManager or pass them in.
        // Let's assume SoundManager exposes getters or we refactor that later.
        // For now, let's make this class responsible for calculating its own volume?
        // No, SoundManager holds the master/music volume state usually.
        // Let's ask SoundManager for the volume multiplier.
        const volMultiplier = this.soundManager.getMusicVolumeMultiplier();
        const baseVol = config.volume ?? 1.0;
        const targetVol = baseVol * volMultiplier;

        newMusic.fade(0, targetVol, fadeDuration);

        // Setup playlist auto-advance if we have a race context
        newMusic.once('end', () => {
            if (this.currentRacePlaylist) {
                // Trigger next track context-aware
                MusicController.log.debug('Track finished, advancing playlist...');
                // Small delay to allow fade out or just clear buffer
                setTimeout(() => {
                    if (this.currentRacePlaylist) {
                        this.playRandomMusic(this.currentRacePlaylist);
                    }
                }, 500);
            }
        });

        this.currentMusic = newMusic;
        this._currentMusicId = soundId;
        this.lastMusicId = soundId;
        MusicController.log.debug(`Playing music: ${soundId}`);
    }

    public playRandomMusic(race: Race): void {
        this.currentRacePlaylist = race; // Set context for auto-advance

        const prefix = MusicController.RACE_MUSIC_PREFIX[race];

        // Filter: Match prefix, is music, NOT a battle track
        const tracks = SOUND_LIBRARY.filter(s =>
            s.type === SoundType.Music &&
            s.id.startsWith(prefix) &&
            !s.id.includes('FIGHT') // Exclude battle tracks
        );

        if (tracks.length > 0) {
            // Filter out last played track if we have multiple options
            // But only if we have more than 1 track, otherwise we have to repeat
            const availableTracks = tracks.length > 1 && this.lastMusicId
                ? tracks.filter(t => t.id !== this.lastMusicId)
                : tracks;

            const randomTrack = availableTracks[Math.floor(Math.random() * availableTracks.length)];
            this.playMusic(randomTrack.id);
        } else {
            MusicController.log.warn(`No music found for race: ${Race[race]}`);
        }
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
