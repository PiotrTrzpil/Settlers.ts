<template>
  <div class="file-viewer">
    <div class="controls">
      <span class="label">LIB File:</span>
      <file-browser
        :fileManager="fileManager"
        @select="onFileSelect"
        filter=".lib"
        class="browser"
      />
      <span class="info">{{ libContent.length }} items</span>
    </div>

    <div class="single-view">
      <div class="selector-group">
        <label>Item</label>
        <select
          class="item-select"
          v-model="selectedItem"
          @change="onSelectItem"
        >
          <option v-for="(item, index) of libContent" :key="item.getFullName()" :value="item">
            #{{ index }} - {{ item.getFullName() }} ({{ formatSize(item.decompressedLength) }})
          </option>
        </select>
      </div>

      <template v-if="selectedItem != null">
        <div class="lib-item-details">
          <div class="detail-row">
            <span class="detail-label">File Name:</span>
            <span class="detail-value">{{ selectedItem.getFullName() }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Compressed:</span>
            <span class="detail-value">{{ formatSize(selectedItem.length) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Decompressed:</span>
            <span class="detail-value">{{ formatSize(selectedItem.decompressedLength) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Compression Ratio:</span>
            <span class="detail-value">{{ getCompressionRatio(selectedItem) }}%</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Checksum Valid:</span>
            <span class="detail-value" :class="{ valid: selectedItem.checkChecksum(), invalid: !selectedItem.checkChecksum() }">
              {{ selectedItem.checkChecksum() ? 'Yes' : 'No' }}
            </span>
          </div>
        </div>

        <div class="hex-section">
          <div class="section-header">Content Preview</div>
          <hex-viewer :value="selectedItemReader ?? undefined" />
        </div>
      </template>

      <div v-else class="empty-state">
        Select a LIB file and item to view its contents
      </div>
    </div>
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

const libContent = ref<LibFileItem[]>([]);
const selectedItem = ref<LibFileItem | null>(null);
const selectedItemReader = shallowRef<BinaryReader | null>(null);

function onFileSelect(file: IFileSource) {
    void load(file);
}

function onSelectItem() {
    if (!selectedItem.value) {
        selectedItemReader.value = null;
        return;
    }

    selectedItemReader.value = selectedItem.value.getReader();
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getCompressionRatio(item: { length: number; decompressedLength: number }): string {
    if (item.decompressedLength === 0) return '0';
    const ratio = ((1 - item.length / item.decompressedLength) * 100);
    return ratio.toFixed(1);
}

async function load(file: IFileSource) {
    const content = await file.readBinary();
    const libReader = new LibFileReader(content);

    libContent.value = fillLibList(libReader);

    // Auto-select first item
    if (libContent.value.length > 0) {
        selectedItem.value = libContent.value[0];
        onSelectItem();
    }
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

<style src="@/styles/file-viewer.css"></style>

<style scoped>
.lib-item-details {
  background: #0d0a05;
  border: 1px solid #3a2a10;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
}

.detail-row {
  display: flex;
  padding: 4px 0;
  border-bottom: 1px solid #2a1a08;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  color: #8a7040;
  width: 140px;
  flex-shrink: 0;
}

.detail-value {
  color: #c8a96e;
  font-family: monospace;
}

.detail-value.valid {
  color: #4a8030;
}

.detail-value.invalid {
  color: #a04030;
}

.hex-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.section-header {
  font-size: 11px;
  color: #8a7040;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  color: #5a4a30;
  font-style: italic;
}
</style>
