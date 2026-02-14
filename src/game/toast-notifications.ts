/**
 * Bridge between the game engine and vue-toastification.
 *
 * Game systems (GameLoop, Renderer) call these functions to surface
 * errors/warnings to the player via toasts.  The bridge applies its
 * own throttling so the same message cannot flood the UI.
 *
 * vue-toastification's `useToast()` works outside Vue components
 * once the plugin is installed (it uses a global event bus).
 */

import { useToast } from 'vue-toastification';

/** Minimum interval between identical toast messages (ms) */
const THROTTLE_MS = 10_000;

/** Throttle state per unique key */
const throttle = new Map<string, number>();

function isThrottled(key: string): boolean {
    const now = performance.now();
    const last = throttle.get(key);
    if (last !== undefined && now - last < THROTTLE_MS) {
        return true;
    }
    throttle.set(key, now);
    return false;
}

/** Clean up stale throttle entries periodically */
function pruneThrottle(): void {
    const now = performance.now();
    for (const [key, time] of throttle) {
        if (now - time > THROTTLE_MS * 2) {
            throttle.delete(key);
        }
    }
}

// Prune every 30s to avoid unbounded growth
setInterval(pruneThrottle, 30_000);

/**
 * Show an error toast.  Throttled so the same source+message won't
 * re-appear for THROTTLE_MS.
 */
export function toastError(source: string, message: string): void {
    const key = `error:${source}:${message}`;
    if (isThrottled(key)) return;

    const toast = useToast();
    toast.error(`[${source}] ${message}`, { timeout: 8000 });
}

/**
 * Show a warning toast.  Throttled identically.
 */
export function toastWarn(source: string, message: string): void {
    const key = `warn:${source}:${message}`;
    if (isThrottled(key)) return;

    const toast = useToast();
    toast.warning(`[${source}] ${message}`, { timeout: 6000 });
}

/** Clear throttle state (e.g., on game reset). */
export function toastClearThrottle(): void {
    throttle.clear();
}
