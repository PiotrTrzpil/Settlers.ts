import { Howl, Howler } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SoundConfig, SoundType, SOUND_LIBRARY, IAudioManager } from './audio-definitions';
import { FileManager } from '@/utilities/file-manager';
import { MusicController } from './music-controller';
import { SfxPoolManager } from './sfx-pool';
import { SoundEffectPlayer } from './sound-effect-player';
import type { SoundName } from './sound-manifest';
import { Race } from '@/game/renderer/sprite-metadata';

/**
 * Manages all audio playback using Howler.js.
 * Supports:
 * - Background music with cross-fading (delegated to MusicController)
 * - 2D Spatial audio (panning based on screen position)
 * - Volume control groups (Master, SFX, Music)
 * - Sound effects extracted by `pnpm sounds:extract` (see docs/SOUND.md)
 */
export class SoundManager implements IAudioManager {
    private static log = new LogHandler('SoundManager');

    private sounds: Map<string, Howl> = new Map();
    /** Store config references for cached sounds to look up base volume */
    private soundConfigs: Map<string, SoundConfig> = new Map();
    private musicController: MusicController;
    private sfxPoolManager: SfxPoolManager;
    private sfxPlayer: SoundEffectPlayer;
    private sfxEnabled = true;

    private musicVolume = 0.5;
    private sfxVolume = 1.0;
    private masterVolume = 1.0;
    private fileManager: FileManager | null = null;

    /** Guard: setupAudioUnlock() must only add DOM listeners once per SoundManager instance */
    private audioUnlockSetup = false;

    private constructor() {
        this.musicController = new MusicController(this);
        this.sfxPoolManager = new SfxPoolManager(
            this.createHowlForConfig.bind(this),
            () => this.sfxVolume * this.masterVolume
        );
        this.sfxPlayer = new SoundEffectPlayer();
    }

    /**
     * Get the singleton instance. Stored on window to survive HMR module reloads.
     */
    public static getInstance(): SoundManager {
        // Use window storage to survive HMR - when the module is hot-replaced,
        // static class properties are reset, but window persists
        const bridge = (window.__settlers__ ??= {});
        if (bridge.soundManager) {
            return bridge.soundManager;
        }
        const instance = new SoundManager();
        bridge.soundManager = instance;
        return instance;
    }

    public get currentMusicId(): string | null {
        return this.musicController.currentMusicId;
    }

    /** Tracks if init is currently in progress to prevent race conditions */
    private initPromise: Promise<void> | null = null;

    public async init(fileManager: FileManager): Promise<void> {
        // If already initialized, return immediately
        if (this.fileManager) {
            SoundManager.log.debug('SoundManager already initialized, skipping re-init');
            return;
        }

        // If init is in progress, wait for it
        if (this.initPromise) {
            SoundManager.log.debug('SoundManager init already in progress, waiting...');
            return this.initPromise;
        }

        this.initPromise = this.doInit(fileManager);
        return this.initPromise;
    }

    private async doInit(fileManager: FileManager): Promise<void> {
        this.fileManager = fileManager;

        // Load persisted settings
        this.loadSettings();

        SoundManager.log.debug('SoundManager initialized');

        // Setup global unlock for AudioContext
        this.setupAudioUnlock();

        // Sound effects extracted from the player's game files (missing until `pnpm sounds:extract` is run)
        await this.sfxPlayer.load();

        // Preload sounds marked for preloading and register pools
        this.preloadConfiguredSounds();
    }

    /**
     * Preload sounds marked with preload: true in SOUND_LIBRARY.
     * Also registers pooled sounds with poolSize > 0.
     */
    private preloadConfiguredSounds(): void {
        let preloadCount = 0;
        let poolCount = 0;

        for (const config of SOUND_LIBRARY) {
            // Register pooled sounds
            if (config.poolSize && config.poolSize > 0) {
                this.sfxPoolManager.registerPool(config, config.poolSize);
                poolCount++;
            }

            // Preload sounds (skip music, it's loaded on demand)
            if (config.preload && config.type !== SoundType.Music) {
                this.loadSound(config);
                preloadCount++;
            }
        }

        if (preloadCount > 0 || poolCount > 0) {
            SoundManager.log.debug(`Preloaded ${preloadCount} sounds, registered ${poolCount} pools`);
        }
    }

    /**
     * Preload specific sounds by ID.
     */
    public preloadSounds(soundIds: string[]): void {
        for (const id of soundIds) {
            const config = SOUND_LIBRARY.find(s => s.id === id);
            if (config) {
                this.loadSound(config);
            }
        }
        SoundManager.log.debug(`Preloaded ${soundIds.length} sounds on demand`);
    }

    public get isMusicEnabled(): boolean {
        return this.musicController.enabled;
    }

    private loadSettings(): void {
        try {
            const stored = localStorage.getItem('settlers_sound_settings');
            if (stored) {
                const settings = JSON.parse(stored);
                if (typeof settings.masterVolume === 'number') {
                    this.setMasterVolume(settings.masterVolume);
                }
                if (typeof settings.musicVolume === 'number') {
                    this.setMusicVolume(settings.musicVolume);
                }
                if (typeof settings.musicEnabled === 'boolean') {
                    this.toggleMusic(settings.musicEnabled);
                }
                SoundManager.log.debug('Loaded sound settings');
            }
        } catch (e) {
            SoundManager.log.warn('Failed to load sound settings: ' + e);
        }
    }

    private saveSettings(): void {
        try {
            const settings = {
                masterVolume: this.masterVolume,
                musicVolume: this.musicVolume,
                musicEnabled: this.musicController.enabled,
            };
            localStorage.setItem('settlers_sound_settings', JSON.stringify(settings));
        } catch (e) {
            SoundManager.log.warn('Failed to save sound settings: ' + e);
        }
    }

    private setupAudioUnlock(): void {
        if (this.audioUnlockSetup) {
            return;
        }
        this.audioUnlockSetup = true;

        let unlocking = false; // Prevent multiple concurrent unlock attempts

        const removeListeners = () => {
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
            document.removeEventListener('touchstart', unlock);
        };

        const unlock = () => {
            // Guard against multiple rapid calls
            if (unlocking) {
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Howler.ctx is null in headless/test environments
            if (Howler.ctx?.state === 'suspended') {
                unlocking = true;

                // Remove listeners IMMEDIATELY to prevent duplicate calls
                removeListeners();

                void Howler.ctx
                    .resume()
                    .then(() => {
                        SoundManager.log.info('AudioContext resumed via user interaction');
                        this.musicController.retryPendingMusic();
                    })
                    .catch(err => {
                        SoundManager.log.warn('Failed to resume AudioContext: ' + err);
                        unlocking = false;
                        // Re-add listeners on failure
                        document.addEventListener('click', unlock);
                        document.addEventListener('keydown', unlock);
                        document.addEventListener('touchstart', unlock);
                    });
            }
        };

        // Listen for user interactions
        if (typeof document !== 'undefined') {
            document.addEventListener('click', unlock);
            document.addEventListener('keydown', unlock);
            document.addEventListener('touchstart', unlock);
        }
    }

    /**
     * Unload all sounds and stop playback.
     */
    public unload(): void {
        this.stopMusic();

        this.sounds.forEach(sound => {
            sound.stop();
            sound.unload();
        });
        this.sounds.clear();
        this.soundConfigs.clear();

        // Unload SFX pools
        this.sfxPoolManager.unload();
        this.sfxPlayer.unload();

        this.fileManager = null;
        this.initPromise = null; // Allow re-initialization on next game load
        SoundManager.log.debug('SoundManager unloaded');
    }

    /**
     * Set the listener position for spatial audio.
     * Call this every frame with the center of the camera view.
     */
    public updateListener(x: number, y: number): void {
        Howler.pos(x, y, 0.5);
        Howler.orientation(0, 0, -1, 0, 1, 0);
    }

    /**
     * Load a sound into the cache if not already present.
     * Music is NOT cached because we manage its lifecycle separately (fade in/out, unload).
     * Sounds are created with neutral volume (1.0) - apply volume at play time.
     */
    public loadSound(config: SoundConfig): Howl | null {
        // Don't cache music - it's managed by MusicController with fading/unloading
        // Caching caused overlapping audio when the same track was requested while fading out
        if (config.type !== SoundType.Music && this.sounds.has(config.id)) {
            return this.sounds.get(config.id)!; // OK: has() check above guarantees entry exists
        }

        // Create with neutral volume - apply config/category/master volume at play time
        const sound = new Howl({
            src: [config.path],
            loop: config.loop,
            volume: 1.0,
            autoplay: false,
            onloaderror: (_id, err) => {
                SoundManager.log.error(`Failed to load sound ${config.id}: ${String(err)}`);
            },
            onplayerror: (_id, err) => {
                SoundManager.log.error(`Failed to play sound ${config.id}: ${String(err)}`);
                // Unlock audio context if needed
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Howler.ctx is null in headless/test environments
                if (Howler.ctx?.state === 'suspended') {
                    void Howler.ctx
                        .resume()
                        .then(() => {
                            SoundManager.log.info('Audio context resumed from error handler');
                            this.musicController.retryPendingMusic();
                        })
                        .catch(resumeErr => {
                            SoundManager.log.warn('Failed to resume audio context: ' + resumeErr);
                        });
                }
            },
        });

        // Only cache SFX, not music (music is managed by MusicController)
        if (config.type !== SoundType.Music) {
            this.sounds.set(config.id, sound);
            this.soundConfigs.set(config.id, config);
        }
        return sound;
    }

    /**
     * Get the effective volume for a sound.
     */
    public getEffectiveVolume(config: SoundConfig): number {
        // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
        const baseVol = config.volume ?? 1.0;
        const categoryVol = config.type === SoundType.Music ? this.musicVolume : this.sfxVolume;
        return baseVol * categoryVol * this.masterVolume;
    }

    /**
     * Create a Howl instance without caching (used for SFX pools).
     */
    private createHowlForConfig(config: SoundConfig): Howl | null {
        return new Howl({
            src: [config.path],
            loop: config.loop,
            // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
            volume: (config.volume ?? 1.0) * this.sfxVolume * this.masterVolume,
            autoplay: false,
        });
    }

    /**
     * Register a sound for pooling (rapid-fire sounds like combat).
     * @param soundId The sound ID from SOUND_LIBRARY
     * @param poolSize Number of concurrent instances (default: 4)
     */
    public registerPooledSound(soundId: string, poolSize = 4): void {
        const config = SOUND_LIBRARY.find(s => s.id === soundId);
        if (config) {
            this.sfxPoolManager.registerPool(config, poolSize);
        }
    }

    public stopMusic(): void {
        this.musicController.stopMusic();
    }

    public playMusic(soundId: string, fadeDuration = 1000): void {
        this.musicController.playMusic(soundId, fadeDuration);
    }

    public playRandomMusic(race: Race): void {
        this.musicController.playRandomMusic(race);
    }

    public toggleMusic(enabled: boolean): void {
        this.musicController.toggleMusic(enabled);
        this.saveSettings();
    }

    public getMusicVolumeMultiplier(): number {
        return this.musicVolume * this.masterVolume;
    }

    /**
     * Play a sound effect at a specific world position.
     * Uses pooled sounds if registered, otherwise plays directly.
     * @param soundId The ID of the sound to play (from SOUND_LIBRARY)
     * @param x World X position
     * @param y World Y position
     */
    public playSfx(soundId: string, x?: number, y?: number): void {
        // Check for pooled sound first (for rapid-fire sounds)
        if (this.sfxPoolManager.play(soundId, x, y)) {
            return; // Played via pool
        }

        let sound: Howl | null = null;
        let effectiveVol = this.sfxVolume * this.masterVolume;

        // Allow playing by ID
        if (soundId) {
            const config = SOUND_LIBRARY.find(s => s.id === soundId);
            if (config) {
                sound = this.loadSound(config);
                effectiveVol = this.getEffectiveVolume(config);
            }
        }

        if (!sound) {
            return;
        }

        const id = sound.play();
        sound.volume(effectiveVol, id);

        if (x !== undefined && y !== undefined) {
            sound.pos(x, y, 0, id);
            sound.pannerAttr(
                {
                    panningModel: 'HRTF',
                    refDistance: 5,
                    rolloffFactor: 1,
                    distanceModel: 'inverse',
                },
                id
            );
        } else {
            sound.pos(0, 0, 0, id);
        }
    }

    /**
     * Play a random variant of an extracted game sound effect.
     * @param gain Extra attenuation in [0, 1], e.g. from distance to the camera
     * @param pan Stereo pan in [-1, 1]
     * @returns Length of the variant played in seconds, or null if nothing played
     */
    public playSound(name: SoundName, gain = 1, pan = 0): number | null {
        if (!this.sfxEnabled || gain <= 0) {
            return null;
        }
        // Master volume is applied globally via Howler.volume()
        return this.sfxPlayer.play(name, gain * this.sfxVolume, pan);
    }

    /** Whether extracted sound effects are available (see `pnpm sounds:extract`). */
    public get hasSoundEffects(): boolean {
        return this.sfxPlayer.isLoaded;
    }

    public setSfxEnabled(enabled: boolean): void {
        this.sfxEnabled = enabled;
    }

    public setMasterVolume(vol: number): void {
        this.masterVolume = Math.max(0, Math.min(1, vol));
        Howler.volume(this.masterVolume);
        this.musicController.updateVolume();
        this.sfxPoolManager.updateVolume();
        this.saveSettings();
    }

    public setMusicVolume(vol: number): void {
        this.musicVolume = Math.max(0, Math.min(1, vol));
        this.musicController.updateVolume();
        this.saveSettings();
    }

    public setSfxVolume(vol: number): void {
        this.sfxVolume = Math.max(0, Math.min(1, vol));
        this.sfxPoolManager.updateVolume();
        this.saveSettings();
    }

    public getSfxVolume(): number {
        return this.sfxVolume;
    }
}
