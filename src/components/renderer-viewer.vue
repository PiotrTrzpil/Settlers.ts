<template>
    <canvas
      height="800"
      width="800"
      ref="cav"
      class="cav"
    />
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue';
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

const { setRace, getRace } = useRenderer({
    canvas: cav,
    getGame: () => props.game,
    getDebugGrid: () => props.debugGrid,
    getShowTerritoryBorders: () => props.showTerritoryBorders,
    getLayerVisibility: () => props.layerVisibility ?? DEFAULT_LAYER_VISIBILITY,
    onTileClick: (tile) => emit('tileClick', tile)
});

// Expose race switching for parent components
defineExpose({ setRace, getRace, Race });
</script>

<style scoped>
.cav {
  display: block;
}
</style>
