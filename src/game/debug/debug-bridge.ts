/**
 * Single debug/test bridge exposed on `window.__settlers__`.
 *
 * Consolidates all game internals into one typed object instead of many
 * separate `window.__settlers_*__` globals. Source modules call `getBridge()`
 * to set their properties; e2e tests read `window.__settlers__` in page.evaluate().
 */

import type { Game } from '../game';
import type { GameSettingsManager } from '../game-settings';
import type { DebugStatsState } from './debug-stats';
import type { GameViewState, GameViewStateData } from '../ui/game-view-state';
import type { ViewPoint } from '../renderer/view-point';
import type { LandscapeRenderer } from '../renderer/landscape/landscape-renderer';
import type { EntityRenderer } from '../renderer/entity-renderer';
import type { InputManager } from '../input/input-manager';
import type { SoundManager } from '../audio/sound-manager';
import type { spiralSearch } from '../utils/spiral-search';
import type { GameCli } from '../cli/cli';
import type { TimelineCapture } from './timeline-capture';

/**
 * Bridge shape — all properties are optional because different modules
 * populate them at different times during initialization.
 */
export interface SettlersBridge {
    // Game core (set by debug-stats.ts on game start)
    game?: Game;

    // CLI engine (set by Game constructor in dev mode)
    cli?: GameCli;

    // Timeline capture (set by Game constructor in dev mode)
    timelineCapture?: TimelineCapture;
    settings?: GameSettingsManager;

    // Debug stats (set by debug-stats.ts constructor)
    debug?: DebugStatsState;

    // View state (set by game-view-state.ts constructor)
    view?: GameViewStateData;
    viewState?: GameViewState;

    // Renderer objects (set by use-renderer.ts)
    viewpoint?: ViewPoint;
    landscape?: LandscapeRenderer;
    entityRenderer?: EntityRenderer;
    input?: InputManager;

    // Audio (set by sound-manager.ts, persists across HMR)
    soundManager?: SoundManager;

    // Utility functions
    utils?: {
        spiralSearch?: typeof spiralSearch;
    };
}

/**
 * Get or create the shared bridge object on `window.__settlers__`.
 * Safe to call in Node.js (returns a throwaway object).
 */
export function getBridge(): SettlersBridge {
    if (typeof window === 'undefined') {
        return {};
    }
    if (!window.__settlers__) {
        window.__settlers__ = {};
    }
    return window.__settlers__;
}
