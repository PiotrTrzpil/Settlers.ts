/**
 * Plays sound effects extracted from the player's own game files by `pnpm sounds:extract`
 * (public/Siedler4/Sfx/*.wav + sounds.json). One Howl per file, created lazily.
 */

import { Howl } from 'howler';
import { LogHandler } from '@/utilities/log-handler';
import { SFX_URL_PATH, SOUND_MANIFEST_FILE, type SoundManifest, type SoundName } from './sound-manifest';
import { randomUnit } from './random-unit';

const log = new LogHandler('SoundEffectPlayer');

export class SoundEffectPlayer {
    private manifest: SoundManifest | null = null;
    private howls = new Map<string, Howl>();

    /** Load the manifest. Without it (job not run yet) every play() is a silent no-op. */
    async load(): Promise<void> {
        const url = `${SFX_URL_PATH}/${SOUND_MANIFEST_FILE}`;
        try {
            const response = await fetch(url);
            // Vite answers missing files with index.html, so parse rather than trust the status
            this.manifest = (await response.json()) as SoundManifest;
            log.debug(`Loaded ${Object.keys(this.manifest.sounds).length} sound effects`);
        } catch {
            log.warn(
                `No sound effects at ${url}. Run \`pnpm sounds:extract <path-to-thesettlers4>\` (see docs/SOUND.md).`
            );
        }
    }

    get isLoaded(): boolean {
        return this.manifest !== null;
    }

    /**
     * Play a random variant of a sound.
     * @param volume Final volume in [0, 1]
     * @param pan Stereo pan in [-1 (left), 1 (right)]
     * @returns Length of the variant in seconds, or null if the sound is unknown / not extracted
     */
    play(name: SoundName, volume: number, pan: number): number | null {
        const variants = this.manifest?.sounds[name];
        if (!variants || variants.length === 0) {
            return null;
        }
        const variant = variants[Math.min(variants.length - 1, Math.floor(randomUnit() * variants.length))]!;
        let howl = this.howls.get(variant.file);
        if (!howl) {
            howl = new Howl({ src: [`${SFX_URL_PATH}/${variant.file}`], format: ['wav'] });
            this.howls.set(variant.file, howl);
        }
        const id = howl.play();
        howl.volume(volume, id);
        howl.stereo(pan, id);
        return variant.duration;
    }

    unload(): void {
        for (const howl of this.howls.values()) {
            howl.unload();
        }
        this.howls.clear();
    }
}
