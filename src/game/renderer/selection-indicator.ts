/**
 * Selection indicator sprite resolution.
 *
 * Maps entity types to the appropriate selection bracket sprite from GFX file 7.
 * Military units get level-specific brackets; leaders get a dedicated bracket;
 * civilian units get a standard compact bracket.
 *
 * Health dots are drawn in the center of the bracket using the bright variant
 * (8 levels: green=healthy → red=critical).
 *
 * Indicators are zoom-compensated so they stay at a constant screen size,
 * and positioned at the top of the unit sprite (above the head).
 */

import type { Entity } from '../entity';
import { EntityType, UnitType, isUnitTypeMilitary } from '../entity';
import { getUnitLevel } from '../unit-types';
import { HUD_OVERLAY_SPRITES } from './sprite-metadata/gil-indices';
import { GilSpriteManifest } from './sprite-metadata/gil-sprite-manifest';
import type { SpriteEntry } from './sprite-metadata';
import type { SpriteRenderManager } from './sprite-render-manager';

/** Base scale applied to selection indicator sprites at the reference zoom. */
const SELECTION_INDICATOR_BASE_SCALE = 1.8;

/** Base scale applied to health dot sprites at the reference zoom. */
const HEALTH_DOT_BASE_SCALE = 2.5;

/**
 * Reference zoom level at which indicators appear at their base scale.
 * Default camera: zoomValue=2 → zoom=0.05.
 */
const REFERENCE_ZOOM = 0.05;

/** Health dot config — single source of truth for dot variant and level count. */
const HEALTH_DOT = HUD_OVERLAY_SPRITES.HEALTH_DOT_SMALL;

/** GFX file 7 = HUD overlay sprites. */
const HUD_GFX_FILE = 7;

/**
 * Sprite manifest for the selection indicator system.
 * Single source of truth: the loader uses it to know what to preload,
 * and the resolver uses it to look up loaded sprites at render time.
 */
export const SELECTION_INDICATOR_MANIFEST = new GilSpriteManifest(
    HUD_GFX_FILE,
    (() => {
        const indices: number[] = [
            HUD_OVERLAY_SPRITES.SELECTION_BRACKET_COMPACT,
            HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL1,
            HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL2,
            HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL3,
            HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LEADER,
        ];
        for (let d = 0; d < HEALTH_DOT.count; d++) indices.push(HEALTH_DOT.start + d);
        return indices;
    })()
);

/**
 * Get the GIL index for the selection bracket sprite appropriate for this entity.
 * Returns null for entities that don't use sprite-based selection (e.g. buildings).
 */
export function getSelectionBracketGilIndex(entity: Entity): number | null {
    if (entity.type !== EntityType.Unit) return null;

    const unitType = entity.subType as UnitType;

    if (unitType === UnitType.SquadLeader) {
        return HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LEADER;
    }

    if (isUnitTypeMilitary(unitType)) {
        const level = getUnitLevel(unitType);
        if (level === 3) return HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL3;
        if (level === 2) return HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL2;
        return HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL1;
    }

    return HUD_OVERLAY_SPRITES.SELECTION_BRACKET_COMPACT;
}

/**
 * Resolve the selection indicator SpriteEntry for an entity.
 * Applies zoom compensation so the indicator stays at a constant screen size.
 *
 * The returned sprite is positioned so that it sits centered horizontally
 * and anchored at the bottom — when drawn at the sprite's top Y coordinate
 * the indicator appears just above the unit's head.
 *
 * Returns null if no sprite is available.
 */
export function resolveSelectionIndicator(
    entity: Entity,
    spriteManager: SpriteRenderManager,
    currentZoom: number
): SpriteEntry | null {
    const gilIndex = getSelectionBracketGilIndex(entity);
    if (gilIndex === null) return null;

    const sprite = SELECTION_INDICATOR_MANIFEST.resolve(gilIndex, spriteManager.spriteRegistry!);
    if (!sprite) return null;

    const zoomCompensation = REFERENCE_ZOOM / currentZoom;
    const scale = SELECTION_INDICATOR_BASE_SCALE * zoomCompensation;

    const w = sprite.widthWorld * scale;
    const h = sprite.heightWorld * scale;

    // Center horizontally; anchor bottom edge at draw position so it sits above the head.
    return {
        ...sprite,
        widthWorld: w,
        heightWorld: h,
        offsetX: -w / 2,
        offsetY: -h,
    };
}

/**
 * Resolve the health dot SpriteEntry for a given health ratio.
 * The dot is centered on the draw position and zoom-compensated.
 *
 * @param healthRatio 0-1 where 1 = full health, 0 = dead
 * @returns SpriteEntry for the health dot, or null if unavailable
 */
export function resolveHealthDot(
    healthRatio: number,
    spriteManager: SpriteRenderManager,
    currentZoom: number
): SpriteEntry | null {
    // Map ratio to dot level: 0=green (full), 7=red (empty)
    const level = Math.min(HEALTH_DOT.count - 1, Math.floor((1 - healthRatio) * HEALTH_DOT.count));
    const gilIndex = HEALTH_DOT.start + level;

    const sprite = SELECTION_INDICATOR_MANIFEST.resolve(gilIndex, spriteManager.spriteRegistry!);
    if (!sprite) return null;

    const zoomCompensation = REFERENCE_ZOOM / currentZoom;
    const scale = HEALTH_DOT_BASE_SCALE * zoomCompensation;

    const w = sprite.widthWorld * scale;
    const h = sprite.heightWorld * scale;

    // Center the dot on the draw position.
    return {
        ...sprite,
        widthWorld: w,
        heightWorld: h,
        offsetX: -w / 2,
        offsetY: -h / 2,
    };
}
