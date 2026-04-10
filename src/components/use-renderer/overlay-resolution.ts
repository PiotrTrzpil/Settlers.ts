/**
 * Building overlay resolution for the entity renderer.
 * Computes construction overlays and custom overlays (smoke, wheels, flags).
 */

import type { Game } from '@/game/game';
import type { GameState } from '@/game/game-state';
import type { Race } from '@/game/core/race';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import { OverlayRenderLayer, type BuildingOverlayRenderData } from '@/game/renderer/render-context';
import { getBuildingVisualState, BuildingConstructionPhase } from '@/game/features/building-construction';
import { UNIT_XML_PREFIX, type SpriteEntry, type SpriteMetadataRegistry } from '@/game/renderer/sprite-metadata';
import { BuildingType, EntityType } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import { getOverlayFrame } from '@/game/features/building-overlays';
import { ENTITY_SCALE, scaleSprite, pixelOffsetToWorld } from '@/game/renderer/entity-renderer-constants';
import { getGarrisonSlotPositions } from '@/game/features/tower-garrison/internal/garrison-slot-positions';
import {
    towerBowmanTargets,
    towerBowmanThrowingStones,
} from '@/game/features/tower-garrison/internal/tower-combat-system';
import { toSpriteDirection } from '@/game/renderer/sprite-direction';
import { getDirectionToward } from '@/game/systems/hex-directions';
import { ANIMATION_DEFAULTS, xmlKey } from '@/game/animation/animation';

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
    resolveGarrisonOverlays(entityId, g, er, result);
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
        sprite: scaleSprite(constructionSprite.staticSprite, ENTITY_SCALE),
        worldOffsetX: 0,
        worldOffsetY: 0,
        layer: OverlayRenderLayer.BehindBuilding,
        teamColored: true,
        verticalProgress: 1.0,
    });
}

/**
 * Resolve garrisoned soldier sprites as building overlays.
 * Swordsmen use `top === false` positions — static standing pose.
 * Bowmen use `top === true` positions — face their attack target and animate SHOOT/THROW_STONE.
 */
// TODO(debug): remove after castle garrison rendering is confirmed working
let _garrisonDebugLogged = 0;

function resolveGarrisonOverlays(
    entityId: number,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    const entity = g.state.getEntity(entityId);
    if (!entity || entity.type !== EntityType.Building || !er.spriteManager) {
        return;
    }

    const buildingType = entity.subType as BuildingType;

    const garrison = g.services.garrisonManager.getGarrison(entityId);
    if (!garrison) {
        return;
    }

    if (!er.spriteManager.registry.isUnitRaceLoaded(entity.race)) {
        return;
    }

    const registry = er.spriteManager.registry;
    const { state } = g;
    const prevLen = out.length;
    emitSwordsmanOverlays(buildingType, entity.race, garrison.swordsmanSlots.unitIds, state, registry, out);
    emitBowmanOverlays(entity, buildingType, garrison.bowmanSlots.unitIds, state, registry, out);

    // Debug: log when castle garrison unit count changes
    if (buildingType === BuildingType.Castle) {
        const total = garrison.swordsmanSlots.unitIds.length + garrison.bowmanSlots.unitIds.length;
        if (total !== _garrisonDebugLogged) {
            const sw = garrison.swordsmanSlots.unitIds.length;
            const bw = garrison.bowmanSlots.unitIds.length;
            const added = out.length - prevLen;
            console.log(
                `[garrison-debug] Castle id=${entityId}: sw=${sw} bw=${bw} overlaysAdded=${added}`,
                added > 0 ? out.slice(prevLen) : 'NONE'
            );
            _garrisonDebugLogged = total;
        }
    }
}

/** Emit static standing-pose overlays for garrisoned swordsmen. */
function emitSwordsmanOverlays(
    buildingType: BuildingType,
    race: Race,
    unitIds: readonly number[],
    state: GameState,
    registry: SpriteMetadataRegistry,
    out: BuildingOverlayRenderData[]
): void {
    if (unitIds.length === 0) {
        return;
    }

    const slotPositions = getGarrisonSlotPositions(buildingType, race, false)!;

    for (let i = 0; i < unitIds.length; i++) {
        const slot = slotPositions[i]!;
        const unit = state.getEntity(unitIds[i]!);
        if (!unit) {
            continue;
        }

        const sprite = registry.getUnitDirectionSprite(unit.subType as UnitType, slot.direction, unit.race);
        pushGarrisonOverlay(sprite, slot, out);
    }
}

/**
 * Emit overlays for garrisoned bowmen.
 * Bowmen with an active target face toward it and play SHOOT or THROW_STONE animation.
 * Idle bowmen use the static standing pose at the XML default direction.
 */
function emitBowmanOverlays(
    building: { x: number; y: number; race: Race },
    buildingType: BuildingType,
    unitIds: readonly number[],
    state: GameState,
    registry: SpriteMetadataRegistry,
    out: BuildingOverlayRenderData[]
): void {
    if (unitIds.length === 0) {
        return;
    }

    const slotPositions = getGarrisonSlotPositions(buildingType, building.race, true)!;

    for (let i = 0; i < unitIds.length; i++) {
        const slot = slotPositions[i]!;
        const unitId = unitIds[i]!;
        const unit = state.getEntity(unitId);
        if (!unit) {
            continue;
        }

        const unitType = unit.subType as UnitType;
        const targetId = towerBowmanTargets.get(unitId);
        let spriteDir = slot.direction;

        if (targetId !== undefined) {
            const target = state.getEntity(targetId);
            if (target) {
                spriteDir = toSpriteDirection(getDirectionToward(building.x, building.y, target.x, target.y));
            }
        }

        const rawSprite =
            targetId !== undefined
                ? resolveBowmanAnimationFrame(registry, unitType, spriteDir, unit.race, unitId)
                : null;
        const sprite = rawSprite ?? registry.getUnitDirectionSprite(unitType, spriteDir, unit.race);
        pushGarrisonOverlay(sprite, slot, out);
    }
}

/** Push a garrison unit overlay with standard scaling and layer. */
function pushGarrisonOverlay(
    rawSprite: SpriteEntry,
    slot: { offsetX: number; offsetY: number },
    out: BuildingOverlayRenderData[]
): void {
    out.push({
        sprite: scaleSprite(rawSprite, ENTITY_SCALE),
        worldOffsetX: pixelOffsetToWorld(slot.offsetX),
        worldOffsetY: pixelOffsetToWorld(slot.offsetY),
        layer: OverlayRenderLayer.AboveBuilding,
        teamColored: true,
        verticalProgress: 1.0,
    });
}

/** Resolve the current SHOOT or THROW_STONE animation frame for a garrisoned bowman. */
function resolveBowmanAnimationFrame(
    registry: SpriteMetadataRegistry,
    unitType: UnitType,
    spriteDir: number,
    race: Race,
    unitId: number
): SpriteEntry | null {
    const animEntry = registry.getAnimatedEntity(EntityType.Unit, unitType, race);
    if (!animEntry) {
        return null;
    }
    const prefix = UNIT_XML_PREFIX[unitType];
    if (!prefix) {
        return null;
    }
    const action = towerBowmanThrowingStones.has(unitId) ? 'THROW_STONE' : 'SHOOT';
    const dirMap = animEntry.animationData.sequences.get(xmlKey(prefix, action));
    if (!dirMap) {
        return null;
    }
    const seq = dirMap.get(spriteDir);
    if (!seq || seq.frames.length === 0) {
        return null;
    }
    const frameIndex = Math.floor(performance.now() / ANIMATION_DEFAULTS.FRAME_DURATION_MS) % seq.frames.length;
    return seq.frames[frameIndex]!;
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
            // eslint-disable-next-line no-restricted-syntax -- directionIndex is an optional sprite property; 0 is the correct default direction
            spriteRef.directionIndex ?? 0
        );
        if (!frames || frames.length === 0) {
            continue;
        }

        const frameIndex = getOverlayFrame(inst);
        const sprite = frames[Math.min(frameIndex, frames.length - 1)]!;

        out.push({
            sprite: scaleSprite(sprite, ENTITY_SCALE),
            worldOffsetX: pixelOffsetToWorld(inst.def.pixelOffsetX),
            worldOffsetY: pixelOffsetToWorld(inst.def.pixelOffsetY),
            layer: inst.def.layer as number as OverlayRenderLayer,
            // eslint-disable-next-line no-restricted-syntax -- teamColored is an optional overlay property; false (not team-colored) is the correct default
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

    // Isometric tile-to-world delta: same projection as tileToWorld but for offsets only
    const worldOffsetX = tileOffsetX - tileOffsetY * 0.5;
    const worldOffsetY = tileOffsetY * 0.5;

    out.push({
        sprite: scaleSprite(rawSprite, ENTITY_SCALE),
        teamColored: true,
        verticalProgress: 1.0,
        worldOffsetX,
        worldOffsetY,
        layer: OverlayRenderLayer.AboveBuilding,
    });
}
