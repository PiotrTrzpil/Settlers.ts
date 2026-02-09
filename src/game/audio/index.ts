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
