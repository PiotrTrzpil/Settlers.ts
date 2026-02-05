<template>
  <div class="file-viewer">
    <div class="controls">
      <span class="label">GH File:</span>
      <file-browser
        :fileManager="fileManager"
        @select="onFileSelect"
        filter=".gh6|.gl6|.gh5|.gl5"
        class="browser"
      />
      <span class="info">{{ ghContent.length }} images</span>
      <button :class="{ active: viewMode === 'single' }" @click="viewMode = 'single'">Single</button>
      <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(renderAllGridImages)">Grid</button>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid' && ghContent.length > 0" class="grid-container">
      <div
        v-for="(img, index) in ghContent"
        :key="img.dataOffset"
        class="grid-item"
        :class="{ selected: selectedItem === img }"
        @click="selectImage(img)"
      >
        <canvas
          :ref="el => setCanvasRef(el as HTMLCanvasElement, index)"
          :width="Math.min(img.width, 200)"
          :height="Math.min(img.height, 200)"
          class="grid-canvas"
        />
        <div class="grid-label">
          #{{ index }} ({{ img.width }}x{{ img.height }})
        </div>
        <div class="grid-type">{{ toImageTypeStr(img.imageType) }}</div>
      </div>
    </div>

    <!-- Single View -->
    <div v-if="viewMode === 'single'" class="single-view">
      <select
        class="item-select"
        v-model="selectedItem"
        @change="onSelectItem"
      >
        <option v-for="(item, index) of ghContent" :key="item.dataOffset" :value="item">
          #{{ index }} - {{ pad(item.dataOffset, 10) }} Size: {{ item.width }}x{{ item.height }} {{ toImageTypeStr(item.imageType) }}
        </option>
      </select>

      <template v-if="selectedItem != null">
        <pre class="item-info">{{ selectedItem.toString() }}</pre>
      </template>

      <div class="canvas-wrapper">
        <canvas ref="ghCav" class="main-canvas">
          Sorry! Your browser does not support HTML5 Canvas.
        </canvas>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef, nextTick } from 'vue';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { ImageType } from '@/resources/gfx/image-type';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages } from '@/utilities/view-helpers';
import { useSimpleGridView } from '@/composables/useGridView';

import FileBrowser from '@/components/file-browser.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

// Use composable for grid view functionality
const { viewMode, setCanvasRef, clearRefs, canvasRefs, switchToGrid, watchGridMode } = useSimpleGridView('grid');

const fileName = ref<string | null>(null);
const ghContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    clearRefs();
    void load(file);
}

function toImageTypeStr(imgType: ImageType): string {
    return ImageType[imgType];
}

async function load(file: IFileSource) {
    const content = await file.readBinary();

    const ghFile = new GhFileReader(content);

    ghContent.value = collectImages(
        () => ghFile.getImageCount(),
        (i) => ghFile.getImage(i)
    );

    // Auto-select first item
    if (ghContent.value.length > 0) {
        selectedItem.value = ghContent.value[0];
    }

    // Render grid after DOM updates
    if (viewMode.value === 'grid') {
        await nextTick();
        renderAllGridImages();
    }
}

function renderAllGridImages() {
    for (let i = 0; i < ghContent.value.length; i++) {
        const canvas = canvasRefs.get(i);
        const img = ghContent.value[i];
        if (canvas && img) {
            renderImageToCanvas(img, canvas);
        }
    }
}

function selectImage(img: IGfxImage) {
    selectedItem.value = img;
    viewMode.value = 'single';
    onSelectItem();
}

function onSelectItem() {
    const img = selectedItem.value;
    if (!img || !ghCav.value) return;

    ghCav.value.width = img.width;
    ghCav.value.height = img.height;
    renderImageToCanvas(img, ghCav.value);
}

// Re-render grid when toggled on
watchGridMode(renderAllGridImages, () => ghContent.value.length > 0);
</script>

<style src="@/styles/file-viewer.css"></style>
