<template>
    <div class="map-view-root">
        <GameModeMapView
            v-if="game"
            :key="gameGeneration"
            :game="game"
            :fileManager="fileManager"
            :staleSnapshotWarning="staleSnapshotWarning"
            @dismissStaleSnapshot="dismissStaleSnapshot"
        />

        <div v-if="!game" class="gm-loading">
            <div class="gm-loading-text">Loading map...</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { FileManager } from '@/utilities/file-manager';
import { useMapView } from './use-map-view';

import GameModeMapView from './GameModeMapView.vue';

const props = defineProps<{
    fileManager: FileManager;
}>();

const { game, gameGeneration, onFileSelect, staleSnapshotWarning, dismissStaleSnapshot } = useMapView(
    () => props.fileManager
);

const { fileManager } = props;

// Load map from localStorage selection (set by MapSelectView)
onMounted(() => {
    const mapPath = localStorage.getItem('game_mode_map');
    if (!mapPath) {
        return;
    }
    const files = props.fileManager.filter('.map');
    const file = files.find(f => f.path === mapPath);
    if (file) {
        onFileSelect(file);
    }
});
</script>

<style scoped>
.map-view-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.gm-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    background: var(--bg-darkest);
}

.gm-loading-text {
    font-size: 1.2rem;
    color: var(--text-secondary);
    letter-spacing: 1px;
}
</style>
