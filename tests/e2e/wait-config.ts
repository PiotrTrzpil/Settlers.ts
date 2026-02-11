/**
 * Centralized wait configuration for e2e tests.
 *
 * ## Philosophy
 *
 * - **Semantic names** over magic numbers
 * - **Polling by default** - game state is async, point-in-time checks are rarely useful
 * - **Frame-based waits** for render-related operations
 * - **Time-based waits** only for external systems (audio, network)
 *
 * ## Frame Wait Guidelines
 *
 * At 60fps, 1 frame = ~16ms. Use these constants:
 *
 * | Constant          | Frames | ~Time | Use Case                                    |
 * |-------------------|--------|-------|---------------------------------------------|
 * | IMMEDIATE         | 1      | 16ms  | State already set, just need render tick    |
 * | STATE_PROPAGATE   | 2-3    | 50ms  | Camera move, mode switch, simple state      |
 * | RENDER_SETTLE     | 5      | 80ms  | Entity creation, basic rendering            |
 * | ANIMATION_SETTLE  | 10     | 165ms | Animation start/stop, sprite changes        |
 * | VISUAL_STABLE     | 15     | 250ms | Screenshot comparison, complex rendering    |
 *
 * ## Timeout Guidelines
 *
 * | Constant          | Time   | Use Case                                    |
 * |-------------------|--------|---------------------------------------------|
 * | FAST              | 3s     | Simple state checks, mode changes           |
 * | DEFAULT           | 5s     | Most game operations                        |
 * | MOVEMENT          | 8s     | Unit movement (path-dependent)              |
 * | LONG_MOVEMENT     | 10s    | Long paths, destination arrival             |
 * | INITIAL_LOAD      | 20s    | Page load, waitForReady                     |
 * | ASSET_LOAD        | 30s    | GFX file loading, sprite cache              |
 */

// ─────────────────────────────────────────────────────────────────────────────
// Frame-based waits (for synchronizing with render loop)
// ─────────────────────────────────────────────────────────────────────────────

/** Frame wait constants - use with waitForFrames() */
export const Frames = {
    /** State already set, just need one render tick to reflect it */
    IMMEDIATE: 1,

    /** Camera repositioning, mode switches, simple state propagation */
    STATE_PROPAGATE: 2,

    /** Entity creation, basic render updates */
    RENDER_SETTLE: 5,

    /** Animation state changes, sprite transitions */
    ANIMATION_SETTLE: 10,

    /** Screenshot comparisons, complex multi-entity rendering */
    VISUAL_STABLE: 15,
};

// ─────────────────────────────────────────────────────────────────────────────
// Time-based timeouts (for polling operations)
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout constants in milliseconds */
export const Timeout = {
    /** Simple state checks, mode changes */
    FAST: 3_000,

    /** Most game operations - entity count, building placement */
    DEFAULT: 5_000,

    /** Unit movement (depends on path length and speed) */
    MOVEMENT: 8_000,

    /** Long movements, waiting for destination arrival */
    LONG_MOVEMENT: 10_000,

    /** Initial page load, waitForReady */
    INITIAL_LOAD: 20_000,

    /** Asset loading - GFX files, sprite cache population */
    ASSET_LOAD: 30_000,

    /** Worker fixture setup (includes build time in CI) */
    WORKER_SETUP: 45_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Polling intervals (for expect.toPass and custom polling)
// ─────────────────────────────────────────────────────────────────────────────

/** Polling interval arrays for expect.toPass() */
export const PollIntervals = {
    /** Fast polling for quick state changes */
    FAST: [50, 100, 200],

    /** Standard polling with exponential backoff */
    DEFAULT: [100, 200, 500, 1000],

    /** Slow polling for movement/animation */
    MOVEMENT: [100, 250, 500, 1000, 2000],
};

// ─────────────────────────────────────────────────────────────────────────────
// Debug stats refresh rate (game throttles updates)
// ─────────────────────────────────────────────────────────────────────────────

/** Debug stats update interval in the game (see src/game/debug-stats.ts) */
export const DEBUG_STATS_REFRESH_MS = 500;
