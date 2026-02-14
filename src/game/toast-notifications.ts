/**
 * Bridge between the game engine and vue-toastification.
 *
 * Game systems (GameLoop, Renderer) call these functions to surface
 * errors/warnings to the player via toasts.  The bridge applies its
 * own throttling so the same source+message pair cannot reappear for
 * THROTTLE_MS, preventing flood from hot-path callers.
 *
 * vue-toastification's `useToast()` works from anywhere once the
 * plugin is installed on the Vue app.
 */

import { useToast } from 'vue-toastification';

/** Minimum interval between identical toast messages (ms) */
const THROTTLE_MS = 10_000;

/** Throttle state per unique key (key → last-show timestamp) */
const throttle = new Map<string, number>();

/** Handle returned by `setInterval`, lazily created */
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** Cached toast interface — created on first use */
let toast: ReturnType<typeof useToast> | null = null;

function getToast(): ReturnType<typeof useToast> {
    if (!toast) toast = useToast();
    return toast;
}

function isThrottled(key: string): boolean {
    const now = performance.now();
    const last = throttle.get(key);
    if (last !== undefined && now - last < THROTTLE_MS) {
        return true;
    }
    throttle.set(key, now);
    ensurePruneTimer();
    return false;
}

/** Start the prune timer if not already running */
function ensurePruneTimer(): void {
    if (pruneTimer !== null) return;
    pruneTimer = setInterval(() => {
        const now = performance.now();
        for (const [key, time] of throttle) {
            if (now - time > THROTTLE_MS * 2) {
                throttle.delete(key);
            }
        }
        // Stop the timer when nothing left to prune
        if (throttle.size === 0 && pruneTimer !== null) {
            clearInterval(pruneTimer);
            pruneTimer = null;
        }
    }, 30_000);
}

/**
 * Show an error toast.  Throttled per source+message.
 */
export function toastError(source: string, message: string): void {
    const key = `error:${source}:${message}`;
    if (isThrottled(key)) return;
    getToast().error(`[${source}] ${message}`, { timeout: 8000 });
}

/**
 * Show a warning toast.  Throttled per source+message.
 */
export function toastWarn(source: string, message: string): void {
    const key = `warn:${source}:${message}`;
    if (isThrottled(key)) return;
    getToast().warning(`[${source}] ${message}`, { timeout: 6000 });
}

/** Clear all throttle state (e.g., on game reset). */
export function toastClearThrottle(): void {
    throttle.clear();
    if (pruneTimer !== null) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
}
