/**
 * Per-frame audio update: places the sound listener at the center of the screen
 * and lets WorldSounds / AmbientSounds trigger sounds near the camera.
 */

import type { Game } from '@/game/game';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { Renderer } from '@/game/renderer/renderer';
import type { FrameCountLookup, SoundListener } from '@/game/audio';
import { screenToTile } from '@/game/systems/coordinate-system';

/** Smallest audible radius in tiles (e.g. when zoomed far in or near the map edge). */
const MIN_RADIUS = 12;
/** Hear a bit beyond the visible area so sounds don't pop in exactly at the edge. */
const RADIUS_MARGIN = 1.1;

function tileAt(g: Game, renderer: Renderer, screenX: number, screenY: number) {
    const canvas = renderer.canvas;
    return screenToTile({
        screenX,
        screenY,
        canvasWidth: canvas.clientWidth,
        canvasHeight: canvas.clientHeight,
        zoom: renderer.viewPoint.zoom,
        viewPointX: renderer.viewPoint.x,
        viewPointY: renderer.viewPoint.y,
        mapWidth: g.terrain.mapSize.width,
        mapHeight: g.terrain.mapSize.height,
        groundHeight: g.terrain.groundHeight,
    });
}

function computeListener(g: Game, renderer: Renderer): SoundListener | null {
    const { clientWidth: w, clientHeight: h } = renderer.canvas;
    const center = tileAt(g, renderer, w / 2, h / 2);
    if (!center) {
        return null;
    }
    const corner = tileAt(g, renderer, 0, 0);
    const halfDiagonal = corner
        ? Math.hypot(corner.x - corner.y * 0.5 - (center.x - center.y * 0.5), corner.y - center.y)
        : 0;
    return { x: center.x, y: center.y, radius: Math.max(MIN_RADIUS, halfDiagonal * RADIUS_MARGIN) };
}

function createFrameCountLookup(er: EntityRenderer | null): FrameCountLookup {
    const provider = er?.spriteManager?.asAnimationProvider();
    return (entity, animation) => {
        const directions = provider
            ?.getAnimationData(entity.type, entity.subType, entity.race)
            ?.sequences.get(animation.sequenceKey);
        const sequence = directions?.get(animation.direction) ?? directions?.values().next().value;
        // eslint-disable-next-line no-restricted-syntax -- sprites may not be loaded yet; null means "unknown frame count"
        return sequence?.frames.length ?? null;
    };
}

export function updateWorldSounds(g: Game, er: EntityRenderer | null, renderer: Renderer): void {
    const listener = computeListener(g, renderer);
    if (!listener) {
        return;
    }
    g.soundManager.updateListener(listener.x - listener.y * 0.5, listener.y);
    const now = performance.now();
    g.worldSounds.update(listener, now, createFrameCountLookup(er));
    g.ambientSounds.update(listener, now);
}
