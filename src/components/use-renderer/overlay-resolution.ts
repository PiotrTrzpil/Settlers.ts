/**
 * Building overlay resolution for the entity renderer.
 * Computes construction overlays, custom overlays (smoke, wheels), and flag overlays.
 */

import type { Game } from '@/game/game';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import { OverlayRenderLayer, type BuildingOverlayRenderData } from '@/game/renderer/render-context';
import { getBuildingVisualState, BuildingConstructionPhase } from '@/game/features/building-construction';
import { PIXELS_TO_WORLD } from '@/game/renderer/sprite-metadata';
import type { BuildingType } from '@/game/entity';
import { getOverlayFrame } from '@/game/systems/building-overlays';
import { getBuildingInfo } from '@/game/game-data-access';
import { ENTITY_SCALE, scaleSprite } from '@/game/renderer/entity-renderer-constants';
import { getSpriteOffset } from '@/game/features/building-adjust';

const EMPTY_OVERLAY_DATA: readonly BuildingOverlayRenderData[] = [];
const FLAG_ANIM_FPS = 12;
const FLAG_SCALE = 0.35;

/**
 * Resolve all overlay render data for a building entity.
 * Produces both construction overlays (background sprite during CompletedRising)
 * and custom overlays from the BuildingOverlayManager.
 */
export function resolveBuildingOverlays(
    entityId: number,
    g: Game,
    er: EntityRenderer
): readonly BuildingOverlayRenderData[] {
    const result: BuildingOverlayRenderData[] = [];
    resolveConstructionOverlay(entityId, g, er, result);
    resolveCustomOverlays(entityId, g, er, result);
    resolveFlagOverlay(entityId, g, er, result);
    return result.length > 0 ? result : EMPTY_OVERLAY_DATA;
}

/** During CompletedRising, emit the construction sprite behind the rising completed building. */
function resolveConstructionOverlay(
    entityId: number,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    const buildingState = g.services.buildingStateManager.getBuildingState(entityId);
    const vs = getBuildingVisualState(buildingState);
    if (vs.phase !== BuildingConstructionPhase.CompletedRising || !er.spriteManager) return;

    const entity = g.state.getEntity(entityId);
    if (!entity) return;

    const constructionSprite = er.spriteManager.getBuildingConstruction(entity.subType as BuildingType, entity.race);
    if (!constructionSprite) return;

    out.push({
        sprite: scaleSprite(constructionSprite, ENTITY_SCALE),
        worldOffsetX: 0,
        worldOffsetY: 0,
        layer: OverlayRenderLayer.BehindBuilding,
        teamColored: true,
        verticalProgress: 1.0,
    });
}

/** Resolve custom overlays (smoke, wheels, etc.) from the BuildingOverlayManager. */
function resolveCustomOverlays(entityId: number, g: Game, er: EntityRenderer, out: BuildingOverlayRenderData[]): void {
    const instances = g.services.buildingOverlayManager.getOverlays(entityId);
    if (!instances) return;

    for (const inst of instances) {
        if (!inst.active) continue;

        const spriteRef = inst.def.spriteRef;
        const frames = er.spriteManager?.getOverlayFrames(
            spriteRef.gfxFile,
            spriteRef.jobIndex,
            spriteRef.directionIndex ?? 0
        );
        if (!frames || frames.length === 0) continue;

        const frameIndex = getOverlayFrame(inst);
        const sprite = frames[Math.min(frameIndex, frames.length - 1)]!;

        out.push({
            sprite,
            worldOffsetX: inst.def.pixelOffsetX * PIXELS_TO_WORLD,
            worldOffsetY: inst.def.pixelOffsetY * PIXELS_TO_WORLD,
            layer: inst.def.layer as number as OverlayRenderLayer,
            teamColored: inst.def.teamColored ?? false,
            verticalProgress: 1.0,
        });
    }
}

/** Resolve the player flag overlay for a building, if it has a flag offset in game data XML. */
function resolveFlagOverlay(entityId: number, g: Game, er: EntityRenderer, out: BuildingOverlayRenderData[]): void {
    const entity = er.spriteManager ? g.state.getEntity(entityId) : null;
    if (!entity) return;
    const info = getBuildingInfo(entity.race, entity.subType as BuildingType);
    if (!info) return;
    const frameCount = er.spriteManager!.getFlagFrameCount(entity.player);
    if (frameCount === 0) return;
    const frame = Math.floor((performance.now() / 1000) * FLAG_ANIM_FPS) % frameCount;
    const rawSprite = er.spriteManager!.getFlag(entity.player, frame);
    if (!rawSprite) return;

    // YAML override takes precedence over XML defaults
    const yamlOffset = getSpriteOffset(entity.subType as BuildingType, entity.race, 'flag');
    const offsetX = yamlOffset
        ? yamlOffset['px']! * PIXELS_TO_WORLD * FLAG_SCALE
        : info.flag.xOffset * PIXELS_TO_WORLD * FLAG_SCALE;
    const offsetY = yamlOffset
        ? yamlOffset['py']! * PIXELS_TO_WORLD * FLAG_SCALE
        : info.flag.yOffset * PIXELS_TO_WORLD * FLAG_SCALE;

    out.push({
        sprite: scaleSprite(rawSprite, FLAG_SCALE),
        teamColored: true,
        verticalProgress: 1.0,
        worldOffsetX: offsetX,
        worldOffsetY: offsetY,
        layer: OverlayRenderLayer.Flag,
    });
}
