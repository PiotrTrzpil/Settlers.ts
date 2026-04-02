<template>
    <div class="map-view-root">
        <!-- Game UI — only rendered when game is loaded (game is guaranteed non-null inside) -->
        <GameMapView
            v-if="game"
            :key="gameGeneration"
            :game="game"
            :fileManager="fileManager"
            :staleSnapshotWarning="staleSnapshotWarning"
            @fileSelect="onFileSelect"
            @dismissStaleSnapshot="dismissStaleSnapshot"
        />

        <!-- Fallback when no game loaded -->
        <div v-if="!game" class="no-game-fallback">
            <div class="info-bar">
                <div class="map-selector">
                    <span class="info-label">Map:</span>
                    <file-browser
                        :fileManager="fileManager"
                        @select="onFileSelect"
                        filter=".map"
                        storageKey="viewer_map_file"
                        class="browser"
                    />
                </div>
            </div>
            <renderer-viewer :game="null" :layerVisibility="fallbackLayerVisibility" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { useMapView } from './use-map-view';
import { loadLayerVisibility } from '@/game/renderer/layer-visibility';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';
import GameMapView from './GameMapView.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const { game, gameGeneration, onFileSelect, staleSnapshotWarning, dismissStaleSnapshot } = useMapView(
    () => props.fileManager
);

const { fileManager } = props;

// Fallback layer visibility for the no-game renderer (loaded from localStorage)
const fallbackLayerVisibility = reactive(loadLayerVisibility());
</script>

<style scoped src="./map-view.css"></style>
