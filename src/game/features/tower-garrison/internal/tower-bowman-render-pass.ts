/**
 * Tower Bowman Render Pass
 *
 * Draws garrisoned bowman sprites on top of tower buildings at predefined
 * pixel offset positions. Bowmen face their current target (if attacking)
 * or a default direction (if idle).
 *
 * Registered at RenderLayer.AboveEntities so bowmen draw on top of tower sprites.
 */

import type { PluggableRenderPass, PassContext, RenderPassDefinition } from '@/game/renderer/render-passes/types';
import { RenderLayer } from '@/game/renderer/render-passes/types';
import type { IViewPoint } from '@/game/renderer/i-view-point';
import type { TowerGarrisonManager } from '../tower-garrison-manager';
import type { GameState } from '@/game/game-state';
import { BuildingType, EntityType } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import type { AnimationPlayback } from '@/game/animation/entity-visual-service';
import type { BowmanSlotPosition } from './bowman-positions';
import { TilePicker } from '@/game/input/tile-picker';
import { TILE_CENTER_X, TILE_CENTER_Y } from '@/game/systems/coordinate-system';
import { toSpriteDirection } from '@/game/renderer/sprite-direction';
import { getApproxDirection } from '@/game/systems/hex-directions';
import { TINT_NEUTRAL } from '@/game/renderer/tint-utils';
import { PALETTE_TEXTURE_WIDTH } from '@/game/renderer/palette-texture';
import { getBowmanSlotPositions } from './bowman-positions';

function makeIdlePlayback(direction: number): AnimationPlayback {
    return { sequenceKey: 'idle', direction, currentFrame: 0, elapsedMs: 0, loop: true, playing: true };
}

export class TowerBowmanRenderPass implements PluggableRenderPass {
    private ctx!: PassContext;
    public lastDrawCalls = 0;
    public lastSpriteCount = 0;

    constructor(
        private readonly garrisonManager: TowerGarrisonManager,
        private readonly gameState: GameState,
        private readonly towerBowmanTargets: ReadonlyMap<number, number>
    ) {}

    prepare(ctx: PassContext): void {
        this.ctx = ctx;
    }

    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) return;

        this.lastSpriteCount = 0;

        ctx.spriteManager.spriteAtlas!.bindForRendering(gl);
        ctx.spriteManager.paletteManager.bind(gl);
        const rowsPerPlayer = ctx.spriteManager.paletteManager.textureRowsPerPlayer;
        ctx.spriteBatchRenderer.beginSpriteBatch(
            gl, projection, PALETTE_TEXTURE_WIDTH, rowsPerPlayer, ctx.renderSettings.antialias
        );

        // Iterate all buildings in the game state that have garrisons with bowmen
        for (const entity of ctx.sortedEntities) {
            if (entity.type !== EntityType.Building) continue;

            const garrison = this.garrisonManager.getGarrison(entity.id);
            if (!garrison || garrison.bowmanSlots.unitIds.length === 0) continue;

            const slotPositions = getBowmanSlotPositions(entity.subType as BuildingType, entity.race);
            if (!slotPositions) continue;

            // Compute tower screen position (same as entity-sprite-pass for buildings)
            const worldPos = TilePicker.tileToWorld(
                entity.x, entity.y,
                ctx.groundHeight, ctx.mapSize,
                viewPoint.x, viewPoint.y
            );
            const towerX = worldPos.worldX - TILE_CENTER_X;
            const towerY = worldPos.worldY - TILE_CENTER_Y * 0.5;

            this.emitBowmenSprites(gl, entity.id, garrison.bowmanSlots.unitIds, slotPositions, towerX, towerY);
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);
    }

    private emitBowmenSprites(
        gl: WebGL2RenderingContext,
        buildingId: number,
        bowmanIds: readonly number[],
        slotPositions: readonly BowmanSlotPosition[],
        towerX: number,
        towerY: number
    ): void {
        const { ctx } = this;

        for (let i = 0; i < bowmanIds.length; i++) {
            const bowmanId = bowmanIds[i]!;
            const slot = slotPositions[i];
            if (!slot) continue;

            const bowman = this.gameState.getEntityOrThrow(bowmanId, 'TowerBowmanRenderPass');
            const unitType = bowman.subType as UnitType;
            const race = bowman.race;

            // Face target if attacking, otherwise use XML default direction for this slot
            const targetId = this.towerBowmanTargets.get(bowmanId);
            let direction = slot.direction;
            if (targetId !== undefined) {
                const target = this.gameState.getEntity(targetId);
                if (target) {
                    const tower = this.gameState.getEntityOrThrow(buildingId, 'TowerBowmanRenderPass.direction');
                    direction = getApproxDirection(tower.x, tower.y, target.x, target.y);
                }
            }

            const spriteDir = toSpriteDirection(direction);
            const playback = makeIdlePlayback(direction);

            const sprite = ctx.spriteResolver.getUnitSpriteForDirection(unitType, playback, spriteDir, race);
            if (!sprite) continue;

            const x = towerX + slot.offsetX;
            const y = towerY + slot.offsetY;

            ctx.spriteBatchRenderer.addSprite(
                gl, x, y, sprite,
                ctx.renderSettings.disablePlayerTinting ? 0 : bowman.player + 1,
                TINT_NEUTRAL[0]!, TINT_NEUTRAL[1]!, TINT_NEUTRAL[2]!, TINT_NEUTRAL[3]!
            );
            this.lastSpriteCount++;
        }
    }
}

// ============================================================================
// RenderPassDefinition factory
// ============================================================================

export function createTowerBowmanRenderPassDefinition(
    garrisonManager: TowerGarrisonManager,
    gameState: GameState,
    towerBowmanTargets: ReadonlyMap<number, number>
): RenderPassDefinition {
    return {
        id: 'tower-bowman',
        layer: RenderLayer.AboveEntities,
        needs: { sprites: true },
        create: () => new TowerBowmanRenderPass(garrisonManager, gameState, towerBowmanTargets),
    };
}
