/**
 * EntityPicker — screen-space hit testing against entity sprite bounds.
 *
 * Used by SelectMode for click and box selection. Converts entity sprite
 * world-space bounds to screen coordinates and tests against the click/rect.
 */

import type { Entity } from '../entity';
import type { SpriteEntry } from '../renderer/sprite-metadata';
import type { EntitySpriteResolver } from '../renderer/entity-sprite-resolver';
import { scaleSprite, getSpriteScale } from '../renderer/entity-renderer-constants';
import { getEntityWorldPos, type WorldPositionContext } from '../renderer/world-position';
import { worldToNdc, ndcToScreen } from '../systems/coordinate-system';
import type { SelectionManager } from '../ui/selection-manager';
import { debugStats } from '../debug/debug-stats';

export interface EntityPickerContext extends WorldPositionContext {
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
}

/**
 * Convert a sprite's world-space bounding box to screen-space.
 */
function spriteToScreenBounds(
    entity: Entity,
    sprite: SpriteEntry,
    ctx: EntityPickerContext
): { sx0: number; sy0: number; sx1: number; sy1: number } {
    const scale = getSpriteScale(entity);
    const scaled = scaleSprite(sprite, scale);
    const worldPos = getEntityWorldPos(entity, ctx);

    const aspect = ctx.canvasWidth / ctx.canvasHeight;

    // Sprite occupies [worldX+offsetX, worldY+offsetY] to [worldX+offsetX+width, worldY+offsetY+height]
    const wx0 = worldPos.worldX + scaled.offsetX;
    const wy0 = worldPos.worldY + scaled.offsetY;
    const wx1 = wx0 + scaled.widthWorld;
    const wy1 = wy0 + scaled.heightWorld;

    // Convert corners to screen space
    const ndc0 = worldToNdc(wx0, wy1, ctx.zoom, aspect);
    const ndc1 = worldToNdc(wx1, wy0, ctx.zoom, aspect);
    const tl = ndcToScreen(ndc0.ndcX, ndc0.ndcY, ctx.canvasWidth, ctx.canvasHeight);
    const br = ndcToScreen(ndc1.ndcX, ndc1.ndcY, ctx.canvasWidth, ctx.canvasHeight);

    return {
        sx0: Math.min(tl.screenX, br.screenX),
        sy0: Math.min(tl.screenY, br.screenY),
        sx1: Math.max(tl.screenX, br.screenX),
        sy1: Math.max(tl.screenY, br.screenY),
    };
}

/**
 * Create an entity picker function for click selection.
 * Returns entity ID of the frontmost entity whose sprite contains the screen point.
 */
export function createEntityPicker(
    getEntities: () => readonly Entity[],
    getSpriteResolver: () => EntitySpriteResolver | null,
    getSelection: () => SelectionManager,
    getContext: () => EntityPickerContext | null
): (screenX: number, screenY: number) => number | null {
    return (screenX: number, screenY: number) => {
        const ctx = getContext();
        const resolver = getSpriteResolver();
        if (!ctx || !resolver) {
            return null;
        }

        const sel = getSelection();
        const debugAll = debugStats.state.selectAllUnits;
        let bestId: number | null = null;
        let bestArea = Infinity;

        for (const entity of getEntities()) {
            if (!sel.canSelect(entity, debugAll)) {
                continue;
            }

            const resolved = resolver.resolve(entity);
            if (resolved.skip || !resolved.sprite) {
                continue;
            }

            const bounds = spriteToScreenBounds(entity, resolved.sprite, ctx);
            if (screenX >= bounds.sx0 && screenX <= bounds.sx1 && screenY >= bounds.sy0 && screenY <= bounds.sy1) {
                // Pick smallest sprite (most specific hit) to prefer units over large buildings
                const area = (bounds.sx1 - bounds.sx0) * (bounds.sy1 - bounds.sy0);
                if (area < bestArea) {
                    bestArea = area;
                    bestId = entity.id;
                }
            }
        }

        return bestId;
    };
}

/**
 * Create an entity rect picker for box selection.
 * Returns entity IDs whose sprites intersect the screen rectangle.
 */
export function createEntityRectPicker(
    getEntities: () => readonly Entity[],
    getSpriteResolver: () => EntitySpriteResolver | null,
    getSelection: () => SelectionManager,
    getContext: () => EntityPickerContext | null
): (sx1: number, sy1: number, sx2: number, sy2: number) => number[] {
    return (sx1: number, sy1: number, sx2: number, sy2: number) => {
        const ctx = getContext();
        const resolver = getSpriteResolver();
        if (!ctx || !resolver) {
            return [];
        }

        const sel = getSelection();
        const debugAll = debugStats.state.selectAllUnits;

        const rMinX = Math.min(sx1, sx2);
        const rMaxX = Math.max(sx1, sx2);
        const rMinY = Math.min(sy1, sy2);
        const rMaxY = Math.max(sy1, sy2);

        const ids: number[] = [];
        for (const entity of getEntities()) {
            if (!sel.canSelect(entity, debugAll)) {
                continue;
            }

            const resolved = resolver.resolve(entity);
            if (resolved.skip || !resolved.sprite) {
                continue;
            }

            const bounds = spriteToScreenBounds(entity, resolved.sprite, ctx);
            // AABB intersection test
            if (bounds.sx1 >= rMinX && bounds.sx0 <= rMaxX && bounds.sy1 >= rMinY && bounds.sy0 <= rMaxY) {
                ids.push(entity.id);
            }
        }

        return ids;
    };
}
