<template>
    <div class="renderer-container">
        <canvas height="800" width="800" ref="cav" class="cav" />
        <canvas ref="overlayCanvas" class="overlay-canvas" />
        <!-- Selection box overlay for drag selection -->
        <div v-if="selectionBox" class="selection-box" :style="selectionBoxStyle" />
        <!-- Transient hint near cursor (e.g. "No garrison slot available") -->
        <div
            v-if="hintMessage"
            class="cursor-hint"
            :style="{ left: hintMessage.x + 'px', top: hintMessage.y - 40 + 'px' }"
        >
            {{ hintMessage.text }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { useTemplateRef, computed, watchEffect, onUnmounted } from 'vue';
import { Game } from '@/game/game';
import { useRenderer } from './use-renderer';
import { Race } from '@/game/renderer/sprite-metadata';
import { LayerVisibility, DEFAULT_LAYER_VISIBILITY } from '@/game/renderer/layer-visibility';
import { MapObjectType } from '@/game/types/map-object-types';

const props = defineProps<{
    game: Game | null;
    layerVisibility?: LayerVisibility;
    initialCamera?: { x: number; y: number; zoom: number } | null;
}>();

const emit = defineEmits<{
    (e: 'tileClick', tile: { x: number; y: number }): void;
}>();

const cav = useTemplateRef<HTMLCanvasElement>('cav');
const overlayCanvas = useTemplateRef<HTMLCanvasElement>('overlayCanvas');

const { setRace, getRace, getInputManager, getCamera, centerOnPlayerStart, getDecoLabels, selectionBox, hintMessage } =
    useRenderer({
        canvas: cav,
        getGame: () => props.game,
        getLayerVisibility: () => props.layerVisibility ?? DEFAULT_LAYER_VISIBILITY,
        onTileClick: tile => emit('tileClick', tile),
        // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
        getInitialCamera: () => props.initialCamera ?? null,
    });

// Draw debug decoration labels on the 2D overlay canvas
let overlayRafId = 0;
function drawOverlayLabels(): void {
    overlayRafId = requestAnimationFrame(drawOverlayLabels);

    const canvas = overlayCanvas.value;
    const glCanvas = cav.value;
    if (!canvas || !glCanvas) {
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = glCanvas.clientWidth;
    const h = glCanvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const labels = getDecoLabels();
    if (labels.length === 0) {
        return;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    // Account for DPR: screen positions from WebGL are in physical pixels
    const invDpr = 1 / dpr;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.lineJoin = 'round';
    for (const label of labels) {
        const x = label.screenX * invDpr;
        const y = label.screenY * invDpr;
        const text = label.name ?? String(label.type);
        // Draw main label (number or name)
        ctx.font = 'bold 13px monospace';
        ctx.textBaseline = 'bottom';
        ctx.strokeText(text, x, y - 4);
        ctx.fillStyle = label.name ? '#ff6666' : `hsl(${label.hue}, 90%, 65%)`;
        ctx.fillText(text, x, y - 4);
        // Draw enum name below the main label
        const enumName = MapObjectType[label.type];
        if (enumName) {
            ctx.font = '9px monospace';
            ctx.textBaseline = 'top';
            ctx.strokeText(enumName, x, y - 2);
            ctx.fillText(enumName, x, y - 2);
        }
    }
    ctx.restore();
}

watchEffect(() => {
    if (cav.value) {
        drawOverlayLabels();
    }
});

onUnmounted(() => {
    if (overlayRafId) {
        cancelAnimationFrame(overlayRafId);
    }
});

// Compute selection box style from screen coordinates
const selectionBoxStyle = computed(() => {
    const box = selectionBox.value;
    if (!box) {
        return {};
    }

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

// Expose race switching, input manager, and camera for parent components
defineExpose({ setRace, getRace, getInputManager, getCamera, centerOnPlayerStart, Race });
</script>

<style scoped>
.renderer-container {
    position: relative;
    display: inline-block;
}

.cav {
    display: block;
}

.overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
}

.selection-box {
    position: absolute;
    pointer-events: none;
    border: 2px solid rgba(255, 255, 0, 0.9);
    background: rgba(255, 255, 0, 0.15);
    box-shadow: 0 0 4px rgba(255, 255, 0, 0.5);
}

.cursor-hint {
    position: absolute;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-size: 13px;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
    transform: translateX(-50%);
    animation: cursor-hint-fade 2.5s ease-in forwards;
}

@keyframes cursor-hint-fade {
    0% {
        opacity: 1;
    }
    60% {
        opacity: 1;
    }
    100% {
        opacity: 0;
    }
}
</style>
