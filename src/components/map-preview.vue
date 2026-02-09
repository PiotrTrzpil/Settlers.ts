<template>
  <div class="map-preview">
    <canvas
      ref="canvas"
      class="preview-canvas"
      @mousemove="onMouseMove"
      @mouseleave="hoveredCoord = null"
    />
    <div v-if="hoveredCoord" class="coord-tooltip">
      {{ hoveredCoord.x }}, {{ hoveredCoord.y }}
    </div>
    <div v-if="!hasPreviewData" class="no-preview">
      No preview data available
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, useTemplateRef } from 'vue';
import type { IMapLoader } from '@/resources/map/imap-loader';
import { getGroundTypeColor } from '@/resources/map/s4-types';

const props = defineProps<{
    mapLoader: IMapLoader | null;
}>();

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const hoveredCoord = ref<{ x: number; y: number } | null>(null);
const hasPreviewData = ref(false);

function renderPreview() {
    const canvasEl = canvas.value;
    if (!canvasEl || !props.mapLoader) return;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    try {
        const landscape = props.mapLoader.landscape;
        if (!landscape) {
            hasPreviewData.value = false;
            return;
        }

        const groundData = landscape.getGroundType();
        if (!groundData || groundData.length === 0) {
            hasPreviewData.value = false;
            return;
        }

        const mapSize = props.mapLoader.mapSize;
        const width = mapSize?.width ?? 256;
        const height = mapSize?.height ?? 256;

        // Set canvas size with max limit for performance
        const maxSize = 300;
        const scale = Math.min(maxSize / width, maxSize / height, 1);
        const displayWidth = Math.floor(width * scale);
        const displayHeight = Math.floor(height * scale);

        canvasEl.width = displayWidth;
        canvasEl.height = displayHeight;
        canvasEl.style.width = `${displayWidth}px`;
        canvasEl.style.height = `${displayHeight}px`;

        // Create image data
        const imageData = ctx.createImageData(displayWidth, displayHeight);
        const data = imageData.data;

        // Render the map preview using terrain data
        for (let y = 0; y < displayHeight; y++) {
            for (let x = 0; x < displayWidth; x++) {
                // Map display coordinates to source coordinates
                const srcX = Math.floor(x / scale);
                const srcY = Math.floor(y / scale);
                const srcIdx = srcY * width + srcX;

                const pixelIdx = (y * displayWidth + x) * 4;

                if (srcIdx < groundData.length) {
                    const terrainType = groundData[srcIdx];
                    const [r, g, b] = getGroundTypeColor(terrainType);
                    data[pixelIdx] = r;
                    data[pixelIdx + 1] = g;
                    data[pixelIdx + 2] = b;
                    data[pixelIdx + 3] = 255;
                } else {
                    // Out of bounds - dark
                    data[pixelIdx] = 20;
                    data[pixelIdx + 1] = 15;
                    data[pixelIdx + 2] = 10;
                    data[pixelIdx + 3] = 255;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        hasPreviewData.value = true;
    } catch (e) {
        console.error('Failed to render map preview:', e);
        hasPreviewData.value = false;
    }
}

function onMouseMove(event: MouseEvent) {
    const canvasEl = canvas.value;
    if (!canvasEl || !props.mapLoader?.mapSize) return;

    const rect = canvasEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const scaleX = props.mapLoader.mapSize.width / canvasEl.width;
    const scaleY = props.mapLoader.mapSize.height / canvasEl.height;

    hoveredCoord.value = {
        x: Math.floor(x * scaleX),
        y: Math.floor(y * scaleY),
    };
}

onMounted(() => {
    renderPreview();
});

watch(() => props.mapLoader, () => {
    renderPreview();
});
</script>

<style scoped>
.map-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0a05;
  border-radius: 4px;
  padding: 8px;
  min-height: 100px;
}

.preview-canvas {
  border: 1px solid #3a2810;
  border-radius: 2px;
  cursor: crosshair;
  image-rendering: pixelated;
}

.coord-tooltip {
  position: absolute;
  bottom: 4px;
  right: 4px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.8);
  color: #c8a96e;
  font-size: 10px;
  font-family: 'Courier New', monospace;
  border-radius: 2px;
}

.no-preview {
  color: #6a5030;
  font-size: 12px;
  text-align: center;
}
</style>
