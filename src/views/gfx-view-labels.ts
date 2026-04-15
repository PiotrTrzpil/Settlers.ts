/**
 * Reverse lookup from GIL index to human-readable label for GFX viewer.
 * Only applies to file 5.gfx (MAP_OBJECTS).
 */

import { MAP_OBJECT_SPRITES, HUD_OVERLAY_SPRITES } from '@/game/renderer/sprite-metadata/gil-indices';

type SpriteEntry = number | { start: number; count: number };
type SpriteMap = Record<string, SpriteEntry>;

/** Build reverse map: gilIndex → label */
function buildReverseMap(sprites: SpriteMap, prefix = ''): Map<number, string> {
    const map = new Map<number, string>();
    for (const [name, value] of Object.entries(sprites)) {
        const label = prefix ? `${prefix}:${name}` : name;
        if (typeof value === 'number') {
            map.set(value, label);
        } else {
            // Animated range — label the first frame
            map.set(value.start, `${label} [0/${value.count}]`);
            // Label subsequent frames in the range
            for (let i = 1; i < value.count; i++) {
                map.set(value.start + i, `${label} [${i}/${value.count}]`);
            }
        }
    }
    return map;
}

/** GIL index → label for file 5.gfx (map objects) — lazily built on first access */
let mapObjectLabels: Map<number, string> | null = null;

/** GIL index → label for file 7.gfx (HUD overlays) — lazily built on first access */
let hudOverlayLabels: Map<number, string> | null = null;

function getMapObjectLabels(): Map<number, string> {
    if (!mapObjectLabels) {
        mapObjectLabels = buildReverseMap(MAP_OBJECT_SPRITES as unknown as SpriteMap);
    }
    return mapObjectLabels;
}

function getHudOverlayLabels(): Map<number, string> {
    if (!hudOverlayLabels) {
        hudOverlayLabels = buildReverseMap(HUD_OVERLAY_SPRITES as unknown as SpriteMap);
    }
    return hudOverlayLabels;
}

/** Clear cached label maps — call after updating gil-indices.ts */
export function clearLabelCache(): void {
    mapObjectLabels = null;
    hudOverlayLabels = null;
}

/**
 * Get label for a GIL index in a specific GFX file.
 * @param fileId - numeric file ID (e.g., 5 for 5.gfx)
 * @param gilIndex - GIL index within that file
 * @returns human-readable label or undefined if not mapped
 */
export function getGilLabel(fileId: number, gilIndex: number): string | undefined {
    switch (fileId) {
        case 5:
            return getMapObjectLabels().get(gilIndex);
        case 7:
            return getHudOverlayLabels().get(gilIndex);
        default:
            return undefined;
    }
}

/** Check if a GFX file has label mappings available */
export function hasLabelMappings(fileId: number): boolean {
    return fileId === 5 || fileId === 7;
}
