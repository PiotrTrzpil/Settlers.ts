<template>
    <VirtualGrid
        v-if="items.length > 0"
        ref="virtualGridRef"
        :items="items"
        :min-column-width="220"
        :row-height="280"
        @visible="onVisible"
    >
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
import { ref } from 'vue';
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

const virtualGridRef = ref<{ getScrollOffset(): number; setScrollOffset(offset: number): void } | null>(null);

function onVisible(startIndex: number, endIndex: number) {
    emit('visible', startIndex, endIndex);
}

defineExpose({
    getScrollOffset(): number {
        // eslint-disable-next-line no-restricted-syntax -- 0 is correct default when grid is not mounted
        return virtualGridRef.value?.getScrollOffset() ?? 0;
    },
    setScrollOffset(offset: number) {
        virtualGridRef.value?.setScrollOffset(offset);
    },
});
</script>

<style src="@/styles/file-viewer.css"></style>
