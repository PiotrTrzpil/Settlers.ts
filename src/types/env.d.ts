/// <reference types="vite/client" />

import type { SoundManager } from '@/game/audio/sound-manager';

/**
 * Global window extensions for HMR-safe singletons and debug helpers.
 */
declare global {
    interface Window {
        /** HMR-safe SoundManager singleton */
        __settlers_sound_manager__?: SoundManager;
        /** Debug helper for audio state inspection */
        debugSound?: () => void;
    }
}
