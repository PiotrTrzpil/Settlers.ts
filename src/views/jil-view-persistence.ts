/**
 * LocalStorage persistence for JIL viewer state.
 * Saves/restores view mode, animation, corrections, grid direction, scroll position, and selection.
 */

import type { Ref } from 'vue';

const STORAGE_KEY = 'jil_view_state';

export interface SavedJilState {
    viewMode?: string;
    doAnimation?: boolean;
    magentaBg?: boolean;
    withCorrections?: boolean;
    gridDirection?: 'all' | number;
    scrollOffset?: number;
    jobIndex?: number;
    dirIndex?: number;
    frameIndex?: number;
}

export function getSavedState(): SavedJilState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export interface JilViewRefs {
    viewMode: Ref<string>;
    doAnimation: Ref<boolean>;
    magentaBg: Ref<boolean>;
    withCorrections: Ref<boolean>;
    gridDirection: Ref<'all' | number>;
}

export function loadSavedState(refs: JilViewRefs): void {
    try {
        const s = getSavedState();
        if (!s) {
            return;
        }
        if (s.viewMode === 'single' || s.viewMode === 'grid') {
            refs.viewMode.value = s.viewMode;
        }
        if (typeof s.doAnimation === 'boolean') {
            refs.doAnimation.value = s.doAnimation;
        }
        if (typeof s.magentaBg === 'boolean') {
            refs.magentaBg.value = s.magentaBg;
        }
        if (typeof s.withCorrections === 'boolean') {
            refs.withCorrections.value = s.withCorrections;
        }
        if (s.gridDirection === 'all' || typeof s.gridDirection === 'number') {
            refs.gridDirection.value = s.gridDirection;
        }
    } catch {
        /* ignore corrupt data */
    }
}

export interface JilSaveContext {
    refs: JilViewRefs;
    pendingScrollRestore: () => boolean;
    getScrollOffset: () => number | undefined;
    getSelection: () => { jobIndex?: number; dirIndex?: number; frameIndex?: number };
}

export function saveJilState(ctx: JilSaveContext): void {
    // eslint-disable-next-line no-restricted-syntax -- saved state may not exist in localStorage; 0 is correct initial scroll offset
    const prev = getSavedState()?.scrollOffset ?? 0;
    const scrollOffset = ctx.pendingScrollRestore() ? prev : (ctx.getScrollOffset() ?? prev);
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            viewMode: ctx.refs.viewMode.value,
            doAnimation: ctx.refs.doAnimation.value,
            magentaBg: ctx.refs.magentaBg.value,
            withCorrections: ctx.refs.withCorrections.value,
            gridDirection: ctx.refs.gridDirection.value,
            scrollOffset,
            ...ctx.getSelection(),
        } satisfies SavedJilState)
    );
}

export function restoreScrollOffset(getScrollRef: () => { setScrollOffset(offset: number): void } | null): void {
    const saved = getSavedState();
    if (saved && typeof saved.scrollOffset === 'number' && saved.scrollOffset > 0) {
        getScrollRef()?.setScrollOffset(saved.scrollOffset);
    }
}
