<template>
  <div class="about">
    Lib File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".lib"
      class="browser"
    />

    <br />
    Items:
    <select
      class="mulit-row fullsize"
      v-model="selectedItem"
      @change="onSelectItem"
    >
      <option v-for="item of libContent" :key="item.fileName" :value="item">
        {{pad(item.getFullName(), 50)}} Size: {{pad(item.decompressedLength, 6)}}
      </option>
    </select>

    <template v-if="selectedItem!=null">

      <pre class="fullsize">{{selectedItem.toString()}}</pre>

      Checksum Check: {{selectedItem.checkChecksum()}}
      <br />

      Show Content: <hex-viewer
        :value="selectedItemReader ?? undefined"
      />
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { LibFileReader } from '@/resources/lib/lib-file-reader';
import { LibFileItem } from '@/resources/lib/lib-file-item';
import { BinaryReader } from '@/resources/file/binary-reader';
import { FileManager, IFileSource } from '@/utilities/file-manager';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

defineProps<{
    fileManager: FileManager;
}>();

const fileName = ref<string | null>(null);
const libContent = ref<LibFileItem[]>([]);
const selectedItem = ref<LibFileItem | null>(null);
const selectedItemReader = shallowRef<BinaryReader | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    void load(file);
}

function onSelectItem() {
    if (!selectedItem.value) {
        selectedItemReader.value = null;
        return;
    }

    selectedItemReader.value = selectedItem.value.getReader();
}

function pad(value: string | number, size: number): string {
    const str = ('' + value + '').split(' ').join('\u00a0');
    const padSize = Math.max(0, size - str.length);
    return str + ('\u00a0'.repeat(padSize));
}

async function load(file: IFileSource) {
    const content = await file.readBinary();
    const libReader = new LibFileReader(content);

    libContent.value = fillLibList(libReader);
}

function fillLibList(libReader: LibFileReader): LibFileItem[] {
    const list: LibFileItem[] = [];
    const l = libReader.getFileCount();
    for (let i = 0; i < l; i++) {
        const fileInfo = libReader.getFileInfo(i);
        list.push(fileInfo);
    }
    return list;
}
</script>

<style scoped>
.mulit-row{
    font-family:"Courier New", Courier, monospace
}
</style>
