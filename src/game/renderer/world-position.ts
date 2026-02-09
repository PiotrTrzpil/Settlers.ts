/**
 * Shared world position utilities for renderers.
 * Handles interpolation of unit positions during movement.
 */

import { Entity, EntityType } from '../entity';
import { UnitStateLookup } from '../game-state';
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
 * World position result.
 */
export interface WorldPosition {
    worldX: number;
    worldY: number;
}

/**
 * Get world position for an entity (with interpolation for units).
 */
export function getEntityWorldPos(entity: Entity, ctx: WorldPositionContext): WorldPosition {
    if (entity.type === EntityType.Unit) {
        return getInterpolatedWorldPos(entity, ctx);
    }
    return TilePicker.tileToWorld(
        entity.x, entity.y,
        ctx.groundHeight, ctx.mapSize,
        ctx.viewPoint.x, ctx.viewPoint.y
    );
}

/**
 * Get the interpolated world position for a unit.
 * Handles smooth movement between tiles based on moveProgress.
 */
export function getInterpolatedWorldPos(entity: Entity, ctx: WorldPositionContext): WorldPosition {
    const unitState = ctx.unitStates.get(entity.id);

    const isStationary = !unitState ||
        (unitState.prevX === entity.x && unitState.prevY === entity.y);

    if (isStationary) {
        return TilePicker.tileToWorld(
            entity.x, entity.y,
            ctx.groundHeight, ctx.mapSize,
            ctx.viewPoint.x, ctx.viewPoint.y
        );
    }

    const prevPos = TilePicker.tileToWorld(
        unitState.prevX, unitState.prevY,
        ctx.groundHeight, ctx.mapSize,
        ctx.viewPoint.x, ctx.viewPoint.y
    );
    const currPos = TilePicker.tileToWorld(
        entity.x, entity.y,
        ctx.groundHeight, ctx.mapSize,
        ctx.viewPoint.x, ctx.viewPoint.y
    );

    const t = Math.max(0, Math.min(unitState.moveProgress, 1));
    return {
        worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
        worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
    };
}
