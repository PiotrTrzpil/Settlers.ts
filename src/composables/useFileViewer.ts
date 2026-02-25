import { ref, nextTick } from 'vue';
import type { IFileSource } from '@/utilities/file-manager';
import { useSimpleGridView, type ViewMode } from './useGridView';
import type { IGfxImage } from '@/resources/gfx/igfx-image';
import { renderImageToCanvas } from '@/utilities/view-helpers';

/**
 * Composable for simple image-grid file viewers (gfx-view, gh-view).
 * Wraps useSimpleGridView with common file selection, name tracking,
 * and IGfxImage grid-rendering helpers.
 */
export function useFileViewer(initialMode: ViewMode = 'grid') {
    const gridView = useSimpleGridView(initialMode);
    const fileName = ref<string | null>(null);

    /** Handle file selection: track name, clear canvas refs, call loadFn. */
    function onFileSelect(file: IFileSource, loadFn: (file: IFileSource) => Promise<void> | void) {
        fileName.value = file.name;
        gridView.clearRefs();
        void loadFn(file);
    }

    /** After loading content, render the grid if currently in grid mode. */
    async function renderAfterLoad(renderFn: () => void) {
        if (gridView.viewMode.value === 'grid') {
            await nextTick();
            renderFn();
        }
    }

    /** Render all IGfxImage items into their corresponding grid canvases. */
    function renderGridImages(images: IGfxImage[]) {
        for (let i = 0; i < images.length; i++) {
            const canvas = gridView.canvasRefs.get(i);
            const img = images[i];
            if (canvas && img) {
                renderImageToCanvas(img, canvas);
            }
        }
    }

    /**
     * Render only the visible range of images (called by VirtualGrid @visible).
     * Always re-renders because virtualized canvases are destroyed/recreated on scroll.
     */
    function renderVisibleImages(images: IGfxImage[], startIndex: number, endIndex: number) {
        for (let i = startIndex; i < endIndex; i++) {
            const canvas = gridView.canvasRefs.get(i);
            const img = images[i];
            if (canvas && img) {
                renderImageToCanvas(img, canvas);
            }
        }
    }

    return { ...gridView, fileName, onFileSelect, renderAfterLoad, renderGridImages, renderVisibleImages };
}
