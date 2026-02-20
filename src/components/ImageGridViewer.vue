<template>
    <div v-if="items.length > 0" class="grid-container">
        <div
            v-for="(img, index) in items"
            :key="img.dataOffset"
            class="grid-item"
            :class="{ selected: selectedItem === img }"
            @click="$emit('select', img, index)"
        >
            <canvas
                :ref="el => setCanvasRef(el as HTMLCanvasElement, index)"
                :width="Math.min(img.width, 200)"
                :height="Math.min(img.height, 200)"
                class="grid-canvas"
            />
            <div class="grid-label">#{{ index }} ({{ img.width }}x{{ img.height }})</div>
            <slot :img="img" :index="index" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { IGfxImage } from '@/resources/gfx/igfx-image';

defineProps<{
    items: IGfxImage[];
    selectedItem: IGfxImage | null;
    setCanvasRef: (el: HTMLCanvasElement | null, index: number) => void;
}>();

defineEmits<{
    (e: 'select', img: IGfxImage, index: number): void;
}>();
</script>

<style src="@/styles/file-viewer.css"></style>
