<template>
  <div class="about">
    Jil File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".jil"
      class="browser"
    />

    <br />
    Items:
    <select
      class="mulit-row fullsize"
      v-model="selectedJil"
      @change="onSelectJil"
    >
      <option v-for="item of jilList" :key="item.index" :value="item">
        {{pad(item.index, 5)}} Size: {{pad(item.lenght, 4)}}  Offset: {{pad(item.offset, 6)}}
      </option>
    </select>

    Orientation:
    <select
      class="mulit-row fullsize"
      v-model="selectedDil"
      @change="onSelectDil"
    >
      <option v-for="item of dilList" :key="item.index" :value="item">
        {{pad(item.index, 5)}} Size: {{pad(item.lenght, 4)}}  Offset: {{pad(item.offset, 6)}}
      </option>
    </select>

    Frame:
    <select
      class="mulit-row fullsize"
      v-model="selectedGil"
      @change="onSelectGil"
    >
      <option v-for="item of gilList" :key="item.index" :value="item">
        {{pad(item.index, 5)}} Size: {{pad(item.lenght, 4)}}  Offset: {{pad(item.offset, 6)}}
      </option>
    </select>
    <br />

    Image:
    <label>
      <input type="checkbox" v-model="doAnimation" />
      animate
    </label>

    <br />
    <canvas height="800" width="800" ref="ghCav" class="1PixelatedRendering">
      Sorry! Your browser does not support HTML5 Canvas and can not run this Application.
    </canvas>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { IndexFileItem } from '@/resources/gfx/index-file-item';
import { pad, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

const log = new LogHandler('JilView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

const doAnimation = ref(true);
let animationTimer = 0;

const fileName = ref<string | null>(null);
const jilList = ref<IndexFileItem[]>([]);
const dilList = ref<IndexFileItem[]>([]);
const gilList = ref<IndexFileItem[]>([]);

const selectedJil = ref<IndexFileItem | null>(null);
const selectedDil = ref<IndexFileItem | null>(null);
const selectedGil = ref<IndexFileItem | null>(null);

const gfxFileReader = ref<GfxFileReader | null>(null);
const dilFileReader = ref<DilFileReader | null>(null);
const gilFileReader = ref<GilFileReader | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    void load(file);
}

async function load(file: IFileSource) {
    if (!props.fileManager) {
        return;
    }

    const fileId = Path.getFileNameWithoutExtension(file.name);
    void doLoad(fileId);
}

async function doLoad(fileId: string) {
    const fileSet = await loadGfxFileSet(props.fileManager, fileId);
    const readers = parseGfxReaders(fileSet);

    const dilReader = readers.dilFileReader;
    const gilReader = readers.gilFileReader;
    const jilReader = readers.jilFileReader;

    dilFileReader.value = dilReader;
    gilFileReader.value = gilReader;
    jilList.value = jilReader.getItems(0);

    gfxFileReader.value = new GfxFileReader(
        fileSet.gfx,
        gilReader,
        jilReader,
        dilReader,
        readers.paletteCollection);

    log.debug('File: ' + fileId);
}

function onSelectJil() {
    if ((!selectedJil.value) || (!dilFileReader.value)) {
        return;
    }

    dilList.value = dilFileReader.value.getItems(selectedJil.value.offset, selectedJil.value.lenght);
    selectedDil.value = dilList.value[0];
    onSelectDil();
}

function onSelectDil() {
    if ((!selectedDil.value) || (!gilFileReader.value)) {
        return;
    }

    gilList.value = gilFileReader.value.getItems(selectedDil.value.offset, selectedDil.value.lenght);
    selectedGil.value = gilList.value[0];
    onSelectGil();
}

function onSelectGil() {
    if ((!selectedGil.value) || (!gfxFileReader.value) || (!selectedJil.value) || (!gilFileReader.value)) {
        return;
    }

    const offset = gilFileReader.value.getImageOffset(selectedGil.value.index);
    const gfx = gfxFileReader.value.readImage(offset, selectedJil.value.index);
    if (!gfx) {
        return;
    }

    const img = gfx.getImageData();
    const cavEl = ghCav.value;
    if ((!cavEl) || (!cavEl.getContext)) {
        return;
    }

    cavEl.height = img.height;
    const context = cavEl.getContext('2d');

    if (!context) {
        return;
    }

    context.putImageData(img, 0, 0);
}

function onAnimate() {
    if ((gilList.value == null) || (!gilList.value.length) || (!doAnimation.value)) {
        return;
    }

    const nextFrameIndex = (gilList.value.findIndex((f) => f === selectedGil.value) + 1) % gilList.value.length;
    selectedGil.value = gilList.value[nextFrameIndex];
    onSelectGil();
}

onMounted(() => {
    animationTimer = window.setInterval(() => onAnimate(), 100);
});

onUnmounted(() => {
    window.clearInterval(animationTimer);
});
</script>

<style scoped>
.mulit-row{
    font-family:"Courier New", Courier, monospace
}
</style>
