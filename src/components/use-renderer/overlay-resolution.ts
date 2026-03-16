/**
 * Building overlay resolution for the entity renderer.
 * Computes construction overlays and custom overlays (smoke, wheels, flags).
 */

import type { Game } from '@/game/game';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import { OverlayRenderLayer, type BuildingOverlayRenderData } from '@/game/renderer/render-context';
import { getBuildingVisualState, BuildingConstructionPhase } from '@/game/features/building-construction';
import { PIXELS_TO_WORLD } from '@/game/renderer/sprite-metadata';
import type { BuildingType } from '@/game/entity';
import { getOverlayFrame } from '@/game/features/building-overlays';
import { ENTITY_SCALE, scaleSprite } from '@/game/renderer/entity-renderer-constants';

const EMPTY_OVERLAY_DATA: readonly BuildingOverlayRenderData[] = [];

/**
 * Resolve all overlay render data for a building entity.
 * Produces both construction overlays (background sprite during CompletedRising)
 * and custom overlays from the BuildingOverlayManager (smoke, wheels, flags).
 */
export function resolveBuildingOverlays(
    entityId: number,
    g: Game,
    er: EntityRenderer
): readonly BuildingOverlayRenderData[] {
    const result: BuildingOverlayRenderData[] = [];
    resolveConstructionOverlay(entityId, g, er, result);
    resolveCustomOverlays(entityId, g, er, result);
    return result.length > 0 ? result : EMPTY_OVERLAY_DATA;
}

/**
 * During the second half of ConstructionRising (constructionProgress >= 0.5),
 * emit the construction sprite fully visible behind the rising completed building.
 */
function resolveConstructionOverlay(
    entityId: number,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    const site = g.services.constructionSiteManager.getSite(entityId);
    const vs = getBuildingVisualState(site);
    if (vs.phase !== BuildingConstructionPhase.ConstructionRising || !er.spriteManager) {
        return;
    }
    if (!site || site.building.progress < 0.5) {
        return;
    }

    const entity = g.state.getEntity(entityId);
    if (!entity) {
        return;
    }

    const constructionSprite = er.spriteManager.registry.getBuildingConstruction(
        entity.subType as BuildingType,
        entity.race
    );
    if (!constructionSprite) {
        return;
    }

    out.push({
        sprite: scaleSprite(constructionSprite, ENTITY_SCALE),
        worldOffsetX: 0,
        worldOffsetY: 0,
        layer: OverlayRenderLayer.BehindBuilding,
        teamColored: true,
        verticalProgress: 1.0,
    });
}

/** Resolve custom overlays (smoke, wheels, flags) from the BuildingOverlayManager. */
function resolveCustomOverlays(entityId: number, g: Game, er: EntityRenderer, out: BuildingOverlayRenderData[]): void {
    const instances = g.services.buildingOverlayManager.getOverlays(entityId);
    if (!instances) {
        return;
    }

    for (const inst of instances) {
        if (!inst.active) {
            continue;
        }

        if (inst.def.isFlag) {
            resolveFlagInstance(
                entityId,
                inst.def.tileOffsetX!,
                inst.def.tileOffsetY!,
                getOverlayFrame(inst),
                g,
                er,
                out
            );
            continue;
        }

        const spriteRef = inst.def.spriteRef;
        const frames = er.spriteManager?.registry.getOverlayFrames(
            spriteRef.gfxFile,
            spriteRef.jobIndex,
            spriteRef.directionIndex ?? 0
        );
        if (!frames || frames.length === 0) {
            continue;
        }

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

/**
 * Render one flag overlay instance.
 * Uses the per-instance elapsedMs for animation timing.
 * Position comes from the building's XML flag offset in tile coordinates,
 * converted to world-space using the isometric projection.
 */
function resolveFlagInstance(
    entityId: number,
    tileOffsetX: number,
    tileOffsetY: number,
    frameIndex: number,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    if (!er.spriteManager) {
        return;
    }
    const entity = g.state.getEntity(entityId);
    if (!entity) {
        return;
    }

    const flagFrameCount = er.spriteManager.registry.getFlagFrameCount(entity.player);
    if (flagFrameCount === 0) {
        return;
    }

    const rawSprite = er.spriteManager.registry.getFlag(entity.player, frameIndex % flagFrameCount);
    if (!rawSprite) {
        return;
    }

    // Isometric tile-to-world delta: same projection as tileToWorld but for offsets only
    const worldOffsetX = tileOffsetX - tileOffsetY * 0.5;
    const worldOffsetY = tileOffsetY * 0.5;

    out.push({
        sprite: scaleSprite(rawSprite, ENTITY_SCALE),
        teamColored: true,
        verticalProgress: 1.0,
        worldOffsetX,
        worldOffsetY,
        layer: OverlayRenderLayer.Flag,
    });
}
