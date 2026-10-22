/**
 * Audio Module — Public API
 *
 * All external code should import from this barrel file.
 */

// Core types and sound definitions
export { SoundType, SOUND_LIBRARY } from './audio-definitions';
export type { IAudioManager, SoundConfig } from './audio-definitions';

// Main sound manager (singleton entry point)
export { SoundManager } from './sound-manager';

// Music controller
export { MusicController } from './music-controller';

// SFX pooling
export { SfxPool, SfxPoolManager } from './sfx-pool';

// Sound effects extracted by `pnpm sounds:extract` (see docs/SOUND.md)
export { SFX_URL_PATH, SOUND_MANIFEST_FILE, toSoundName } from './sound-manifest';
export type { SoundManifest, SoundVariant, SoundName } from './sound-manifest';
export { parseJobSoundList, loadJobSoundList, type JobSound } from './job-sound-list';
export {
    WorldSounds,
    findCrossedSound,
    type FrameCountLookup,
    type AnimationSource,
    type AnimationFrameState,
} from './world-sounds';
export { AmbientSounds, classifyTerrain, type AmbientSource, type AmbientSoundsDeps } from './ambient-sounds';
export { positionalMix, type SoundListener } from './sound-position';
