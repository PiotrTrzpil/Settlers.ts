import { Howl, Howler } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SoundConfig, SoundType, SOUND_LIBRARY, IAudioManager } from './audio-definitions';
import { FileManager } from '@/utilities/file-manager';
import { SilFileReader } from '@/resources/gfx/sil-file-reader';
import { SndFileReader } from '@/resources/gfx/snd-file-reader';
import { MusicController } from './music-controller';

/**
 * Manages all audio playback using Howler.js.
 * Supports:
 * - Background music with cross-fading (delegated to MusicController)
 * - 2D Spatial audio (panning based on screen position)
 * - Volume control groups (Master, SFX, Music)
 * - Loading .snd archives for SFX
 */
export class SoundManager implements IAudioManager {
    private static instance: SoundManager;
    private static log = new LogHandler('SoundManager');

    private sounds: Map<string, Howl> = new Map();
    private musicController: MusicController;

    private musicVolume = 0.5;
    private sfxVolume = 1.0;
    private masterVolume = 1.0;
    private fileManager: FileManager | null = null;

    // Snd file readers
    private silReader: SilFileReader | null = null;
    private sndReader: SndFileReader | null = null;

    private constructor() {
        this.musicController = new MusicController(this);
    }

    public static getInstance(): SoundManager {
        if (!SoundManager.instance) {
            SoundManager.instance = new SoundManager();
        }
        return SoundManager.instance;
    }

    public get currentMusicId(): string | null {
        return this.musicController.currentMusicId;
    }

    public async init(fileManager: FileManager): Promise<void> {
        if (this.fileManager) {
            SoundManager.log.debug('SoundManager already initialized, skipping re-init');
            return;
        }

        this.fileManager = fileManager;

        // Load persisted settings
        this.loadSettings();

        SoundManager.log.debug('SoundManager initialized');

        // Cleanup any strict mode / browser policy things?
        // Howler handles this mostly.

        // Setup global unlock for AudioContext
        this.setupAudioUnlock();

        // Try to load 0.sil and 0.snd
        try {
            await this.loadSndArchive('Siedler4/Snd/0.sil', 'Siedler4/Snd/0.snd');
        } catch (e) {
            SoundManager.log.warn('Failed to load default sound archive: ' + e);
        }
    }

    public get isMusicEnabled(): boolean {
        return this.musicController.enabled;
    }

    private loadSettings(): void {
        try {
            const stored = localStorage.getItem('settlers_sound_settings');
            if (stored) {
                const settings = JSON.parse(stored);
                if (typeof settings.masterVolume === 'number') this.setMasterVolume(settings.masterVolume);
                if (typeof settings.musicVolume === 'number') this.setMusicVolume(settings.musicVolume);
                if (typeof settings.musicEnabled === 'boolean') this.toggleMusic(settings.musicEnabled);
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
                musicEnabled: this.musicController.enabled
            };
            localStorage.setItem('settlers_sound_settings', JSON.stringify(settings));
        } catch (e) {
            SoundManager.log.warn('Failed to save sound settings: ' + e);
        }
    }

    private setupAudioUnlock(): void {
        const unlock = () => {
            if (Howler.ctx && Howler.ctx.state === 'suspended') {
                Howler.ctx.resume().then(() => {
                    SoundManager.log.info('AudioContext resumed via user interaction');
                    this.musicController.retryPendingMusic();
                    // Remove listeners once unlocked
                    document.removeEventListener('click', unlock);
                    document.removeEventListener('keydown', unlock);
                    document.removeEventListener('touchstart', unlock);
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

        this.fileManager = null;
        this.silReader = null;
        this.sndReader = null;
        SoundManager.log.debug('SoundManager unloaded');
    }

    private async loadSndArchive(silPath: string, sndPath: string): Promise<void> {
        if (!this.fileManager) return;

        const silReader = await this.fileManager.readFile(silPath);
        const sndReader = await this.fileManager.readFile(sndPath);

        if (silReader && sndReader) {
            this.silReader = new SilFileReader(silReader);

            // sndReader is already a BinaryReader, so we pass it directly
            this.sndReader = new SndFileReader(sndReader, this.silReader);

            SoundManager.log.debug(`Loaded sound archive. ${this.silReader.offsets.length} sounds available.`);
        }
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
     */
    public loadSound(config: SoundConfig): Howl | null {
        // For music, we might want to avoid caching endlessly if memory is an issue,
        // but for now let's keep it simple.
        if (this.sounds.has(config.id)) {
            return this.sounds.get(config.id)!;
        }

        const vol = (config.volume ?? 1.0) * (config.type === SoundType.Music ? this.musicVolume : this.sfxVolume);

        let src: string | string[] = [config.path];
        let format: string[] | undefined;

        // Special handling for SFX from .snd
        if (config.type === SoundType.SFX && config.path.startsWith('Snd:')) {
            if (!this.sndReader) {
                return null;
            }
            const index = parseInt(config.path.split(':')[1]);
            const blobUrl = this.sndReader.getSound(index);

            if (blobUrl) {
                src = [blobUrl];
                format = ['wav'];
            } else {
                return null;
            }
        }

        const sound = new Howl({
            src: src,
            format: format,
            loop: config.loop,
            volume: vol,
            autoplay: false,
            // Use Web Audio API (default) to avoid HTML5 pool exhaustion
            // html5: config.type === SoundType.Music, 
            onloaderror: (id, err) => {
                SoundManager.log.error(`Failed to load sound ${config.id}: ${err}`);
            },
            onplayerror: (id, err) => {
                SoundManager.log.error(`Failed to play sound ${config.id}: ${err}`);
                // Unlock audio context if needed
                if (Howler.ctx && Howler.ctx.state === 'suspended') {
                    Howler.ctx.resume().then(() => {
                        SoundManager.log.info('Audio context resumed from error handler');
                        this.musicController.retryPendingMusic();
                    });
                }
            }
        });

        this.sounds.set(config.id, sound);
        return sound;
    }

    public stopMusic(): void {
        this.musicController.stopMusic();
    }

    public playMusic(soundId: string, fadeDuration = 1000): void {
        this.musicController.playMusic(soundId, fadeDuration);
    }

    public playRandomMusic(race: string): void {
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
     * @param soundId The ID of the sound to play (from SOUND_LIBRARY)
     * @param x World X position
     * @param y World Y position
     * @param index Optional direct index for testing raw sounds from archive
     */
    public playSfx(soundId: string, x?: number, y?: number, index?: number): void {
        let sound: Howl | null = null;
        let baseVol = this.sfxVolume;

        // Allow playing by ID
        if (soundId) {
            const config = SOUND_LIBRARY.find(s => s.id === soundId);
            if (config) {
                sound = this.loadSound(config);
                baseVol *= (config.volume ?? 1.0);
            }
        }

        // Allow playing by direct index (override)
        if (index !== undefined && this.sndReader) {
            const blobUrl = this.sndReader.getSound(index);
            if (blobUrl) {
                sound = new Howl({
                    src: [blobUrl],
                    format: ['wav'],
                    volume: this.sfxVolume
                });
            }
        }

        if (!sound) {
            return;
        }

        const id = sound.play();
        sound.volume(baseVol * this.masterVolume, id);

        if (x !== undefined && y !== undefined) {
            sound.pos(x, y, 0, id);
            sound.pannerAttr({
                panningModel: 'HRTF',
                refDistance: 5,
                rolloffFactor: 1,
                distanceModel: 'inverse',
            }, id);
        } else {
            sound.pos(0, 0, 0, id);
        }
    }

    public setMasterVolume(vol: number): void {
        this.masterVolume = Math.max(0, Math.min(1, vol));
        Howler.volume(this.masterVolume);
        this.musicController.updateVolume();
        this.saveSettings();
    }

    public setMusicVolume(vol: number): void {
        this.musicVolume = Math.max(0, Math.min(1, vol));
        this.musicController.updateVolume();
        this.saveSettings();
    }
}
