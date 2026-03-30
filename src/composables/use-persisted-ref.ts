/**
 * Persistence composables for debug UI state.
 *
 * Components use these instead of raw `ref()` for any state that should
 * survive page reloads. Each value is stored under a namespaced key.
 *
 * Multiple calls with the same key return the SAME reactive ref instance,
 * so cross-component reads stay in sync without provide/inject.
 */

import { ref, watch, onMounted, type Ref } from 'vue';

const NAMESPACE = 'settlers-debug';

/** Shared cache — ensures same key always returns the same ref. */
const refCache = new Map<string, Ref<unknown>>();

function fullKey(key: string): string {
    return `${NAMESPACE}:${key}`;
}

/** Load a value from localStorage, falling back to defaultValue. */
function load<T>(key: string, defaultValue: T): T {
    try {
        const raw = localStorage.getItem(fullKey(key));
        if (raw === null) {
            return defaultValue;
        }
        return JSON.parse(raw) as T;
    } catch {
        return defaultValue;
    }
}

/** Save a value to localStorage. */
function save<T>(key: string, value: T): void {
    try {
        localStorage.setItem(fullKey(key), JSON.stringify(value));
    } catch {
        // localStorage full or unavailable — ignore
    }
}

/**
 * A ref that auto-persists to localStorage.
 *
 * Multiple calls with the same key return the SAME ref instance, so
 * cross-component reads stay in sync (e.g. OverlayPanel writes,
 * another panel reads).
 *
 * @param key - Unique storage key (namespaced under 'settlers-debug:')
 * @param defaultValue - Used when no persisted value exists
 */
export function usePersistedRef<T>(key: string, defaultValue: T): Ref<T> {
    const existing = refCache.get(key);
    if (existing) {
        return existing as Ref<T>;
    }

    const r = ref(load(key, defaultValue)) as Ref<T>;
    watch(r, v => save(key, v), { flush: 'post' });
    refCache.set(key, r as Ref<unknown>);
    return r;
}

/**
 * A persisted ref that also syncs to an external target on every change.
 *
 * Calls `onSync` immediately (with the persisted or default value) during
 * onMounted, then on every subsequent change. This eliminates the common
 * `onMounted(() => apply(ref.value)); watch(ref, apply)` boilerplate.
 *
 * @param key - Unique storage key
 * @param defaultValue - Used when no persisted value exists
 * @param onSync - Called with the current value on mount and on every change
 */
export function useSyncedRef<T>(key: string, defaultValue: T, onSync: (value: T) => void): Ref<T> {
    const r = usePersistedRef(key, defaultValue);
    onMounted(() => onSync(r.value));
    watch(r, v => onSync(v));
    return r;
}
