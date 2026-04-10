/**
 * Building overlay resolution for the entity renderer.
 * Computes construction overlays, garrison soldier overlays, and custom
 * overlays (smoke, wheels, flags, tower parts).
 *
 * Garrison buildings use a render spec that interleaves soldiers between
 * building overlay layers (e.g. tower back → soldiers → tower frontwall).
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
import { getOverlayFrame, type BuildingOverlayInstance } from '@/game/features/building-overlays';
import { ENTITY_SCALE, scaleSprite, pixelOffsetToWorld } from '@/game/renderer/entity-renderer-constants';
import { getBuildingInfo } from '@/game/data/game-data-access';
import type { BuildingSettlerPos } from '@/resources/game-data';
import {
    towerBowmanTargets,
    towerBowmanThrowingStones,
} from '@/game/features/tower-garrison/internal/tower-combat-system';
import { getGarrisonRenderSpec, type TowerSlot } from '@/game/features/tower-garrison/internal/garrison-render-spec';
import type { BuildingGarrisonState } from '@/game/features/tower-garrison/types';
import { toSpriteDirection } from '@/game/renderer/sprite-direction';
import { getDirectionToward } from '@/game/systems/hex-directions';
import { ANIMATION_DEFAULTS, xmlKey } from '@/game/animation/animation';

const EMPTY_OVERLAY_DATA: readonly BuildingOverlayRenderData[] = [];

/**
 * Resolve all overlay render data for a building entity.
 * Produces construction overlays, garrison soldiers, and custom overlays
 * in the correct interleaved draw order.
 */
export function resolveBuildingOverlays(
    entityId: number,
    g: Game,
    er: EntityRenderer
): readonly BuildingOverlayRenderData[] {
    const result: BuildingOverlayRenderData[] = [];
    resolveConstructionOverlay(entityId, g, er, result);

    const entity = g.state.getEntity(entityId);
    if (entity && entity.type === EntityType.Building) {
        const spec = getGarrisonRenderSpec(entity.subType as BuildingType, entity.race);
        if (spec) {
            resolveInterleavedOverlays(entityId, entity.subType as BuildingType, entity.race, g, er, spec, result);
        } else {
            emitAllCustomOverlays(entityId, g, er, result);
        }
    } else {
        emitAllCustomOverlays(entityId, g, er, result);
    }

    return result.length > 0 ? result : EMPTY_OVERLAY_DATA;
}

// ── Interleaved garrison + overlay resolution ───────────────────

/**
 * Walk the render spec and emit overlays and garrison soldiers in the
 * correct draw order. Overlays not mentioned in the spec (e.g. flag)
 * are appended at the end.
 */
function resolveInterleavedOverlays(
    entityId: number,
    buildingType: BuildingType,
    race: Race,
    g: Game,
    er: EntityRenderer,
    spec: readonly TowerSlot[],
    out: BuildingOverlayRenderData[]
): void {
    const garrison = g.services.garrisonManager.getGarrison(entityId);
    const entity = g.state.getEntity(entityId)!;
    const registry = er.spriteManager?.registry;

    const overlayMap = buildOverlayMap(entityId, g);
    const usedOverlayKeys = new Set<string>();

    const xmlSettlers = getBuildingInfo(race, buildingType)?.settlers;
    const unitRaceReady = registry != null && registry.isUnitRaceLoaded(race);

    if (!_settlerDebugDone && garrison) {
        logGarrisonDebug(buildingType, race, spec.length, xmlSettlers?.length, garrison);
    }

    for (const tower of spec) {
        emitTowerSlot(tower, overlayMap, usedOverlayKeys, er, out);

        if (garrison && unitRaceReady && xmlSettlers) {
            emitSettlersByIndex(entity, garrison, xmlSettlers, tower.settlers, g.state, registry, out, tower.name);
        }

        emitTowerFrontwall(tower, overlayMap, usedOverlayKeys, er, out);
    }

    _settlerDebugDone = true;

    // Append remaining overlays not in the spec (flag, door, etc.)
    emitRemainingOverlays(entityId, usedOverlayKeys, g, er, out);
}

function logGarrisonDebug(
    buildingType: BuildingType,
    race: Race,
    towerCount: number,
    xmlSettlerCount: number | undefined,
    garrison: Readonly<BuildingGarrisonState>
): void {
    console.warn(
        `[spec-debug] buildingType=${buildingType} race=${race} towers=${towerCount} ` +
            `xmlSettlers=${xmlSettlerCount} sw=${garrison.swordsmanSlots.unitIds.length}/${garrison.swordsmanSlots.max} ` +
            `bw=${garrison.bowmanSlots.unitIds.length}/${garrison.bowmanSlots.max}`
    );
}

function emitTowerSlot(
    tower: TowerSlot,
    overlayMap: Map<string, BuildingOverlayInstance>,
    usedKeys: Set<string>,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    if (!tower.name) {
        return;
    }
    usedKeys.add(tower.name);
    const backInst = overlayMap.get(tower.name);
    if (backInst) {
        emitCustomOverlayInstance(backInst, er, out);
    }
}

function emitTowerFrontwall(
    tower: TowerSlot,
    overlayMap: Map<string, BuildingOverlayInstance>,
    usedKeys: Set<string>,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    if (!tower.name) {
        return;
    }
    const fwKey = `${tower.name}_frontwall`;
    usedKeys.add(fwKey);
    const fwInst = overlayMap.get(fwKey);
    if (fwInst) {
        emitCustomOverlayInstance(fwInst, er, out);
    }
}

/** Index active overlay instances by their def key. */
function buildOverlayMap(entityId: number, g: Game): Map<string, BuildingOverlayInstance> {
    const map = new Map<string, BuildingOverlayInstance>();
    const instances = g.services.buildingOverlayManager.getOverlays(entityId);
    if (!instances) {
        return map;
    }
    for (const inst of instances) {
        if (inst.active && !inst.def.isFlag) {
            map.set(inst.def.key, inst);
        }
    }
    return map;
}

/**
 * Emit garrison soldiers at specific XML settler position indices.
 *
 * The render spec uses unified indices into the XML settler list.
 * Each settler position is either a swordsman slot (top=false) or
 * bowman slot (top=true). We count how many swordsman/bowman positions
 * come before this index to find the correct unit ID from the garrison.
 */
// Debug: log settler rendering once
let _settlerDebugDone = false;

function emitSettlersByIndex(
    building: { x: number; y: number; race: Race },
    garrison: Readonly<BuildingGarrisonState>,
    xmlSettlers: readonly BuildingSettlerPos[],
    indices: readonly number[],
    state: GameState,
    registry: SpriteMetadataRegistry,
    out: BuildingOverlayRenderData[],
    towerName: string
): void {
    if (!_settlerDebugDone) {
        console.warn(`[tower] "${towerName}" indices=[${indices}]`);
    }

    for (const idx of indices) {
        emitSettlerAtIndex(idx, building, garrison, xmlSettlers, state, registry, out);
    }
}

function emitSettlerAtIndex(
    idx: number,
    building: { x: number; y: number; race: Race },
    garrison: Readonly<BuildingGarrisonState>,
    xmlSettlers: readonly BuildingSettlerPos[],
    state: GameState,
    registry: SpriteMetadataRegistry,
    out: BuildingOverlayRenderData[]
): void {
    if (idx >= xmlSettlers.length) {
        if (!_settlerDebugDone) {
            console.warn(`  [${idx}] SKIP out-of-range (max=${xmlSettlers.length})`);
        }
        return;
    }
    const pos = xmlSettlers[idx]!;
    const role = pos.top ? 'bowman' : 'swordsman';

    const slotIndex = countPrecedingSlots(xmlSettlers, idx, pos.top);
    const slots = pos.top ? garrison.bowmanSlots : garrison.swordsmanSlots;
    if (slotIndex >= slots.unitIds.length) {
        if (!_settlerDebugDone) {
            console.warn(`  [${idx}] ${role} slotIdx=${slotIndex} SKIP (only ${slots.unitIds.length} garrisoned)`);
        }
        return;
    }

    const unitId = slots.unitIds[slotIndex]!;
    const unit = state.getEntity(unitId);
    if (!unit) {
        if (!_settlerDebugDone) {
            console.warn(`  [${idx}] ${role} slotIdx=${slotIndex} unitId=${unitId} SKIP (entity missing)`);
        }
        return;
    }

    if (!_settlerDebugDone) {
        console.warn(
            `  [${idx}] ${role} slotIdx=${slotIndex} unitId=${unitId} type=${unit.subType} ` +
                `pos=(${pos.xOffset},${pos.yOffset}) dir=${pos.direction} RENDERED`
        );
    }

    const sprite = resolveSettlerSprite(building, pos, unitId, unit, state, registry);
    pushGarrisonOverlay(sprite, pos, out);
}

/** Count how many XML settler positions before `idx` share the same `top` value. */
function countPrecedingSlots(xmlSettlers: readonly BuildingSettlerPos[], idx: number, top: boolean): number {
    let count = 0;
    for (let j = 0; j < idx; j++) {
        if (xmlSettlers[j]!.top === top) {
            count++;
        }
    }
    return count;
}

/** Resolve the sprite for a garrisoned settler (swordsman or bowman). */
function resolveSettlerSprite(
    building: { x: number; y: number },
    pos: BuildingSettlerPos,
    unitId: number,
    unit: { subType: string | number; race: Race },
    state: GameState,
    registry: SpriteMetadataRegistry
): SpriteEntry {
    const unitType = unit.subType as UnitType;

    if (!pos.top) {
        return registry.getUnitDirectionSprite(unitType, pos.direction, unit.race);
    }

    // Bowman — face target if attacking, else use slot direction
    const targetId = towerBowmanTargets.get(unitId);
    let spriteDir = pos.direction;

    if (targetId !== undefined) {
        const target = state.getEntity(targetId);
        if (target) {
            spriteDir = toSpriteDirection(getDirectionToward(building.x, building.y, target.x, target.y));
        }
        const rawSprite = resolveBowmanAnimationFrame(registry, unitType, spriteDir, unit.race, unitId);
        if (rawSprite) {
            return rawSprite;
        }
    }

    return registry.getUnitDirectionSprite(unitType, spriteDir, unit.race);
}

// ── Custom overlay helpers ──────────────────────────────────────

/** Emit a single custom overlay instance (non-flag). */
function emitCustomOverlayInstance(
    inst: BuildingOverlayInstance,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
    const spriteRef = inst.def.spriteRef;
    const frames = er.spriteManager?.registry.getOverlayFrames(
        spriteRef.gfxFile,
        spriteRef.jobIndex,
        // eslint-disable-next-line no-restricted-syntax -- directionIndex is an optional sprite property; 0 is the correct default direction
        spriteRef.directionIndex ?? 0
    );
    if (!frames || frames.length === 0) {
        return;
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

/** Emit overlays whose keys were NOT consumed by the render spec (e.g. flags). */
function emitRemainingOverlays(
    entityId: number,
    usedKeys: Set<string>,
    g: Game,
    er: EntityRenderer,
    out: BuildingOverlayRenderData[]
): void {
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
        if (!usedKeys.has(inst.def.key)) {
            emitCustomOverlayInstance(inst, er, out);
        }
    }
}

/** Emit all custom overlays for a non-garrison building (smoke, wheels, flags). */
function emitAllCustomOverlays(entityId: number, g: Game, er: EntityRenderer, out: BuildingOverlayRenderData[]): void {
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
        emitCustomOverlayInstance(inst, er, out);
    }
}

// ── Construction overlay ────────────────────────────────────────

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

// ── Garrison sprite helpers ─────────────────────────────────────

/** Push a garrison unit overlay with standard scaling and layer. */
function pushGarrisonOverlay(
    rawSprite: SpriteEntry,
    slot: { xOffset: number; yOffset: number },
    out: BuildingOverlayRenderData[]
): void {
    out.push({
        sprite: scaleSprite(rawSprite, ENTITY_SCALE),
        worldOffsetX: pixelOffsetToWorld(slot.xOffset),
        worldOffsetY: pixelOffsetToWorld(slot.yOffset),
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

// ── Flag overlay ────────────────────────────────────────────────

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
