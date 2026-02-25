/// <reference types="vite/client" />

import type { SettlersBridge } from '@/game/debug-bridge';

/**
 * Global window extensions for the debug/test bridge and HMR singletons.
 */
declare global {
    interface Window {
        /** Consolidated debug/test bridge — single entry point for all game internals */
        __settlers__?: SettlersBridge;
        /** Debug helper for audio state inspection */
        debugSound?: () => void;
        /** Build hash exposed for stale-server detection by e2e tests */
        __source_hash__?: string;
    }
}
