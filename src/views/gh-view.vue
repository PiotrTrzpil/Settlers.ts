<template>
    <div class="file-viewer">
        <div class="controls">
            <span class="label">GH File:</span>
            <file-browser
                :fileManager="fileManager"
                @select="file => onFileSelect(file, load)"
                filter=".gh6|.gl6|.gh5|.gl5"
                storageKey="viewer_gh_file"
                class="browser"
            />
            <span class="info">{{ ghContent.length }} images</span>
            <button :class="{ active: viewMode === 'single' }" @click="viewMode = 'single'">Single</button>
            <button :class="{ active: viewMode === 'grid' }" @click="switchToGrid(() => {})">Grid</button>
        </div>

        <!-- Grid View -->
        <ImageGridViewer
            v-if="viewMode === 'grid'"
            :items="ghContent"
            :selected-item="selectedItem"
            :set-canvas-ref="setCanvasRef"
            @select="img => selectImage(img)"
            @visible="(s, e) => renderVisibleImages(ghContent, s, e)"
        >
            <template #default="{ img }">
                <div class="grid-type">{{ toImageTypeStr(img.imageType) }}</div>
            </template>
        </ImageGridViewer>

        <!-- Single View -->
        <div v-if="viewMode === 'single'" class="single-view">
            <select class="item-select" v-model="selectedItem" @change="onSelectItem">
                <option v-for="(item, index) of ghContent" :key="item.dataOffset" :value="item">
                    #{{ index }} - {{ pad(item.dataOffset, 10) }} Size: {{ item.width }}x{{ item.height }}
                    {{ toImageTypeStr(item.imageType) }}
                </option>
            </select>

            <template v-if="selectedItem != null">
                <pre class="item-info">{{ selectedItem.toString() }}</pre>
            </template>

            <div class="canvas-wrapper">
                <canvas ref="ghCav" class="main-canvas"> Sorry! Your browser does not support HTML5 Canvas. </canvas>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef, nextTick, watch } from 'vue';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { ImageType } from '@/resources/gfx/image-type';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages } from '@/utilities/view-helpers';
import { useFileViewer } from '@/composables/useFileViewer';

import FileBrowser from '@/components/file-browser.vue';
import ImageGridViewer from '@/components/ImageGridViewer.vue';

defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

const { viewMode, setCanvasRef, switchToGrid, onFileSelect, renderVisibleImages } = useFileViewer('grid');

const ghContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);

function toImageTypeStr(imgType: ImageType): string {
    return ImageType[imgType];
}

async function load(file: IFileSource) {
    const content = await file.readBinary();

    const ghFile = new GhFileReader(content);

    ghContent.value = collectImages(
        () => ghFile.getImageCount(),
        i => ghFile.getImage(i)
    );

    // Auto-select first item
    if (ghContent.value.length > 0) {
        selectedItem.value = ghContent.value[0] ?? null;
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

// Render single view when switching to single mode
watch(viewMode, newMode => {
    if (newMode === 'single' && selectedItem.value) {
        void nextTick(() => onSelectItem());
    }
});
</script>

<style src="@/styles/file-viewer.css"></style>
