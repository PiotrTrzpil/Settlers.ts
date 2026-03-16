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
import { getUnitLevel } from '../core/unit-types';
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
 * Named GIL indices for all selection indicator sprites.
 * Single declaration used by both the manifest (preloading) and the resolve calls.
 * Adding a new sprite here is sufficient — no separate list needed.
 */
const SPRITES = {
    UNIT_COMPACT: HUD_OVERLAY_SPRITES.SELECTION_BRACKET_COMPACT,
    BUILDING: HUD_OVERLAY_SPRITES.SELECTION_BRACKET_MEDIUM,
    MILITARY_LVL1: HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL1,
    MILITARY_LVL2: HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL2,
    MILITARY_LVL3: HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LVL3,
    MILITARY_LEADER: HUD_OVERLAY_SPRITES.MILITARY_BRACKET_LEADER,
} as const;

/**
 * Sprite manifest for the selection indicator system.
 * gilIndices derived automatically from SPRITES + health dot range — no separate list.
 */
export const SELECTION_INDICATOR_MANIFEST = new GilSpriteManifest(HUD_GFX_FILE, [
    ...Object.values(SPRITES),
    ...Array.from({ length: HEALTH_DOT.count }, (_, i) => HEALTH_DOT.start + i),
]);

/** Resolve a sprite from the selection indicator manifest. Throws if not loaded (programming error). */
function resolveFromManifest(gilIndex: number, spriteManager: SpriteRenderManager): SpriteEntry {
    const sprite = SELECTION_INDICATOR_MANIFEST.resolve(gilIndex, spriteManager.registry);
    if (!sprite) {
        throw new Error(
            `Selection indicator sprite GIL ${gilIndex} not loaded — check if the cache was loaded or if CACHE_SCHEMA_VERSION needs bumping`
        );
    }
    return sprite;
}

/**
 * Build a zoom-compensated sprite entry scaled by baseScale at REFERENCE_ZOOM.
 * offsetY: 'center' centers the sprite on the draw position; 'bottom' anchors it at the bottom.
 */
function zoomScaledSprite(
    sprite: SpriteEntry,
    baseScale: number,
    zoom: number,
    offsetY: 'center' | 'bottom'
): SpriteEntry {
    const scale = baseScale * (REFERENCE_ZOOM / zoom);
    const w = sprite.widthWorld * scale;
    const h = sprite.heightWorld * scale;
    return { ...sprite, widthWorld: w, heightWorld: h, offsetX: -w / 2, offsetY: offsetY === 'center' ? -h / 2 : -h };
}

/**
 * Get the GIL index for the selection bracket sprite appropriate for this entity.
 * Returns null for entities that don't use sprite-based selection (e.g. buildings).
 */
export function getSelectionBracketGilIndex(entity: Entity): number | null {
    if (entity.type !== EntityType.Unit) {
        return null;
    }

    const unitType = entity.subType as UnitType;

    if (unitType === UnitType.SquadLeader) {
        return SPRITES.MILITARY_LEADER;
    }

    if (isUnitTypeMilitary(unitType)) {
        const level = getUnitLevel(unitType);
        if (level === 3) {
            return SPRITES.MILITARY_LVL3;
        }
        if (level === 2) {
            return SPRITES.MILITARY_LVL2;
        }
        return SPRITES.MILITARY_LVL1;
    }

    return SPRITES.UNIT_COMPACT;
}

/**
 * Resolve the selection indicator SpriteEntry for an entity.
 * Applies zoom compensation so the indicator stays at a constant screen size.
 *
 * The returned sprite is positioned so that it sits centered horizontally
 * and anchored at the bottom — when drawn at the sprite's top Y coordinate
 * the indicator appears just above the unit's head.
 *
 * Returns null for entities that don't use sprite-based selection.
 */
export function resolveSelectionIndicator(
    entity: Entity,
    spriteManager: SpriteRenderManager,
    currentZoom: number
): SpriteEntry | null {
    const gilIndex = getSelectionBracketGilIndex(entity);
    if (gilIndex === null) {
        return null;
    }
    const sprite = resolveFromManifest(gilIndex, spriteManager);
    // Center horizontally; anchor bottom edge at draw position so it sits above the head.
    return zoomScaledSprite(sprite, SELECTION_INDICATOR_BASE_SCALE, currentZoom, 'bottom');
}

/**
 * Resolve the selection indicator SpriteEntry for a selected building.
 * Uses BUILDING sprite scaled to cover the building's world-space footprint.
 * The returned sprite is centered horizontally and aligned to the top of the footprint.
 */
export function resolveBuildingSelectionIndicator(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    spriteManager: SpriteRenderManager
): SpriteEntry {
    const sprite = resolveFromManifest(SPRITES.BUILDING, spriteManager);
    const w = bounds.maxX - bounds.minX;
    const h = sprite.heightWorld * (w / sprite.widthWorld); // preserve aspect ratio
    return { ...sprite, widthWorld: w, heightWorld: h, offsetX: -w / 2, offsetY: -h / 2 };
}

/**
 * Resolve the health dot SpriteEntry for a given health ratio.
 * The dot is centered on the draw position and zoom-compensated.
 *
 * @param healthRatio 0-1 where 1 = full health, 0 = dead
 */
export function resolveHealthDot(
    healthRatio: number,
    spriteManager: SpriteRenderManager,
    currentZoom: number
): SpriteEntry {
    // Map ratio to dot level: 0=green (full), 7=red (empty)
    const level = Math.min(HEALTH_DOT.count - 1, Math.floor((1 - healthRatio) * HEALTH_DOT.count));
    const sprite = resolveFromManifest(HEALTH_DOT.start + level, spriteManager);
    return zoomScaledSprite(sprite, HEALTH_DOT_BASE_SCALE, currentZoom, 'center');
}
