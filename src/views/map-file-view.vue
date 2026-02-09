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

    <div v-if="stats" class="stats-container">
      <h3>Map Statistics</h3>
      <div class="stats-row">
        <div class="stats-col">
          <h4>Objects (Byte 2)</h4>
          <div v-for="(count, type) in stats.objects" :key="'obj'+type">
            Type {{type}}: {{count}}
          </div>
        </div>
        <div class="stats-col">
          <h4>Resources (Byte 3)</h4>
          <div v-for="(count, type) in stats.resources" :key="'res'+type">
            Type {{type}}: {{count}}
          </div>
        </div>
      </div>
    </div>
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
    
    updateStats(mapContent.value);
}

const stats = ref<{objects: Record<number, number>, resources: Record<number, number>} | null>(null);

function updateStats(loader: IMapLoader) {
    const l = loader.landscape;
    if (!l) return;

    stats.value = {
        objects: {},
        resources: {}
    };

    if (l.getObjectType) {
        const data = l.getObjectType();
        stats.value.objects = analyzeBytes(data);
    }
    
    if (l.getResourceType) {
        const data = l.getResourceType();
        stats.value.resources = analyzeBytes(data);
    }
}

function analyzeBytes(data: Uint8Array): Record<number, number> {
    const counts: Record<number, number> = {};
    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        if (val === 0) continue;
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
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

.stats-container {
    margin-top: 20px;
    border-top: 1px solid #ccc;
    padding-top: 10px;
}

.stats-row {
    display: flex;
    gap: 20px;
}

.stats-col {
    flex: 1;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid #eee;
    padding: 5px;
}
</style>
