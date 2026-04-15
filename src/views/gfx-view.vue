<template>
    <div class="file-viewer">
        <div class="controls">
            <span class="label">Gfx File:</span>
            <file-browser
                :fileManager="fileManager"
                @select="file => onFileSelect(file, load)"
                filter=".gfx"
                storageKey="viewer_gfx_file"
                class="browser"
            />
            <span class="info">{{ gfxContent?.length }} images</span>
            <button :class="{ active: viewMode === 'single' }" @click="viewMode = 'single'">Single</button>
            <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(() => {})">Grid</button>
        </div>

        <!-- Grid View -->
        <ImageGridViewer
            v-if="viewMode === 'grid'"
            ref="gridViewerRef"
            :items="gfxContent"
            :selected-item="selectedItem"
            :set-canvas-ref="setCanvasRef"
            @select="(img, i) => selectImage(img, i)"
            @visible="onGridVisible"
        >
            <template #default="{ index }">
                <div v-if="getLabelForIndex(index)" class="sprite-label">{{ getLabelForIndex(index) }}</div>
            </template>
        </ImageGridViewer>

        <!-- Single View -->
        <div v-if="viewMode === 'single'" class="single-view">
            <select class="item-select" v-model="selectedItem" @change="onSelectItem">
                <option v-for="(item, index) of gfxContent" :key="item.dataOffset" :value="item">
                    #{{ index }} - {{ pad(item.dataOffset, 10) }} Size: {{ item.width }} x {{ item.height }}
                </option>
            </select>

            <template v-if="selectedItem != null">
                <pre class="item-info">{{ selectedItem.toString() }}</pre>
            </template>

            <div class="canvas-wrapper">
                <canvas height="600" width="600" ref="mainCanvas" class="main-canvas" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef, watch, onMounted, onUnmounted } from 'vue';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';
import { useFileViewer } from '@/composables/useFileViewer';
import { getGilLabel } from './gfx-view-labels';
import { getSavedState, loadSavedState, saveGfxState, restoreScrollOffset } from './gfx-view-persistence';

import FileBrowser from '@/components/file-browser.vue';
import ImageGridViewer from '@/components/ImageGridViewer.vue';

const log = new LogHandler('GfxView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const mainCanvas = useTemplateRef<HTMLCanvasElement>('mainCanvas');
const gridViewerRef = ref<InstanceType<typeof ImageGridViewer> | null>(null);

const { viewMode, setCanvasRef, switchToGrid, onFileSelect, renderVisibleImages } = useFileViewer('grid');

const gfxContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);
const selectedIndex = ref<number | null>(null);
const gfxFile = ref<GfxFileReader | null>(null);
const currentFileId = ref<number | null>(null);

let pendingScrollRestore = false;
let scrollSaveTimer = 0;

const viewRefs = { viewMode };
const saveCtx = {
    refs: viewRefs,
    pendingScrollRestore: () => pendingScrollRestore,
    getScrollOffset: () => gridViewerRef.value?.getScrollOffset(),
    getSelectedIndex: () => selectedIndex.value ?? undefined,
};
const saveState = () => saveGfxState(saveCtx);

loadSavedState(viewRefs);

function getLabelForIndex(index: number): string | undefined {
    if (currentFileId.value === null) {
        return undefined;
    }
    return getGilLabel(currentFileId.value, index);
}

async function load(file: IFileSource) {
    const fileId = Path.getFileNameWithoutExtension(file.name);
    await doLoad(fileId);
}

async function doLoad(fileId: string) {
    // Extract numeric file ID for label lookups (e.g., "5" from "5.gfx")
    const numericId = parseInt(fileId, 10);
    currentFileId.value = isNaN(numericId) ? null : numericId;

    const fileSet = await loadGfxFileSet(props.fileManager, fileId);
    const readers = parseGfxReaders(fileSet);

    // Pass jil/dil when available so reverse lookup resolves the correct palette per image.
    // Images not found in job tables fall back to lastGoodJobIndex in GfxFileReader.getImage().
    gfxFile.value = new GfxFileReader(
        fileSet.gfx,
        readers.gilFileReader,
        readers.jilFileReader,
        readers.dilFileReader,
        readers.paletteCollection
    );

    const gfx = gfxFile.value;
    gfxContent.value = collectImages(gfx.getImageCount.bind(gfx), gfx.getImage.bind(gfx));

    log.debug('File: ' + fileId + ' with ' + gfxContent.value.length + ' images');

    // Restore saved selection
    const saved = getSavedState();
    if (saved?.selectedIndex !== undefined && saved.selectedIndex < gfxContent.value.length) {
        selectedItem.value = gfxContent.value[saved.selectedIndex]!;
        selectedIndex.value = saved.selectedIndex;
    }

    // Defer scroll restore until the grid actually renders
    pendingScrollRestore = true;
}

function selectImage(img: IGfxImage, index: number) {
    selectedItem.value = img;
    selectedIndex.value = index;
    log.debug(`Selected image #${index}: ${img.width}x${img.height}`);
}

function onSelectItem() {
    const img = selectedItem.value;
    if (!img || !mainCanvas.value) {
        return;
    }
    renderImageToCanvas(img, mainCanvas.value);
}

function onGridVisible(startIndex: number, endIndex: number) {
    if (pendingScrollRestore) {
        pendingScrollRestore = false;
        restoreScrollOffset(() => gridViewerRef.value);
    }
    renderVisibleImages(gfxContent.value, startIndex, endIndex);
}

watch([viewMode, selectedIndex], () => saveState());

onMounted(() => {
    scrollSaveTimer = window.setInterval(() => saveState(), 500);
});

onUnmounted(() => {
    window.clearInterval(scrollSaveTimer);
    saveState();
});
</script>

<style src="@/styles/file-viewer.css"></style>

<style scoped>
.sprite-label {
    font-size: 10px;
    color: #81c784;
    text-align: center;
    word-break: break-word;
    max-width: 200px;
    line-height: 1.2;
}
</style>
