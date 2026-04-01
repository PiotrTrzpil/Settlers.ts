<template>
    <div class="file-viewer">
        <div class="controls">
            <span class="label">LIB File:</span>
            <file-browser
                :fileManager="fileManager"
                @select="onFileSelect"
                filter=".lib"
                storageKey="viewer_lib_file"
                class="browser"
            />
            <span class="info">{{ libContent.length }} items</span>
        </div>

        <div class="single-view">
            <ItemSelector label="Item">
                <select class="item-select" v-model="selectedItem" @change="onSelectItem">
                    <option v-for="(item, index) of libContent" :key="item.getFullName()" :value="item">
                        #{{ index }} - {{ item.getFullName() }} ({{ formatSize(item.decompressedLength) }})
                    </option>
                </select>
            </ItemSelector>

            <template v-if="selectedItem != null">
                <PropertyList :rows="detailRows" />

                <div class="hex-section">
                    <div class="section-header">Content Preview</div>
                    <hex-viewer :value="selectedItemReader ?? undefined" />
                </div>
            </template>

            <div v-else class="empty-state">Select a LIB file and item to view its contents</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef } from 'vue';
import { LibFileReader } from '@/resources/lib/lib-file-reader';
import { LibFileItem } from '@/resources/lib/lib-file-item';
import { BinaryReader } from '@/resources/file/binary-reader';
import { FileManager, IFileSource } from '@/utilities/file-manager';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';
import ItemSelector from '@/components/ItemSelector.vue';
import PropertyList from '@/components/PropertyList.vue';

defineProps<{
    fileManager: FileManager;
}>();

const libContent = ref<LibFileItem[]>([]);
const selectedItem = ref<LibFileItem | null>(null);
const selectedItemReader = shallowRef<BinaryReader | null>(null);

const detailRows = computed(() => {
    const item = selectedItem.value;
    if (!item) {
        return [];
    }
    const valid = item.checkChecksum();
    return [
        { label: 'File Name', value: item.getFullName() },
        { label: 'Compressed', value: formatSize(item.length) },
        { label: 'Decompressed', value: formatSize(item.decompressedLength) },
        { label: 'Compression Ratio', value: `${getCompressionRatio(item)}%` },
        { label: 'Checksum Valid', value: valid ? 'Yes' : 'No', class: valid ? 'valid' : 'invalid' },
    ];
});

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
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getCompressionRatio(item: { length: number; decompressedLength: number }): string {
    if (item.decompressedLength === 0) {
        return '0';
    }
    const ratio = (1 - item.length / item.decompressedLength) * 100;
    return ratio.toFixed(1);
}

async function load(file: IFileSource) {
    const content = await file.readBinary();
    const libReader = new LibFileReader(content);

    libContent.value = fillLibList(libReader);

    // Auto-select first item
    if (libContent.value.length > 0) {
        // eslint-disable-next-line no-restricted-syntax -- index access returns undefined for missing keys
        selectedItem.value = libContent.value[0] ?? null;
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
.hex-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 200px;
}

.section-header {
    font-size: 11px;
    color: var(--text-secondary);
    text-transform: uppercase;
    margin-bottom: 8px;
}

.empty-state {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1;
    color: var(--text-faint);
    font-style: italic;
}
</style>
