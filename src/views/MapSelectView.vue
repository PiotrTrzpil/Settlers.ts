<template>
    <div class="map-select">
        <div class="map-select-card">
            <div class="map-select-header">
                <h1 class="map-select-title">Select Map</h1>
                <p class="map-select-subtitle">Choose a map to play</p>
            </div>

            <div class="map-select-body">
                <div class="map-list-area">
                    <div class="map-list" v-if="mapFiles.length > 0">
                        <button
                            v-for="file in mapFiles"
                            :key="file.path"
                            class="map-item"
                            :class="{ selected: selectedFile?.path === file.path }"
                            @click="selectMap(file)"
                        >
                            {{ file.name }}
                        </button>
                    </div>
                    <div v-else class="no-maps">No map files found</div>
                </div>

                <div class="map-preview-area">
                    <map-preview :mapLoader="previewLoader" />
                    <div v-if="mapSize" class="map-details">
                        <span class="map-detail">Size: {{ mapSize.width }} x {{ mapSize.height }}</span>
                    </div>
                </div>
            </div>

            <div class="map-select-actions">
                <button class="back-btn" @click="$router.push('/')">Back</button>
                <button class="play-btn" :disabled="!selectedFile" @click="startGame">&#9654; Play</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { MapLoader } from '@/resources/map/map-loader';
import type { IMapLoader } from '@/resources/map/imap-loader';
import MapPreview from '@/components/map-preview.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const router = useRouter();

const mapFiles = ref<IFileSource[]>([]);
const selectedFile = ref<IFileSource | null>(null);
const previewLoader = ref<IMapLoader | null>(null);
const mapSize = ref<{ width: number; height: number } | null>(null);

function naturalSort(a: IFileSource, b: IFileSource): number {
    return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

onMounted(() => {
    mapFiles.value = props.fileManager.filter('.map').sort(naturalSort);

    // Restore last selection
    const storedPath = localStorage.getItem('game_mode_map');
    if (storedPath) {
        const stored = mapFiles.value.find(f => f.path === storedPath);
        if (stored) {
            selectMap(stored);
        }
    }
});

async function selectMap(file: IFileSource): Promise<void> {
    selectedFile.value = file;
    localStorage.setItem('game_mode_map', file.path);

    try {
        const fileData = await file.readBinary();
        const loader = MapLoader.getLoader(fileData);
        previewLoader.value = loader;
        if (loader) {
            const size = loader.mapSize;
            mapSize.value = { width: size.width, height: size.height };
        } else {
            mapSize.value = null;
        }
    } catch {
        previewLoader.value = null;
        mapSize.value = null;
    }
}

function startGame(): void {
    if (!selectedFile.value) {
        return;
    }
    router.push('/game');
}
</script>

<style scoped>
.map-select {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 24px;
    background: var(--bg-darkest);
}

.map-select-card {
    width: 100%;
    max-width: 680px;
    background: var(--bg-dark);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    overflow: hidden;
}

.map-select-header {
    padding: 20px 28px 16px;
    border-bottom: 1px solid var(--border);
    text-align: center;
}

.map-select-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-emphasis);
    letter-spacing: 1px;
    text-transform: uppercase;
}

.map-select-subtitle {
    margin: 4px 0 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.map-select-body {
    display: flex;
    gap: 16px;
    padding: 20px 28px;
    min-height: 300px;
}

.map-list-area {
    flex: 1;
    min-width: 0;
}

.map-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 340px;
    overflow-y: auto;
    padding-right: 4px;
}

.map-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-darkest);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
    transition:
        background 0.12s,
        border-color 0.12s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.map-item:hover {
    background: var(--bg-mid);
    border-color: var(--border-hover);
}

.map-item.selected {
    background: var(--bg-raised);
    border-color: var(--border-active);
    color: var(--text-emphasis);
}

.no-maps {
    color: var(--text-dim);
    font-size: 0.85rem;
    text-align: center;
    padding: 40px 0;
}

.map-preview-area {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.map-details {
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.map-detail {
    padding: 2px 8px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 3px;
}

.map-select-actions {
    display: flex;
    gap: 12px;
    padding: 16px 28px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
}

.play-btn {
    font-size: 1rem;
    font-weight: 600;
    padding: 10px 40px;
    cursor: pointer;
    background: #3a6e28;
    color: #e8f4e0;
    border: 1px solid #4a8e34;
    border-radius: 6px;
    letter-spacing: 1px;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.play-btn:hover:not(:disabled) {
    background: #4a8e34;
    border-color: #5aae44;
}

.play-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.back-btn {
    font-size: 0.9rem;
    padding: 10px 24px;
    cursor: pointer;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-mid);
    border-radius: 6px;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.back-btn:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
}

/* Scrollbar */
.map-list::-webkit-scrollbar {
    width: 6px;
}

.map-list::-webkit-scrollbar-track {
    background: var(--bg-darkest);
}

.map-list::-webkit-scrollbar-thumb {
    background: var(--border-mid);
    border-radius: 3px;
}

.map-list::-webkit-scrollbar-thumb:hover {
    background: var(--border-strong);
}
</style>
