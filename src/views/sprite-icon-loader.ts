/**
 * CPU-side sprite icon loading for UI panels.
 * Reads sprites directly from GFX files (like the JIL viewer),
 * completely separate from the GPU renderer pipeline.
 */

import { SpriteLoader, type LoadedGfxFileSet } from '@/game/renderer/sprite-loader';
import {
    GFX_FILE_NUMBERS,
    BUILDING_JOB_INDICES,
    RESOURCE_JOB_INDICES,
    UNIT_BASE_JOB_INDICES,
    SETTLER_FILE_NUMBERS,
} from '@/game/renderer/sprite-metadata';
import { Race, RACE_GFX_FILE } from '@/game/core/race';
import { BuildingType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { FileManager } from '@/utilities/file-manager';

// ============================================================
// Image utilities
// ============================================================

/** Find the bounding box of non-transparent pixels. */
function findOpaqueBounds(
    data: Uint8ClampedArray,
    width: number,
    height: number
): [number, number, number, number] | null {
    let top = height,
        bottom = 0,
        left = width,
        right = 0;
    const len = width * height;
    for (let i = 0; i < len; i++) {
        if (data[i * 4 + 3]! === 0) {
            continue;
        }
        const y = (i / width) | 0;
        const x = i % width;
        if (y < top) {
            top = y;
        }
        if (y > bottom) {
            bottom = y;
        }
        if (x < left) {
            left = x;
        }
        if (x > right) {
            right = x;
        }
    }
    return top <= bottom ? [top, left, bottom, right] : null;
}

/** Trim fully-transparent rows/columns from an ImageData. */
function trimTransparent(src: ImageData): ImageData {
    const bounds = findOpaqueBounds(src.data, src.width, src.height);
    if (!bounds) {
        return src;
    }
    const [top, left, bottom, right] = bounds;
    const tw = right - left + 1;
    const th = bottom - top + 1;
    const out = new ImageData(tw, th);
    for (let y = 0; y < th; y++) {
        const srcOff = ((top + y) * src.width + left) * 4;
        out.data.set(src.data.subarray(srcOff, srcOff + tw * 4), y * tw * 4);
    }
    return out;
}

/** Scale an ImageData to a target size, preserving pixelated look via 2x integer upscale first. */
function scaleImageData(src: ImageData, targetW: number, targetH: number): string | null {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = src.width;
    srcCanvas.height = src.height;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) {
        return null;
    }
    srcCtx.putImageData(src, 0, 0);

    const dst = document.createElement('canvas');
    dst.width = targetW;
    dst.height = targetH;
    const dstCtx = dst.getContext('2d');
    if (!dstCtx) {
        return null;
    }
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
    return dst.toDataURL();
}

// ============================================================
// Sprite extraction helpers
// ============================================================

/**
 * Rows trimmed from every sprite to match the GPU renderer pipeline
 * (removes artifact lines from original game assets).
 */
const SPRITE_TRIM_TOP = 5;
const SPRITE_TRIM_BOTTOM = 3;

/** Crop fixed pixel rows from top and bottom of an ImageData. */
function cropRows(src: ImageData, top: number, bottom: number): ImageData {
    const newH = src.height - top - bottom;
    if (newH <= 0 || newH === src.height) {
        return src;
    }
    const out = new ImageData(src.width, newH);
    for (let y = 0; y < newH; y++) {
        const srcOff = (y + top) * src.width * 4;
        out.data.set(src.data.subarray(srcOff, srcOff + src.width * 4), y * src.width * 4);
    }
    return out;
}

/** Extract a sprite by JIL job (direction + frame 0) as trimmed ImageData. */
function extractJobSprite(fileSet: LoadedGfxFileSet, jobIndex: number, direction: number): ImageData | null {
    const jobItem = fileSet.jilReader!.getItem(jobIndex);
    if (!jobItem) {
        return null;
    }
    const dirItems = fileSet.dilReader!.getItems(jobItem.offset, jobItem.length);
    if (direction >= dirItems.length) {
        return null;
    }
    const frameItems = fileSet.gilReader.getItems(dirItems[direction]!.offset, dirItems[direction]!.length);
    if (frameItems.length === 0) {
        return null;
    }
    const image = fileSet.gfxReader.getImage(frameItems[0]!.index);
    if (!image || image.width === 0 || image.height === 0) {
        return null;
    }
    return trimTransparent(cropRows(image.getImageData(), SPRITE_TRIM_TOP, SPRITE_TRIM_BOTTOM));
}

// ============================================================
// Public loaders
// ============================================================

export interface IconEntry {
    url: string;
    /** Display size in CSS pixels (the data URL is rendered at 2x for crispness) */
    size: number;
}

/** Display-size range for building icons (data URLs are 2x for retina crispness) */
const ICON_MIN_PX = 28;
const ICON_MAX_PX = 56;
const RENDER_SCALE = 2;

/** Load building icons from actual building sprites (direction 1 = completed). */
export async function loadBuildingIcons(
    fileManager: FileManager,
    race: Race,
    buildings: { type: BuildingType }[]
): Promise<Partial<Record<BuildingType, IconEntry>>> {
    const loader = new SpriteLoader(fileManager);
    const fileSet = await loader.loadFileSet(String(RACE_GFX_FILE[race]));
    if (!fileSet?.jilReader || !fileSet.dilReader) {
        return {};
    }

    // Collect trimmed sprites and track dimension range
    const sprites: { type: BuildingType; data: ImageData; dim: number }[] = [];
    let minDim = Infinity,
        maxDim = 0;
    for (const b of buildings) {
        const jobIndex = BUILDING_JOB_INDICES[b.type];
        if (jobIndex === undefined) {
            continue;
        }
        const data = extractJobSprite(fileSet, jobIndex, 1);
        if (!data) {
            continue;
        }
        const dim = Math.max(data.width, data.height);
        if (dim > maxDim) {
            maxDim = dim;
        }
        if (dim < minDim) {
            minDim = dim;
        }
        sprites.push({ type: b.type, data, dim });
    }
    if (maxDim === 0) {
        return {};
    }

    // Map sprite dimensions linearly to ICON_MIN..ICON_MAX
    const dimRange = maxDim - minDim || 1;
    const icons: Partial<Record<BuildingType, IconEntry>> = {};
    for (const { type, data, dim } of sprites) {
        const t = (dim - minDim) / dimRange;
        const displaySize = Math.round(ICON_MIN_PX + t * (ICON_MAX_PX - ICON_MIN_PX));
        const scale = (displaySize * RENDER_SCALE) / dim;
        const url = scaleImageData(data, Math.round(data.width * scale), Math.round(data.height * scale));
        if (url) {
            icons[type] = { url, size: displaySize };
        }
    }
    return icons;
}

/** Resolve the JIL job index for a unit type. */
function getUnitJobIndex(unitType: UnitType): number | undefined {
    return UNIT_BASE_JOB_INDICES[unitType];
}

/** Load unit icons from settler sprite files (direction 0, frame 0). */
export async function loadUnitIcons(
    fileManager: FileManager,
    race: Race,
    units: { id: string; type: UnitType }[]
): Promise<Record<string, IconEntry>> {
    const loader = new SpriteLoader(fileManager);
    const fileSet = await loader.loadFileSet(String(SETTLER_FILE_NUMBERS[race]));
    if (!fileSet?.jilReader || !fileSet.dilReader) {
        return {};
    }

    const sprites: { id: string; data: ImageData; dim: number }[] = [];
    let minDim = Infinity,
        maxDim = 0;
    for (const u of units) {
        const jobIndex = getUnitJobIndex(u.type);
        if (jobIndex === undefined || jobIndex < 0) {
            continue;
        }
        const data = extractJobSprite(fileSet, jobIndex, 0);
        if (!data) {
            continue;
        }
        const dim = Math.max(data.width, data.height);
        if (dim > maxDim) {
            maxDim = dim;
        }
        if (dim < minDim) {
            minDim = dim;
        }
        sprites.push({ id: u.id, data, dim });
    }
    if (maxDim === 0) {
        return {};
    }

    const dimRange = maxDim - minDim || 1;
    const icons: Record<string, IconEntry> = {};
    for (const { id, data, dim } of sprites) {
        const t = (dim - minDim) / dimRange;
        const displaySize = Math.round(ICON_MIN_PX + t * (ICON_MAX_PX - ICON_MIN_PX));
        const scale = (displaySize * RENDER_SCALE) / dim;
        const url = scaleImageData(data, Math.round(data.width * scale), Math.round(data.height * scale));
        if (url) {
            icons[id] = { url, size: displaySize };
        }
    }
    return icons;
}

/** Load resource icons from GFX file 3 (direction 0, frame 0). */
export async function loadResourceIcons(
    fileManager: FileManager,
    resources: { type: EMaterialType }[]
): Promise<Record<string, string>> {
    const loader = new SpriteLoader(fileManager);
    const fileSet = await loader.loadFileSet(String(GFX_FILE_NUMBERS.RESOURCES));
    if (!fileSet?.jilReader || !fileSet.dilReader) {
        return {};
    }

    const icons: Record<string, string> = {};
    for (const r of resources) {
        const jobIndex = RESOURCE_JOB_INDICES[r.type];
        if (jobIndex === undefined) {
            continue;
        }
        const data = extractJobSprite(fileSet, jobIndex, 0);
        if (!data) {
            continue;
        }
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            continue;
        }
        ctx.putImageData(data, 0, 0);
        icons[r.type] = canvas.toDataURL();
    }
    return icons;
}
