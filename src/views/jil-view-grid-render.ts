/**
 * Grid rendering helpers for JIL viewer — renders sprite frames for visible grid items.
 */

import type { IndexFileItem } from '@/resources/gfx/index-file-item';

interface IndexReader {
    getItems(start: number, length?: number): IndexFileItem[];
}

interface GilReader extends IndexReader {
    getImageOffset(index: number): number;
}

interface GfxReader {
    readImage(offset: number, paletteIndex: number): { width: number; height: number };
}

export interface GridRenderContext {
    gfxReader: GfxReader;
    dilReader: IndexReader;
    gilReader: GilReader;
    jilList: IndexFileItem[];
    visibleStart: number;
    visibleEnd: number;
    getCanvas: (key: string) => HTMLCanvasElement | undefined;
    clearCanvas: (c: HTMLCanvasElement) => void;
    renderImage: (gfx: any, canvas: HTMLCanvasElement, correction?: { dx: number; dy: number }) => void;
    lookupCorrection: (jobIndex: number, dirIndex: number, frameIndex: number) => { dx: number; dy: number } | undefined;
}

/** Render a specific global frame for all visible grid items in one direction. */
export function renderGridFrame(ctx: GridRenderContext, direction: number, globalFrame: number): void {
    for (let i = ctx.visibleStart; i < ctx.visibleEnd; i++) {
        const item = ctx.jilList[i];
        if (!item) {
            continue;
        }

        const canvas = ctx.getCanvas(`${item.index}-anim`);
        if (!canvas) {
            continue;
        }

        const dirItems = ctx.dilReader.getItems(item.offset, item.length);
        if (direction >= dirItems.length || dirItems.length === 0) {
            ctx.clearCanvas(canvas);
            continue;
        }

        const frameItems = ctx.gilReader.getItems(dirItems[direction]!.offset, dirItems[direction]!.length);
        if (frameItems.length === 0) {
            ctx.clearCanvas(canvas);
            continue;
        }

        const frameIndex = globalFrame % frameItems.length;
        const offset = ctx.gilReader.getImageOffset(frameItems[frameIndex]!.index);
        const gfx = ctx.gfxReader.readImage(offset, item.index);
        ctx.renderImage(gfx, canvas, ctx.lookupCorrection(item.index, direction, frameIndex));
    }
}

/** Render first frame of all directions for a single job (all-directions static grid mode). */
export function renderJobSprite(ctx: GridRenderContext, item: IndexFileItem): void {
    const dirItems = ctx.dilReader.getItems(item.offset, item.length);
    if (dirItems.length === 0) {
        return;
    }

    const maxDirs = Math.min(8, dirItems.length);
    for (let dirIdx = 0; dirIdx < maxDirs; dirIdx++) {
        const canvas = ctx.getCanvas(`${item.index}-${dirIdx}`);
        if (!canvas) {
            continue;
        }

        const frameItems = ctx.gilReader.getItems(dirItems[dirIdx]!.offset, dirItems[dirIdx]!.length);
        if (frameItems.length === 0) {
            continue;
        }

        const offset = ctx.gilReader.getImageOffset(frameItems[0]!.index);
        const gfx = ctx.gfxReader.readImage(offset, item.index);
        ctx.renderImage(gfx, canvas, ctx.lookupCorrection(item.index, dirIdx, 0));
    }
}
