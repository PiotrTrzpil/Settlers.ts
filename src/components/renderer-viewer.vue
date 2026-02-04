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

const props = defineProps<{
    game: Game | null;
    debugGrid: boolean;
}>();

const emit = defineEmits<{
    (e: 'tileClick', tile: { x: number; y: number }): void;
}>();

const cav = useTemplateRef<HTMLCanvasElement>('cav');

useRenderer({
    canvas: cav,
    getGame: () => props.game,
    getDebugGrid: () => props.debugGrid,
    onTileClick: (tile) => emit('tileClick', tile)
});
</script>

<style scoped>
.cav {
  margin: 3px;
  border: 1px solid blue;
}
</style>
