import { Howl } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SoundConfig } from './audio-definitions';

/**
 * A pool of Howl instances for rapid SFX playback.
 * Allows multiple concurrent plays of the same sound without interruption.
 */
export class SfxPool {
    private static log = new LogHandler('SfxPool');

    private pool: Howl[] = [];
    private currentIndex = 0;
    private baseVolume: number;

    constructor(
        private config: SoundConfig,
        private poolSize: number,
        private createHowl: (config: SoundConfig) => Howl | null
    ) {
        this.baseVolume = config.volume ?? 1.0;
        this.initPool();
    }

    private initPool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            const howl = this.createHowl(this.config);
            if (howl) {
                this.pool.push(howl);
            }
        }
        SfxPool.log.debug(`Created pool of ${this.pool.length} instances for ${this.config.id}`);
    }

    /**
     * Play the sound, cycling through pool instances.
     * @param categoryVolume The category volume multiplier (sfxVolume * masterVolume)
     * Returns the Howl instance and play ID for further manipulation.
     */
    public play(categoryVolume: number, x?: number, y?: number): { howl: Howl; id: number } | null {
        if (this.pool.length === 0) {
            return null;
        }

        // Round-robin through the pool
        const howl = this.pool[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.pool.length;

        const id = howl.play();
        // Apply base volume from config + category volume
        howl.volume(this.baseVolume * categoryVolume, id);

        if (x !== undefined && y !== undefined) {
            howl.pos(x, y, 0, id);
            howl.pannerAttr({
                panningModel: 'HRTF',
                refDistance: 5,
                rolloffFactor: 1,
                distanceModel: 'inverse',
            }, id);
        }

        return { howl, id };
    }

    /**
     * Stop all sounds in the pool.
     */
    public stopAll(): void {
        for (const howl of this.pool) {
            howl.stop();
        }
    }

    /**
     * Unload all sounds in the pool.
     */
    public unload(): void {
        for (const howl of this.pool) {
            howl.stop();
            howl.unload();
        }
        this.pool = [];
    }

    /**
     * Update volume for all instances in the pool.
     * @param categoryVolume The category volume multiplier (sfxVolume * masterVolume)
     */
    public setVolume(categoryVolume: number): void {
        const effectiveVol = this.baseVolume * categoryVolume;
        for (const howl of this.pool) {
            howl.volume(effectiveVol);
        }
    }
}

/**
 * Manages multiple SFX pools for different sound types.
 */
export class SfxPoolManager {
    private static log = new LogHandler('SfxPoolManager');

    private pools: Map<string, SfxPool> = new Map();

    constructor(
        private createHowl: (config: SoundConfig) => Howl | null,
        private getVolume: () => number
    ) {}

    /**
     * Register a sound for pooling with a specified pool size.
     */
    public registerPool(config: SoundConfig, poolSize: number): void {
        if (this.pools.has(config.id)) {
            SfxPoolManager.log.warn(`Pool already exists for ${config.id}`);
            return;
        }

        const pool = new SfxPool(config, poolSize, this.createHowl);
        this.pools.set(config.id, pool);
    }

    /**
     * Play a pooled sound. Returns false if sound is not pooled.
     */
    public play(soundId: string, x?: number, y?: number): boolean {
        const pool = this.pools.get(soundId);
        if (!pool) {
            return false; // Not a pooled sound
        }

        pool.play(this.getVolume(), x, y);
        return true;
    }

    /**
     * Check if a sound is pooled.
     */
    public isPooled(soundId: string): boolean {
        return this.pools.has(soundId);
    }

    /**
     * Update volume for all pools.
     */
    public updateVolume(): void {
        const vol = this.getVolume();
        for (const pool of this.pools.values()) {
            pool.setVolume(vol);
        }
    }

    /**
     * Unload all pools.
     */
    public unload(): void {
        for (const pool of this.pools.values()) {
            pool.unload();
        }
        this.pools.clear();
    }
}
