<template>
  <div class="file-viewer">
    <div class="controls">
      <span class="label">Gfx File:</span>
      <file-browser
        :fileManager="fileManager"
        @select="onFileSelect"
        filter=".gfx"
        storageKey="viewer_gfx_file"
        class="browser"
      />
      <span class="info">{{ gfxContent?.length }} images</span>
      <button :class="{ active: viewMode === 'single' }" @click="viewMode = 'single'">Single</button>
      <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(renderAllGridImages)">Grid</button>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid' && gfxContent.length > 0" class="grid-container">
      <div
        v-for="(img, index) in gfxContent"
        :key="img.dataOffset"
        class="grid-item"
        :class="{ selected: selectedItem === img }"
        @click="selectImage(img, index)"
      >
        <canvas
          :ref="el => setCanvasRef(el as HTMLCanvasElement, index)"
          :width="Math.min(img.width, 200)"
          :height="Math.min(img.height, 200)"
          class="grid-canvas"
        />
        <div class="grid-label">#{{ index }} ({{ img.width }}x{{ img.height }})</div>
      </div>
    </div>

    <!-- Single View -->
    <div v-if="viewMode === 'single'" class="single-view">
      <select
        class="item-select"
        v-model="selectedItem"
        @change="onSelectItem"
      >
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
import { ref, useTemplateRef, nextTick } from 'vue';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';
import { useSimpleGridView } from '@/composables/useGridView';

import FileBrowser from '@/components/file-browser.vue';

const log = new LogHandler('GfxView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const mainCanvas = useTemplateRef<HTMLCanvasElement>('mainCanvas');

// Use composable for grid view functionality
const { viewMode, setCanvasRef, clearRefs, canvasRefs, switchToGrid, watchGridMode } = useSimpleGridView('grid');

const fileName = ref<string | null>(null);
const gfxContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);
const gfxFile = ref<GfxFileReader | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    clearRefs();
    void load(file);
}

async function load(file: IFileSource) {
    if (!props.fileManager) return;
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
        (i) => gfx.getImage(i)
    );

    log.debug('File: ' + fileId + ' with ' + gfxContent.value.length + ' images');

    // Render grid after DOM updates
    if (viewMode.value === 'grid') {
        await nextTick();
        renderAllGridImages();
    }
}

function renderAllGridImages() {
    for (let i = 0; i < gfxContent.value.length; i++) {
        const canvas = canvasRefs.get(i);
        const img = gfxContent.value[i];
        if (canvas && img) {
            renderImageToCanvas(img, canvas);
        }
    }
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
