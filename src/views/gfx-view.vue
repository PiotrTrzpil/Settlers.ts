<template>
  <div class="about">
    Gfx File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".gfx"
      class="browser"
    />
    <br />
    number of images: {{gfxContent?.length}} - total image size: {{imageSize}}
    <br />
    Items:
    <select
      class="mulit-row fullsize"
      v-model="selectedItem"
      @change="onSelectItem"
    >
      <option v-for="item of gfxContent" :key="item.dataOffset" :value="item">
        {{pad(item.dataOffset, 10)}} Size: {{pad(item.height + ' x ' + item.width, 12)}}
      </option>
    </select>

    <br />

    <template v-if="selectedItem!=null">
      <pre class="fullsize">{{selectedItem.toString()}}</pre>
      <br />
    </template>

    Image:<br />
    <canvas height="800" width="800" ref="ghCav" class="1PixelatedRendering">
      Sorry! Your browser does not support HTML5 Canvas and can not run this Application.
    </canvas>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, useTemplateRef } from 'vue';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

const log = new LogHandler('GfxView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

const fileName = ref<string | null>(null);
const gfxContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);
const gfxFile = ref<GfxFileReader | null>(null);

const imageSize = computed(() => {
    let sum = 0;
    for (const i of gfxContent.value) {
        sum += i.height * i.width;
    }
    return sum;
});

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

    const hasJil = fileSet.jil.length > 0;
    const directionIndexList = hasJil ? readers.dilFileReader : null;
    const jobIndexList = hasJil ? readers.jilFileReader : null;

    const gfxIndexList = new GilFileReader(fileSet.gil);
    gfxFile.value = new GfxFileReader(fileSet.gfx, gfxIndexList, jobIndexList, directionIndexList, readers.paletteCollection);

    const gfx = gfxFile.value;
    gfxContent.value = collectImages(
        () => gfx.getImageCount(),
        (i) => gfx.getImage(i)
    );

    log.debug('File: ' + fileId);
    log.debug(gfxIndexList.toString());
    log.debug(gfx.toString());
}

function onSelectItem() {
    const img = selectedItem.value;
    if (!img) {
        return;
    }

    renderImageToCanvas(img, ghCav.value as HTMLCanvasElement);
}
</script>

<style scoped>
.mulit-row{
    font-family:"Courier New", Courier, monospace
}
</style>
