/**
 * Format of public/Siedler4/Sfx/sounds.json, written by `pnpm sounds:extract`
 * (scripts/extract-sounds) from the player's own Settlers 4 installation.
 * See docs/SOUND.md. Nothing in public/Siedler4 is committed to git.
 */

/** Sound id as used by the original game data, without the `SOUND_` prefix (e.g. `WORK_AXE`). */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- documents which strings are sound ids
export type SoundName = string;

export interface SoundVariant {
    /** File name relative to the Sfx folder */
    file: string;
    /** Length in seconds */
    duration: number;
}

export interface SoundManifest {
    version: 1;
    sounds: Record<SoundName, SoundVariant[]>;
}

/** Folder (URL path) holding the extracted sound effects and the manifest. */
export const SFX_URL_PATH = '/Siedler4/Sfx';
export const SOUND_MANIFEST_FILE = 'sounds.json';

/** Strip the `SOUND_` prefix used by the original data files. */
export function toSoundName(id: string): SoundName {
    return id.startsWith('SOUND_') ? id.slice('SOUND_'.length) : id;
}
