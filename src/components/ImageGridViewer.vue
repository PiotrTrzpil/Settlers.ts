<template>
    <VirtualGrid v-if="items.length > 0" :items="items" :min-column-width="220" :row-height="280" @visible="onVisible">
        <template #default="{ item: img, index }">
            <div class="grid-item" :class="{ selected: selectedItem === img }" @click="$emit('select', img, index)">
                <canvas
                    :ref="el => setCanvasRef(el as HTMLCanvasElement, index)"
                    :width="Math.min(img.width, 200)"
                    :height="Math.min(img.height, 200)"
                    class="grid-canvas"
                />
                <div class="grid-label">#{{ index }} ({{ img.width }}x{{ img.height }})</div>
                <slot :img="img" :index="index" />
            </div>
        </template>
    </VirtualGrid>
</template>

<script setup lang="ts">
import type { IGfxImage } from '@/resources/gfx/igfx-image';
import VirtualGrid from './VirtualGrid.vue';

defineProps<{
    items: IGfxImage[];
    selectedItem: IGfxImage | null;
    setCanvasRef: (el: HTMLCanvasElement | null, index: number) => void;
}>();

const emit = defineEmits<{
    (e: 'select', img: IGfxImage, index: number): void;
    (e: 'visible', startIndex: number, endIndex: number): void;
}>();

function onVisible(startIndex: number, endIndex: number) {
    emit('visible', startIndex, endIndex);
}
</script>

<style src="@/styles/file-viewer.css"></style>
