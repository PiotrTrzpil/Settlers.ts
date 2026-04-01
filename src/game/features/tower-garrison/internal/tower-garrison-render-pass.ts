/**
 * Tower Garrison Render Pass
 *
 * Draws garrisoned soldier sprites at predefined pixel offset positions
 * from buildingInfo.xml. Two instances are created:
 *
 * - **Swordsmen** (`top === false`): RenderLayer.BehindEntities — rendered behind
 *   the building sprite, visible through window cutouts. Static standing pose.
 * - **Bowmen** (`top === true`): RenderLayer.AboveEntities — rendered on top of
 *   the building sprite, on the roof/battlements. Animated; face their target
 *   when attacking.
 *
 * Positioning follows the same pattern as building overlays (overlay-resolution.ts):
 * XML pixel offsets are converted to world space via PIXELS_TO_WORLD, and sprites
 * are scaled by ENTITY_SCALE to match the building's render scale.
 */

import type { PluggableRenderPass, PassContext } from '@/game/renderer/render-passes/types';
import type { IViewPoint } from '@/game/renderer/i-view-point';
import type { TowerGarrisonManager } from '../tower-garrison-manager';
import type { GameState } from '@/game/game-state';
import type { GarrisonSlotPosition } from './garrison-slot-positions';
import type { GarrisonSlotSet } from '../types';
import type { SpriteEntry } from '@/game/renderer/sprite-metadata';
import { BuildingType, EntityType } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import { getRenderEntityWorldPos } from '@/game/renderer/world-position';
import { toSpriteDirection } from '@/game/renderer/sprite-direction';
import { getDirectionToward } from '@/game/systems/hex-directions';
import { TINT_NEUTRAL } from '@/game/renderer/tint-utils';
import { PALETTE_TEXTURE_WIDTH } from '@/game/renderer/palette-texture';
import { scaleSprite, ENTITY_SCALE } from '@/game/renderer/entity-renderer-constants';
import { PIXELS_TO_WORLD, UNIT_XML_PREFIX } from '@/game/renderer/sprite-metadata';
import { ANIMATION_DEFAULTS, xmlKey } from '@/game/animation/animation';
import { getGarrisonSlotPositions } from './garrison-slot-positions';

export interface GarrisonRenderConfig {
    /** Which slot set to read from the garrison state */
    getSlots: (garrison: { swordsmanSlots: GarrisonSlotSet; bowmanSlots: GarrisonSlotSet }) => GarrisonSlotSet;
    /** XML `top` flag value — true for bowmen (above), false for swordsmen (behind) */
    top: boolean;
    /** Optional target map for direction override (bowmen face their attack target) */
    targets?: ReadonlyMap<number, number>;
    /** Optional set of bowman IDs currently throwing stones (siege door combat) */
    throwingStones?: ReadonlySet<number>;
}

export class TowerGarrisonRenderPass implements PluggableRenderPass {
    private ctx!: PassContext;
    public lastDrawCalls = 0;
    public lastSpriteCount = 0;

    constructor(
        private readonly garrisonManager: TowerGarrisonManager,
        private readonly gameState: GameState,
        private readonly config: GarrisonRenderConfig
    ) {}

    prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) {
            return;
        }

        this.lastSpriteCount = 0;

        ctx.spriteManager.spriteAtlas!.bindForRendering(gl);
        ctx.spriteManager.paletteManager.bind(gl);
        const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
        ctx.spriteBatchRenderer.beginSpriteBatch(
            gl,
            projection,
            PALETTE_TEXTURE_WIDTH,
            rowsPerPlayer,
            ctx.renderSettings.antialias
        );

        for (const entity of ctx.sortedEntities) {
            if (entity.type !== EntityType.Building) {
                continue;
            }

            const garrison = this.garrisonManager.getGarrison(entity.id);
            if (!garrison) {
                continue;
            }

            const slotSet = this.config.getSlots(garrison);
            if (slotSet.unitIds.length === 0) {
                continue;
            }

            const slotPositions = getGarrisonSlotPositions(
                entity.subType as BuildingType,
                entity.race,
                this.config.top
            );
            if (!slotPositions) {
                continue;
            }

            const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);
            this.emitSprites(gl, entity.id, slotSet.unitIds, slotPositions, worldPos.worldX, worldPos.worldY);
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }

    /**
     * Resolve sprite direction index (0-5) for a garrisoned unit.
     * Default: XML direction (already a sprite direction index).
     * With target: compute EDirection toward target, convert to sprite direction.
     */
    private resolveDirection(unitId: number, buildingId: number, defaultSpriteDir: number): number {
        const { targets } = this.config;
        if (!targets) {
            return defaultSpriteDir;
        }
        const targetId = targets.get(unitId);
        if (targetId === undefined) {
            return defaultSpriteDir;
        }
        const target = this.gameState.getEntity(targetId);
        if (!target) {
            return defaultSpriteDir;
        }
        const tower = this.gameState.getEntityOrThrow(buildingId, 'TowerGarrisonRenderPass.dir');
        return toSpriteDirection(getDirectionToward(tower.x, tower.y, target.x, target.y));
    }

    /**
     * Resolve the sprite for a garrisoned unit.
     * Bowmen with a target use THROW_STONE (during siege) or SHOOT animation;
     * all others use the static standing pose.
     */
    private resolveSprite(
        unitId: number,
        unitType: UnitType,
        spriteDir: number,
        race: number,
        hasTarget: boolean
    ): SpriteEntry | null {
        if (hasTarget) {
            // eslint-disable-next-line no-restricted-syntax -- throwingStones is nullable-by-design (only bowman pass provides it)
            const throwing = this.config.throwingStones?.has(unitId) ?? false;
            const action = throwing ? 'THROW_STONE' : 'SHOOT';
            const frame = this.resolveAnimationFrame(unitType, spriteDir, race, action);
            if (frame) {
                return frame;
            }
        }
        return this.ctx.spriteResolver.getStaticUnitSprite(unitType, spriteDir, race);
    }

    /** Look up the current animation frame for the given unit type, direction, and action. */
    private resolveAnimationFrame(
        unitType: UnitType,
        spriteDir: number,
        race: number,
        action: string
    ): SpriteEntry | null {
        const animEntry = this.ctx.spriteManager?.registry.getAnimatedEntity(EntityType.Unit, unitType, race);
        if (!animEntry) {
            return null;
        }
        const prefix = UNIT_XML_PREFIX[unitType];
        if (!prefix) {
            return null;
        }
        const dirMap = animEntry.animationData.sequences.get(xmlKey(prefix, action));
        if (!dirMap) {
            return null;
        }
        const seq = dirMap.get(spriteDir) ?? dirMap.get(0);
        if (!seq || seq.frames.length === 0) {
            return null;
        }
        const frameIndex = Math.floor(performance.now() / ANIMATION_DEFAULTS.FRAME_DURATION_MS) % seq.frames.length;
        return seq.frames[frameIndex]!;
    }

    private emitSprites(
        gl: WebGL2RenderingContext,
        buildingId: number,
        unitIds: readonly number[],
        slotPositions: readonly GarrisonSlotPosition[],
        buildingX: number,
        buildingY: number
    ): void {
        const { ctx } = this;
        const { targets } = this.config;

        for (let i = 0; i < unitIds.length; i++) {
            const unitId = unitIds[i]!;
            const slot = slotPositions[i];
            if (!slot) {
                continue;
            }

            const unit = this.gameState.getEntityOrThrow(unitId, 'TowerGarrisonRenderPass');
            const spriteDir = this.resolveDirection(unitId, buildingId, slot.direction);
            const hasTarget = targets !== undefined && targets.has(unitId);

            const rawSprite = this.resolveSprite(unitId, unit.subType as UnitType, spriteDir, unit.race, hasTarget);
            if (!rawSprite) {
                continue;
            }

            // Scale sprite and convert pixel offsets to world space — same as building overlays
            const sprite = scaleSprite(rawSprite, ENTITY_SCALE);
            const x = buildingX + slot.offsetX * PIXELS_TO_WORLD;
            const y = buildingY + slot.offsetY * PIXELS_TO_WORLD;

            ctx.spriteBatchRenderer.addSprite(
                gl,
                x,
                y,
                sprite,
                ctx.renderSettings.disablePlayerTinting ? 0 : unit.player + 1,
                TINT_NEUTRAL
            );
            this.lastSpriteCount++;
        }
    }
}
