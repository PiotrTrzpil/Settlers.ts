<template>
    <div class="map-preview">
        <canvas ref="canvas" class="preview-canvas" @mousemove="onMouseMove" @mouseleave="hoveredCoord = null" />
        <div v-if="hoveredCoord" class="coord-tooltip">{{ hoveredCoord.x }}, {{ hoveredCoord.y }}</div>
        <div v-if="!hasPreviewData" class="no-preview">No preview data available</div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, useTemplateRef } from 'vue';
import type { IMapLoader } from '@/resources/map/imap-loader';
import { getGroundTypeColor } from '@/resources/map/s4-types';

const PLAYER_COLORS: [number, number, number][] = [
    [200, 50, 50],
    [50, 80, 200],
    [50, 180, 50],
    [220, 200, 50],
    [160, 60, 180],
    [220, 140, 40],
    [50, 190, 200],
    [210, 210, 210],
];

const props = withDefaults(
    defineProps<{
        mapLoader: IMapLoader | null;
        maxSize?: number;
    }>(),
    { maxSize: 300 }
);

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const hoveredCoord = ref<{ x: number; y: number } | null>(null);
const hasPreviewData = ref(false);

function renderTerrainPixels(
    data: Uint8ClampedArray,
    groundData: Uint8Array,
    displayWidth: number,
    displayHeight: number,
    mapWidth: number,
    scale: number
): void {
    for (let y = 0; y < displayHeight; y++) {
        for (let x = 0; x < displayWidth; x++) {
            const srcIdx = Math.floor(y / scale) * mapWidth + Math.floor(x / scale);
            const pixelIdx = (y * displayWidth + x) * 4;

            if (srcIdx < groundData.length) {
                const [r, g, b] = getGroundTypeColor(groundData[srcIdx]!);
                data[pixelIdx] = r;
                data[pixelIdx + 1] = g;
                data[pixelIdx + 2] = b;
            } else {
                data[pixelIdx] = 20;
                data[pixelIdx + 1] = 15;
                data[pixelIdx + 2] = 10;
            }
            data[pixelIdx + 3] = 255;
        }
    }
}

function renderPlayerPositions(ctx: CanvasRenderingContext2D, mapLoader: IMapLoader, scale: number): void {
    const players = mapLoader.entityData?.players;
    if (!players) {
        return;
    }

    for (const player of players) {
        if (player.startX == null || player.startY == null) {
            continue;
        }

        const px = Math.floor(player.startX * scale);
        const py = Math.floor(player.startY * scale);
        const color = PLAYER_COLORS[(player.playerIndex - 1) % PLAYER_COLORS.length]!;
        const radius = Math.max(4, Math.round(6 * scale));

        // Dark outline
        ctx.beginPath();
        ctx.arc(px, py, radius + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();

        // Colored circle
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        ctx.fill();

        // Player number
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(8, Math.round(10 * scale))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(player.playerIndex), px, py);
    }
}

function renderPreview() {
    const canvasEl = canvas.value;
    if (!canvasEl || !props.mapLoader) {
        return;
    }

    const ctx = canvasEl.getContext('2d');
    if (!ctx) {
        return;
    }

    try {
        const groundData = props.mapLoader.landscape.getGroundType();
        if (groundData.length === 0) {
            hasPreviewData.value = false;
            return;
        }

        const { width, height } = props.mapLoader.mapSize;
        const maxSize = props.maxSize;
        const scale = Math.min(maxSize / width, maxSize / height, 1);
        const displayWidth = Math.floor(width * scale);
        const displayHeight = Math.floor(height * scale);

        canvasEl.width = displayWidth;
        canvasEl.height = displayHeight;
        canvasEl.style.width = `${displayWidth}px`;
        canvasEl.style.height = `${displayHeight}px`;

        const imageData = ctx.createImageData(displayWidth, displayHeight);
        renderTerrainPixels(imageData.data, groundData, displayWidth, displayHeight, width, scale);
        ctx.putImageData(imageData, 0, 0);

        renderPlayerPositions(ctx, props.mapLoader, scale);

        hasPreviewData.value = true;
    } catch (e) {
        console.error('Failed to render map preview:', e);
        hasPreviewData.value = false;
    }
}

function onMouseMove(event: MouseEvent) {
    const canvasEl = canvas.value;
    if (!canvasEl || !props.mapLoader?.mapSize) {
        return;
    }

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

watch(
    () => props.mapLoader,
    () => {
        renderPreview();
    }
);
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
