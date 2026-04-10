<template>
    <OverlayPanel label="Map" persistKey="minimap" :defaultOpen="true" minWidth="auto">
        <div class="minimap-container">
            <canvas ref="canvas" class="minimap-canvas" @pointerdown="onPointerDown" @pointermove="onPointerDrag" />
        </div>
    </OverlayPanel>
</template>

<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue';
import type { Game } from '@/game/game';
import { getGroundTypeColor } from '@/resources/map/s4-types';
import OverlayPanel from './OverlayPanel.vue';

/** Minimap RGB colors per player index (0-7). Matches the team color order: red, blue, green, yellow, purple, orange, cyan, white. */
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

/**
 * Parallelogram-shaped game minimap matching the isometric projection.
 *
 * The tile grid maps to a parallelogram with horizontal top/bottom edges:
 *      ___________
 *     /           /
 *    /           /
 *   /___________/
 *
 * From the isometric transform: screenX = tx - ty*0.5, screenY = ty*0.5
 * For a W×H map the bounding box is (W + H/2) wide × H/2 tall (3:1 for square maps).
 */

const MINIMAP_HEIGHT = 110;

const props = defineProps<{
    game: Game;
    getCamera: () => { x: number; y: number; zoom: number; aspect: number } | null;
    navigateToTile: (tileX: number, tileY: number) => void;
}>();

const terrain = () => props.game.terrain;

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
/** Raw terrain pixels (never changes after init). */
let terrainImageData: ImageData | null = null;
/** Terrain + territory composite (rebuilt when territory changes). */
let compositeImageData: ImageData | null = null;
/** Last-seen territory snapshot — compared to detect changes without touching manager callbacks. */
let lastTerritorySnapshot: Uint8Array | null = null;
let minimapWidth = 0;
let rafId = 0;
let isDragging = false;
/** Frame counter — only check territory for changes every N frames. */
let frameCount = 0;
const TERRITORY_CHECK_INTERVAL = 30;

// ─── Coordinate transforms ──────────────────────────────────────────────

// Isometric: screenX = tx - ty*0.5, screenY = ty*0.5
// Bounding box: x ∈ [-H/2, W], y ∈ [0, H/2]
// Normalised to canvas: px = (tx - ty*0.5 + H/2) / (W + H/2) * canvasWidth
//                        py = (ty / H) * canvasHeight

/** Tile coordinates → minimap canvas pixel. */
function tileToMinimap(tx: number, ty: number): { px: number; py: number } {
    const { width: W, height: H } = terrain();
    return {
        px: ((tx - ty * 0.5 + H / 2) / (W + H / 2)) * minimapWidth,
        py: (ty / H) * MINIMAP_HEIGHT,
    };
}

/** Minimap canvas pixel → tile coordinates. */
function minimapToTile(px: number, py: number): { tx: number; ty: number } {
    const { width: W, height: H } = terrain();
    const ty = (py / MINIMAP_HEIGHT) * H;
    const tx = (px / minimapWidth) * (W + H / 2) - H / 2 + ty * 0.5;
    return { tx, ty };
}

// ─── Terrain rendering ──────────────────────────────────────────────────

/** Render the terrain into an ImageData buffer using the isometric parallelogram projection. */
function renderTerrain(): void {
    const canvasEl = canvas.value!;
    const ctx = canvasEl.getContext('2d')!;
    const { width: W, height: H, groundType, terrainAttributes } = terrain();

    // Compute canvas width from the map's isometric bounding box ratio
    minimapWidth = Math.round((MINIMAP_HEIGHT * (W + H / 2)) / (H / 2));
    canvasEl.width = minimapWidth;
    canvasEl.height = MINIMAP_HEIGHT;

    const imageData = ctx.createImageData(minimapWidth, MINIMAP_HEIGHT);
    const data = imageData.data;

    for (let py = 0; py < MINIMAP_HEIGHT; py++) {
        for (let px = 0; px < minimapWidth; px++) {
            // Inverse of the parallelogram projection
            const ty = Math.floor((py / MINIMAP_HEIGHT) * H);
            const tx = Math.floor((px / minimapWidth) * (W + H / 2) - H / 2 + ty * 0.5);

            if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
                const tileIdx = ty * W + tx;
                const idx = (py * minimapWidth + px) * 4;

                const [r, g, b] = getGroundTypeColor(groundType[tileIdx]!);
                // Dark land: bit 6 of terrain attributes — darken terrain color
                const isDark = terrainAttributes !== null && (terrainAttributes[tileIdx]! & 0x40) !== 0;
                const darken = isDark ? 0.6 : 1;
                data[idx] = r * darken;
                data[idx + 1] = g * darken;
                data[idx + 2] = b * darken;
                data[idx + 3] = 255;
            }
        }
    }

    terrainImageData = imageData;
    ctx.putImageData(imageData, 0, 0);
}

// ─── Viewport indicator ─────────────────────────────────────────────────

/**
 * Compute the four screen-corner tile coordinates from camera state.
 * Uses the same projection math as coordinate-system.ts (height=0 approximation).
 */
function getViewportCorners(cam: { x: number; y: number; zoom: number; aspect: number }): { tx: number; ty: number }[] {
    const zoom = 0.1 / cam.zoom; // cam.zoom is zoomValue → shader zoom
    const { aspect } = cam;

    // NDC corners of the screen
    const ndcCorners = [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
    ];

    return ndcCorners.map(([ndcX, ndcY]) => {
        const worldX = ((ndcX! + zoom) * aspect) / zoom;
        const worldY = (zoom - ndcY!) / zoom;
        const instanceY = worldY * 2 - 0.5;
        const instanceX = worldX - 0.25 + instanceY * 0.5;
        return { tx: instanceX + cam.x, ty: instanceY + cam.y };
    });
}

/** Rebuild the terrain + territory composite image from a territory snapshot. */
function rebuildComposite(territoryGrid: Uint8Array): void {
    if (!terrainImageData) {
        return;
    }
    const dst = new Uint8ClampedArray(terrainImageData.data);
    const { width: W, height: H } = terrain();
    const alpha = 0.55;
    const inv = 1 - alpha;

    for (let py = 0; py < MINIMAP_HEIGHT; py++) {
        for (let px = 0; px < minimapWidth; px++) {
            const ty = Math.floor((py / MINIMAP_HEIGHT) * H);
            const tx = Math.floor((px / minimapWidth) * (W + H / 2) - H / 2 + ty * 0.5);
            if (tx < 0 || tx >= W || ty < 0 || ty >= H) {
                continue;
            }
            const owner = territoryGrid[ty * W + tx]!;
            if (owner === 0) {
                continue;
            }
            const color = PLAYER_COLORS[(owner - 1) % PLAYER_COLORS.length]!;
            const idx = (py * minimapWidth + px) * 4;
            dst[idx] = dst[idx]! * inv + color[0] * alpha;
            dst[idx + 1] = dst[idx + 1]! * inv + color[1] * alpha;
            dst[idx + 2] = dst[idx + 2]! * inv + color[2] * alpha;
        }
    }

    compositeImageData = new ImageData(dst, minimapWidth, MINIMAP_HEIGHT);
}

/** Check if territory changed by comparing snapshots. */
function checkTerritoryChanged(): boolean {
    const current = props.game.services.territoryManager.snapshotGrid();
    if (!lastTerritorySnapshot || current.length !== lastTerritorySnapshot.length) {
        lastTerritorySnapshot = current;
        return true;
    }
    // Quick scan — bail on first difference
    for (let i = 0; i < current.length; i++) {
        if (current[i] !== lastTerritorySnapshot[i]) {
            lastTerritorySnapshot = current;
            return true;
        }
    }
    return false;
}

/** Draw the cached composite + viewport indicator. */
function drawFrame(): void {
    const canvasEl = canvas.value;
    if (!canvasEl || !terrainImageData) {
        return;
    }

    // Periodically check for territory changes (not every frame)
    frameCount++;
    if (!compositeImageData || frameCount % TERRITORY_CHECK_INTERVAL === 0) {
        if (checkTerritoryChanged()) {
            rebuildComposite(lastTerritorySnapshot!);
        }
    }

    const ctx = canvasEl.getContext('2d')!;
    ctx.putImageData(compositeImageData!, 0, 0);

    // Viewport indicator
    const cam = props.getCamera();
    if (!cam) {
        return;
    }

    const corners = getViewportCorners(cam);
    const pts = corners.map(c => tileToMinimap(c.tx, c.ty));

    ctx.beginPath();
    ctx.moveTo(pts[0]!.px, pts[0]!.py);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i]!.px, pts[i]!.py);
    }
    ctx.closePath();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
}

function animationLoop(): void {
    drawFrame();
    rafId = requestAnimationFrame(animationLoop);
}

// ─── Click / drag to navigate ───────────────────────────────────────────

function navigateFromEvent(event: PointerEvent): void {
    const canvasEl = canvas.value!;
    const rect = canvasEl.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (minimapWidth / rect.width);
    const py = (event.clientY - rect.top) * (MINIMAP_HEIGHT / rect.height);

    const { tx, ty } = minimapToTile(px, py);
    if (tx >= 0 && tx < terrain().width && ty >= 0 && ty < terrain().height) {
        props.navigateToTile(tx, ty);
    }
}

function onPointerDown(event: PointerEvent): void {
    isDragging = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    navigateFromEvent(event);
}

function onPointerDrag(event: PointerEvent): void {
    if (!isDragging) {
        return;
    }
    navigateFromEvent(event);
}

function onPointerUp(): void {
    isDragging = false;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────

// The canvas lives inside OverlayPanel's v-if slot, so it may not exist at
// onMounted time. Watch the template ref and initialize when it appears.
watch(canvas, canvasEl => {
    if (canvasEl) {
        renderTerrain();
        if (!rafId) {
            rafId = requestAnimationFrame(animationLoop);
            window.addEventListener('pointerup', onPointerUp);
        }
    }
});

onBeforeUnmount(() => {
    if (rafId) {
        cancelAnimationFrame(rafId);
    }
    window.removeEventListener('pointerup', onPointerUp);
});
</script>

<style scoped>
.minimap-container {
    padding: 4px;
    background: #0d0a05;
}

.minimap-canvas {
    display: block;
    cursor: pointer;
    image-rendering: pixelated;
}
</style>
