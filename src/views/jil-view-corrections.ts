/**
 * Frame correction utilities for JIL view — applies cyclic pixel shifts
 * from the auto-generated correction data when previewing sprites.
 */

import { CORRECTIONS_BY_FILE } from '@/game/renderer/sprite-metadata/jil-frame-corrections';
import type { IGfxImage } from '@/resources/gfx/igfx-image';

export interface PixelShift {
    dx: number;
    dy: number;
}

/** Look up the frame correction for a given file/job/direction/frame. */
export function getFrameCorrection(
    fileId: number | null,
    jobIndex: number,
    dirIndex: number,
    frameIndex: number
): PixelShift | undefined {
    if (fileId === null) {
        return undefined;
    }
    const dirCorrections = CORRECTIONS_BY_FILE.get(fileId)?.get(jobIndex);
    if (!dirCorrections) {
        return undefined;
    }
    const dir = dirCorrections.find(d => d.direction === dirIndex);
    return dir?.frames.find(f => f.frame === frameIndex);
}

/** Cyclically shift RGBA pixel data in an ImageData by (dx, dy). */
function cyclicShiftImageData(imageData: ImageData, dx: number, dy: number): void {
    const { width: w, height: h, data } = imageData;
    const tmp = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
        const srcY = (((y - dy) % h) + h) % h;
        for (let x = 0; x < w; x++) {
            const srcX = (((x - dx) % w) + w) % w;
            const dstIdx = (y * w + x) * 4;
            const srcIdx = (srcY * w + srcX) * 4;
            data[dstIdx] = tmp[srcIdx]!;
            data[dstIdx + 1] = tmp[srcIdx + 1]!;
            data[dstIdx + 2] = tmp[srcIdx + 2]!;
            data[dstIdx + 3] = tmp[srcIdx + 3]!;
        }
    }
}

/**
 * Render a GFX image to a canvas, optionally applying a cyclic pixel shift correction.
 * When no correction is given, delegates to the base renderer.
 */
export function renderCorrectedImage(
    img: IGfxImage,
    canvas: HTMLCanvasElement,
    bgColor: string | undefined,
    correction: PixelShift | undefined,
    baseRenderer: (img: IGfxImage, canvas: HTMLCanvasElement, bgColor?: string) => void
): void {
    if (!correction) {
        baseRenderer(img, canvas, bgColor);
        return;
    }

    const imageData = img.getImageData();
    cyclicShiftImageData(imageData, correction.dx, correction.dy);
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, img.width, img.height);
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        tmp.getContext('2d')!.putImageData(imageData, 0, 0);
        ctx.drawImage(tmp, 0, 0);
    } else {
        ctx.putImageData(imageData, 0, 0);
    }
}
