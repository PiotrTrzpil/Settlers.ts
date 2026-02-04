<template>
  <div class="about">
    Gh File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".gh6|.gl6|.gh5|.gl5"
      class="browser"
    />

    <br />
    Items:
    <select
      class="mulit-row fullsize"
      v-model="selectedItem"
      @change="onSelectItem"
    >
      <option v-for="item of ghContent" :key="item.dataOffset" :value="item">
        {{pad(item.dataOffset, 10)}}
        Size: {{pad(item.height + ' x ' + item.width, 12)}}
        {{pad(toImageTypeStr(item.imageType), 10)}}
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
import { ref, useTemplateRef } from 'vue';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { ImageType } from '@/resources/gfx/image-type';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const ghCav = useTemplateRef<HTMLCanvasElement>('ghCav');

const fileName = ref<string | null>(null);
const ghInfo = ref('');
const ghContent = ref<IGfxImage[]>([]);
const selectedItem = ref<IGfxImage | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
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
    ghInfo.value = ghFile.toString();
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
