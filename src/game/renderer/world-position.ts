/**
 * Shared world position utilities for renderers.
 * Handles interpolation of unit positions during movement,
 * building anchor offsets, and MapObject jitter.
 *
 * Used by SelectionOverlayRenderer and all render passes
 * (EntitySpritePass, ColorEntityPass, TransitionBlendPass).
 */

import { Entity, EntityType } from '../entity';
import { TILE_CENTER_X, TILE_CENTER_Y } from '../systems/coordinate-system';
import type { UnitStateLookup } from './render-context';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { IViewPoint } from './i-view-point';

/**
 * Minimal context required for world position calculations.
 */
export interface WorldPositionContext {
    mapSize: MapSize;
    groundHeight: Uint8Array;
    viewPoint: IViewPoint;
    unitStates: UnitStateLookup;
}

/**
 * Spatial data needed by render passes (no viewPoint — that comes as a separate draw() parameter).
 */
export interface RenderSpatialContext {
    mapSize: MapSize;
    groundHeight: Uint8Array;
    unitStates: UnitStateLookup;
    frameContext?: { getWorldPos(entity: Entity): { worldX: number; worldY: number } | undefined } | null;
}

/**
 * World position result.
 */
export interface WorldPosition {
    worldX: number;
    worldY: number;
}

/**
 * Get world position for an entity (with interpolation for units).
 * Buildings are shifted to the tile vertex (matching sprite anchor convention).
 */
export function getEntityWorldPos(entity: Entity, ctx: WorldPositionContext): WorldPosition {
    if (entity.type === EntityType.Unit) {
        return getInterpolatedWorldPos(entity, ctx);
    }
    const pos = TilePicker.tileToWorld(
        entity.x,
        entity.y,
        ctx.groundHeight,
        ctx.mapSize,
        ctx.viewPoint.x,
        ctx.viewPoint.y
    );
    if (entity.type === EntityType.Building) {
        pos.worldX -= TILE_CENTER_X;
        pos.worldY -= TILE_CENTER_Y * 0.5;
    }
    return pos;
}

/**
 * Get world position for a render pass entity.
 * Supports frameContext caching and MapObject deterministic jitter.
 * This is the unified version used by EntitySpritePass, ColorEntityPass, etc.
 */
export function getRenderEntityWorldPos(
    entity: Entity,
    ctx: RenderSpatialContext,
    viewPoint: IViewPoint
): WorldPosition {
    const cachedPos = ctx.frameContext?.getWorldPos(entity);
    let worldPos: WorldPosition;

    if (cachedPos) {
        worldPos = { worldX: cachedPos.worldX, worldY: cachedPos.worldY };
    } else if (entity.type === EntityType.Unit) {
        const wpCtx: WorldPositionContext = { ...ctx, viewPoint };
        worldPos = getInterpolatedWorldPos(entity, wpCtx);
    } else {
        worldPos = TilePicker.tileToWorld(entity.x, entity.y, ctx.groundHeight, ctx.mapSize, viewPoint.x, viewPoint.y);
    }

    if (entity.type === EntityType.Building) {
        worldPos.worldX -= TILE_CENTER_X;
        worldPos.worldY -= TILE_CENTER_Y * 0.5;
    }

    if (entity.type === EntityType.MapObject) {
        applyMapObjectJitter(entity, worldPos);
    }

    return worldPos;
}

/**
 * Apply deterministic random jitter to a MapObject's world position.
 * Uses a hash of tile coordinates as seed for consistent appearance.
 */
function applyMapObjectJitter(entity: Entity, pos: WorldPosition): void {
    const seed = entity.x * 12.9898 + entity.y * 78.233;
    pos.worldX += ((Math.sin(seed) * 43758.5453) % 1) * 0.3 - 0.15;
    pos.worldY += ((Math.cos(seed) * 43758.5453) % 1) * 0.3 - 0.15;
}

/**
 * Get the interpolated world position for a unit.
 * Handles smooth movement between tiles based on moveProgress.
 */
export function getInterpolatedWorldPos(entity: Entity, ctx: WorldPositionContext): WorldPosition {
    const unitState = ctx.unitStates.get(entity.id);

    const isStationary = !unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y);

    if (isStationary) {
        return TilePicker.tileToWorld(
            entity.x,
            entity.y,
            ctx.groundHeight,
            ctx.mapSize,
            ctx.viewPoint.x,
            ctx.viewPoint.y
        );
    }

    const prevPos = TilePicker.tileToWorld(
        unitState.prevX,
        unitState.prevY,
        ctx.groundHeight,
        ctx.mapSize,
        ctx.viewPoint.x,
        ctx.viewPoint.y
    );
    const currPos = TilePicker.tileToWorld(
        entity.x,
        entity.y,
        ctx.groundHeight,
        ctx.mapSize,
        ctx.viewPoint.x,
        ctx.viewPoint.y
    );

    const t = Math.max(0, Math.min(unitState.moveProgress, 1));
    return {
        worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
        worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t,
    };
}
