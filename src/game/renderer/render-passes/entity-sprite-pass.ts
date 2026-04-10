/**
 * EntitySpritePass — draws entities using the sprite atlas (textured batch).
 *
 * For each visible entity resolves the sprite and either:
 *   - emits a sprite quad into the batch renderer, or
 *   - queues the entity into TransitionBlendPass for cross-fade rendering.
 *
 * Building overlays (flags, smoke, construction backgrounds) are also emitted here
 * at the correct render layer relative to their parent building.
 */

import { EntityType } from '@/game/entity';
import type { Entity } from '@/game/entity';
import type { IViewPoint } from '../i-view-point';
import type { IRenderPass, EntitySpriteContext } from './types';
import type { TransitionBlendPass } from './transition-blend-pass';
import { scaleSprite, getSpriteScale } from '../entity-renderer-constants';
import { getRenderEntityWorldPos } from '../world-position';
import { TINT_NEUTRAL, TINT_SELECTED } from '../tint-utils';
import { OverlayRenderLayer } from '../render-context';
import type { BuildingOverlayRenderData } from '../render-context';
import type { SpriteEntry } from '../sprite-metadata';
import { profiler } from '../debug/render-profiler';
import { resolveSelectionIndicator, resolveHealthDot, resolveBuildingSelectionIndicator } from '../selection-indicator';
import { calculateFootprintBounds } from '../selection-overlay-renderer';
import { getBuildingFootprint, BuildingType } from '@/game/entity';

const EMPTY_OVERLAYS: readonly BuildingOverlayRenderData[] = [];

export class EntitySpritePass implements IRenderPass {
    private ctx!: EntitySpriteContext;
    private readonly blendPass: TransitionBlendPass;

    /** Draw calls emitted by this pass (updated each frame). */
    public lastDrawCalls = 0;
    /** Sprites emitted (updated each frame). */
    public lastSpriteCount = 0;

    constructor(blendPass: TransitionBlendPass) {
        this.blendPass = blendPass;
    }

    public prepare(ctx: EntitySpriteContext): void {
        this.ctx = ctx;
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (!ctx.spriteManager?.hasSprites || !ctx.spriteBatchRenderer.isInitialized) {
            return;
        }

        profiler.beginPhase('textured');

        // Enable alpha-to-coverage for smooth sprite edges when MSAA is active
        const samples = gl.getParameter(gl.SAMPLES) as number;
        const useAlphaToCoverage = samples > 1;
        if (useAlphaToCoverage) {
            gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        }

        ctx.spriteBatchRenderer.beginWithAtlas(gl, projection, ctx.spriteManager, ctx.renderSettings.antialias);

        this.lastSpriteCount = 0;

        for (const entity of ctx.sortedEntities) {
            const resolved = ctx.spriteResolver.resolve(entity);
            if (resolved.skip) {
                continue;
            }
            if (resolved.transitioning && resolved.transitionData) {
                this.blendPass.queueTransition(entity, resolved.transitionData);
                continue;
            }
            if (!resolved.sprite) {
                continue;
            }

            const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);
            this.emitEntitySprite(gl, entity, resolved, worldPos);
        }

        // Emit selection indicator sprites on top of all entities
        if (ctx.selectedEntityIds.size > 0) {
            this.emitSelectionIndicators(gl, viewPoint);
        }

        this.lastDrawCalls = ctx.spriteBatchRenderer.endSpriteBatch(gl);

        if (useAlphaToCoverage) {
            gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        }

        profiler.endPhase('textured');

        // Blend pass draws immediately after (uses a different shader)
        this.blendPass.draw(gl, projection, viewPoint);
    }

    private emitEntitySprite(
        gl: WebGL2RenderingContext,
        entity: Entity,
        resolved: { sprite: SpriteEntry | null; progress: number },
        worldPos: { worldX: number; worldY: number }
    ): void {
        const { ctx } = this;
        const hasPlayer = entity.type === EntityType.Building || entity.type === EntityType.Unit;
        const tintedRow = ctx.renderSettings.disablePlayerTinting ? 0 : entity.player + 1;
        const playerRow = hasPlayer ? tintedRow : 0;
        const isSelected = ctx.selectedEntityIds.has(entity.id);
        const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;
        const scale = getSpriteScale(entity);

        const overlays = entity.type === EntityType.Building ? ctx.getBuildingOverlays(entity.id) : EMPTY_OVERLAYS;
        if (overlays.length > 0) {
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.BehindBuilding);
        }

        const sprite = scaleSprite(resolved.sprite!, scale);

        if (resolved.progress < 1.0) {
            ctx.spriteBatchRenderer.addSpritePartial(
                gl,
                worldPos.worldX,
                worldPos.worldY,
                sprite,
                playerRow,
                tint,
                resolved.progress
            );
        } else {
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, sprite, playerRow, tint);
        }
        this.lastSpriteCount++;

        if (overlays.length > 0) {
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.AboveBuilding);
        }
    }

    private emitOverlaysForLayer(
        gl: WebGL2RenderingContext,
        overlays: readonly BuildingOverlayRenderData[],
        buildingWorldPos: { worldX: number; worldY: number },
        playerRow: number,
        layer: OverlayRenderLayer
    ): void {
        const { ctx } = this;
        for (const overlay of overlays) {
            if (overlay.layer !== layer) {
                continue;
            }
            const x = buildingWorldPos.worldX + overlay.worldOffsetX;
            const y = buildingWorldPos.worldY + overlay.worldOffsetY;
            const row = overlay.teamColored ? playerRow : 0;
            if (overlay.verticalProgress < 1.0) {
                ctx.spriteBatchRenderer.addSpritePartial(
                    gl,
                    x,
                    y,
                    overlay.sprite,
                    row,
                    TINT_NEUTRAL,
                    overlay.verticalProgress
                );
            } else {
                ctx.spriteBatchRenderer.addSprite(gl, x, y, overlay.sprite, row, TINT_NEUTRAL);
            }
            this.lastSpriteCount++;
        }
    }

    /**
     * Emit selection indicator sprites for all selected units.
     * Drawn after all entity sprites so they appear on top.
     * Positioned at the top of the unit sprite (above the head).
     * Sprites are zoom-compensated to stay at a constant screen size.
     *
     * Also emits a health dot centered in the bracket for military units.
     */
    private emitSelectionIndicators(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        for (const entity of this.ctx.sortedEntities) {
            if (!this.ctx.selectedEntityIds.has(entity.id)) {
                continue;
            }
            if (entity.type === EntityType.Building) {
                this.emitBuildingSelectionIndicator(gl, entity, viewPoint);
            } else if (entity.type === EntityType.Unit) {
                this.emitUnitSelectionIndicator(gl, entity, viewPoint);
            }
        }
    }

    private emitUnitSelectionIndicator(gl: WebGL2RenderingContext, entity: Entity, viewPoint: IViewPoint): void {
        const { ctx } = this;
        const zoom = viewPoint.zoom;

        const result = resolveSelectionIndicator(entity, ctx.spriteManager!, zoom);
        if (!result) {
            return;
        }

        // Resolve the unit's own sprite to find where its top edge is
        const resolved = ctx.spriteResolver.resolve(entity);
        if (!resolved.sprite) {
            return;
        }
        const unitSprite = scaleSprite(resolved.sprite, getSpriteScale(entity));

        const worldPos = getRenderEntityWorldPos(entity, ctx, viewPoint);

        // Place indicator centered on the upper portion of the unit sprite
        const baseY = worldPos.worldY + unitSprite.offsetY * 0.8;
        ctx.spriteBatchRenderer.addSprite(
            gl,
            worldPos.worldX + result.offsetX,
            baseY + result.offsetY,
            result.sprite,
            0,
            TINT_NEUTRAL
        );
        this.lastSpriteCount++;

        // Health dot — always centered on the unit, unaffected by bracket nudge
        const healthRatio = ctx.getHealthRatio(entity.id);
        if (healthRatio !== null) {
            const dot = resolveHealthDot(healthRatio, ctx.spriteManager!, zoom);
            ctx.spriteBatchRenderer.addSprite(gl, worldPos.worldX, baseY, dot, 0, TINT_NEUTRAL);
            this.lastSpriteCount++;
        }
    }

    private emitBuildingSelectionIndicator(gl: WebGL2RenderingContext, entity: Entity, viewPoint: IViewPoint): void {
        const { ctx } = this;
        if (!ctx.spriteManager) {
            return;
        }

        const footprint = getBuildingFootprint(entity, entity.subType as BuildingType, entity.race);
        const bounds = calculateFootprintBounds(footprint, ctx.mapSize, ctx.groundHeight, viewPoint.x, viewPoint.y);

        const indicator = resolveBuildingSelectionIndicator(bounds, ctx.spriteManager);

        // Center horizontally; align to top of footprint vertically so the frame
        // appears over the building rather than sunken into the ground tiles.
        const centerX = (bounds.minX + bounds.maxX) / 2;
        ctx.spriteBatchRenderer.addSprite(gl, centerX, bounds.minY, indicator, 0, TINT_NEUTRAL);
        this.lastSpriteCount++;
    }
}
