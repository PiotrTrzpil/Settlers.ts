import { ref, watch, nextTick } from 'vue';

export type ViewMode = 'single' | 'grid';

/**
 * Composable for grid/single view toggle with canvas ref management.
 * Used by gfx-view, gh-view, and jil-view for shared grid functionality.
 */
export function useGridView<K = number>(initialMode: ViewMode = 'grid') {
    const viewMode = ref<ViewMode>(initialMode);
    const canvasRefs = new Map<K, HTMLCanvasElement>();

    /**
     * Store a canvas ref by key (typically index or composite key)
     */
    function setCanvasRef(el: HTMLCanvasElement | null, key: K) {
        if (el) {
            canvasRefs.set(key, el);
        }
    }

    /**
     * Clear all canvas refs (call when loading new file)
     */
    function clearRefs() {
        canvasRefs.clear();
    }

    /**
     * Get a canvas ref by key
     */
    function getCanvasRef(key: K): HTMLCanvasElement | undefined {
        return canvasRefs.get(key);
    }

    /**
     * Switch to grid mode and trigger render callback after DOM update
     */
    async function switchToGrid(renderCallback: () => void) {
        viewMode.value = 'grid';
        await nextTick();
        renderCallback();
    }

    /**
     * Switch to single mode
     */
    function switchToSingle() {
        viewMode.value = 'single';
    }

    /**
     * Setup watcher to re-render grid when switching to grid mode.
     * Call this in component setup with your render function and data check.
     */
    function watchGridMode(renderCallback: () => void, hasData: () => boolean) {
        watch(viewMode, async(newMode) => {
            if (newMode === 'grid' && hasData()) {
                await nextTick();
                renderCallback();
            }
        });
    }

    return {
        viewMode,
        canvasRefs,
        setCanvasRef,
        clearRefs,
        getCanvasRef,
        switchToGrid,
        switchToSingle,
        watchGridMode,
    };
}

/**
 * Simple grid view for numeric index keys (gfx-view, gh-view)
 */
export function useSimpleGridView(initialMode: ViewMode = 'grid') {
    return useGridView<number>(initialMode);
}

/**
 * Composite key grid view for multi-dimensional keys (jil-view: job+direction)
 */
export function useCompositeGridView(initialMode: ViewMode = 'grid') {
    return useGridView<string>(initialMode);
}
