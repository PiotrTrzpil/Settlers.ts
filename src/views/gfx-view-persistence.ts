/**
 * LocalStorage persistence for GFX viewer state.
 * Saves/restores view mode, scroll position, and selected item index.
 */

import type { Ref } from 'vue';

const STORAGE_KEY = 'gfx_view_state';

export interface SavedGfxState {
    viewMode?: string;
    scrollOffset?: number;
    selectedIndex?: number;
}

export function getSavedState(): SavedGfxState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export interface GfxViewRefs {
    viewMode: Ref<string>;
}

export function loadSavedState(refs: GfxViewRefs): void {
    try {
        const s = getSavedState();
        if (!s) {
            return;
        }
        if (s.viewMode === 'single' || s.viewMode === 'grid') {
            refs.viewMode.value = s.viewMode;
        }
    } catch {
        /* ignore corrupt data */
    }
}

export interface GfxSaveContext {
    refs: GfxViewRefs;
    pendingScrollRestore: () => boolean;
    getScrollOffset: () => number | undefined;
    getSelectedIndex: () => number | undefined;
}

export function saveGfxState(ctx: GfxSaveContext): void {
    // eslint-disable-next-line no-restricted-syntax -- 0 is correct default scroll offset when state doesn't exist
    const prev = getSavedState()?.scrollOffset ?? 0;
    const scrollOffset = ctx.pendingScrollRestore() ? prev : (ctx.getScrollOffset() ?? prev);
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            viewMode: ctx.refs.viewMode.value,
            scrollOffset,
            selectedIndex: ctx.getSelectedIndex(),
        } satisfies SavedGfxState)
    );
}

export function restoreScrollOffset(getScrollRef: () => { setScrollOffset(offset: number): void } | null): void {
    const saved = getSavedState();
    if (saved && typeof saved.scrollOffset === 'number' && saved.scrollOffset > 0) {
        getScrollRef()?.setScrollOffset(saved.scrollOffset);
    }
}
