<template>
    <div class="renderer-container">
        <canvas
          height="800"
          width="800"
          ref="cav"
          class="cav"
        />
        <!-- Selection box overlay for drag selection -->
        <div
            v-if="selectionBox"
            class="selection-box"
            :style="selectionBoxStyle"
        />
    </div>
</template>

<script setup lang="ts">
import { useTemplateRef, computed } from 'vue';
import { Game } from '@/game/game';
import { useRenderer } from './use-renderer';
import { Race } from '@/game/renderer/sprite-metadata';
import { LayerVisibility, DEFAULT_LAYER_VISIBILITY } from '@/game/renderer/layer-visibility';

const props = defineProps<{
    game: Game | null;
    debugGrid: boolean;
    showTerritoryBorders: boolean;
    layerVisibility?: LayerVisibility;
}>();

const emit = defineEmits<{
    (e: 'tileClick', tile: { x: number; y: number }): void;
}>();

const cav = useTemplateRef<HTMLCanvasElement>('cav');

const { setRace, getRace, getInputManager, selectionBox } = useRenderer({
    canvas: cav,
    getGame: () => props.game,
    getDebugGrid: () => props.debugGrid,
    getShowTerritoryBorders: () => props.showTerritoryBorders,
    getLayerVisibility: () => props.layerVisibility ?? DEFAULT_LAYER_VISIBILITY,
    onTileClick: (tile) => emit('tileClick', tile)
});

// Compute selection box style from screen coordinates
const selectionBoxStyle = computed(() => {
    const box = selectionBox.value;
    if (!box) return {};

    const left = Math.min(box.startScreenX, box.endScreenX);
    const top = Math.min(box.startScreenY, box.endScreenY);
    const width = Math.abs(box.endScreenX - box.startScreenX);
    const height = Math.abs(box.endScreenY - box.startScreenY);

    return {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
    };
});

// Expose race switching and input manager for parent components
defineExpose({ setRace, getRace, getInputManager, Race });
</script>

<style scoped>
.renderer-container {
    position: relative;
    display: inline-block;
}

.cav {
    display: block;
}

.selection-box {
    position: absolute;
    pointer-events: none;
    border: 2px solid rgba(255, 255, 0, 0.9);
    background: rgba(255, 255, 0, 0.15);
    box-shadow: 0 0 4px rgba(255, 255, 0, 0.5);
}
</style>
