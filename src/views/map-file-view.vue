<template>
  <div class="about">
    Map File:
    <file-browser
      :fileManager="fileManager"
      @select="onFileSelect"
      filter=".exe|.map|.edm"
      class="browser"
    />

    <pre class="fullsize">{{mapInfo}}</pre>

    <select class="mulit-row fullsize" v-model="selectedChunk">
      <option v-for="chunk of mapChunks" :key="chunk.offset" :value="chunk">
        Type: {{pad(chunk.chunkTypeAsString + ' - ' + chunk.chunkType, 35)}} Size: {{pad(chunk.length, 6)}}
      </option>
    </select>

    <pre class="fullsize" v-if="selectedChunk!=null">{{selectedChunk.toString()}}</pre>

    <hex-viewer
      v-if="selectedChunk && mapContent"
      :value="selectedChunk.getReader()"
      :width="mapContent.mapSize.width"
      :height="mapContent.mapSize.height"
    />

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { MapLoader } from '@/resources/map/map-loader';
import { OriginalMapFile } from '@/resources/map/original/original-map-file';
import { MapChunk } from '@/resources/map/original/map-chunk';
import { IMapLoader } from '@/resources/map/imap-loader';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

const log = new LogHandler('MapFileView');

const props = defineProps<{
    fileManager: FileManager;
}>();

const fileName = ref<string | null>(null);
const mapInfo = ref('');
const mapChunks = ref<MapChunk[]>([]);
const selectedChunk = ref<MapChunk | null>(null);
const mapContent = ref<IMapLoader | null>(null);

function onFileSelect(file: IFileSource) {
    fileName.value = file.name;
    void load(file);
}

function pad(value: string | number, size: number): string {
    const str = ('' + value + '').split(' ').join('\u00a0');
    const padSize = Math.max(0, size - str.length);
    return str + ('\u00a0'.repeat(padSize));
}

async function load(file: IFileSource) {
    if (!props.fileManager) {
        return;
    }

    const fileData = await file.readBinary();
    if (!fileData) {
        log.error('unable to load ' + file.name);
        return;
    }

    mapContent.value = MapLoader.getLoader(fileData);
    if (!mapContent.value) {
        log.error('file not found ' + file.name);
        return;
    }

    mapChunks.value = fillChunkList(mapContent.value as any as OriginalMapFile);
    mapInfo.value = mapContent.value.toString();
}

function fillChunkList(map: OriginalMapFile) {
    const list: MapChunk[] = [];
    const count = map.getChunkCount();
    for (let i = 0; i < count; i++) {
        const chunk = map.getChunkByIndex(i);
        list.push(chunk);
    }
    return list;
}
</script>

<style scoped>
.mulit-row{
    font-family:"Courier New", Courier, monospace
}
</style>
