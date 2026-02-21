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
            <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(renderAllGridImages)">Grid</button>
        </div>

        <!-- Grid View -->
        <ImageGridViewer
            v-if="viewMode === 'grid'"
            :items="gfxContent"
            :selected-item="selectedItem"
            :set-canvas-ref="setCanvasRef"
            @select="(img, i) => selectImage(img, i)"
        />

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
import { ref, useTemplateRef } from 'vue';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';
import { useFileViewer } from '@/composables/useFileViewer';

import FileBrowser from '@/components/file-browser.vue';
import ImageGridViewer from '@/components/ImageGridViewer.vue';

const log = new LogHandler('GfxView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const mainCanvas = useTemplateRef<HTMLCanvasElement>('mainCanvas');

const { viewMode, setCanvasRef, switchToGrid, watchGridMode, onFileSelect, renderAfterLoad, renderGridImages } =
    useFileViewer('grid');

const gfxContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);
const gfxFile = ref<GfxFileReader | null>(null);

async function load(file: IFileSource) {
    const fileId = Path.getFileNameWithoutExtension(file.name);
    await doLoad(fileId);
}

async function doLoad(fileId: string) {
    const fileSet = await loadGfxFileSet(props.fileManager, fileId);
    const readers = parseGfxReaders(fileSet);

    // For the GFX viewer, don't use jil/dil - just browse raw images by gil index
    // This avoids reverse lookup errors for images outside the job/direction tables
    gfxFile.value = new GfxFileReader(fileSet.gfx, readers.gilFileReader, null, null, readers.paletteCollection);

    const gfx = gfxFile.value;
    gfxContent.value = collectImages(
        () => gfx.getImageCount(),
        i => gfx.getImage(i)
    );

    log.debug('File: ' + fileId + ' with ' + gfxContent.value.length + ' images');

    await renderAfterLoad(renderAllGridImages);
}

function renderAllGridImages() {
    renderGridImages(gfxContent.value);
}

function selectImage(img: IGfxImage, index: number) {
    selectedItem.value = img;
    log.debug(`Selected image #${index}: ${img.width}x${img.height}`);
}

function onSelectItem() {
    const img = selectedItem.value;
    if (!img || !mainCanvas.value) return;
    renderImageToCanvas(img, mainCanvas.value);
}

// Re-render grid when toggled on
watchGridMode(renderAllGridImages, () => gfxContent.value.length > 0);
</script>

<style src="@/styles/file-viewer.css"></style>
