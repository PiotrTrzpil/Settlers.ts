/**
 * EntityLayerOrchestrator — wraps EntitySpritePass, TransitionBlendPass, and
 * ColorEntityPass into a single PluggableRenderPass at RenderLayer.Entities.
 *
 * Handles the special coordination between the three passes:
 * - EntitySpritePass holds a reference to TransitionBlendPass (internal wiring)
 * - Color pass texturedBuildingsHandled flag depends on sprite availability
 * - Shader switching between sprite and color passes is managed here
 *
 * From the registry's perspective this is one pass at RenderLayer.Entities.
 */

import type { IViewPoint } from '../i-view-point';
import type { PassContext, PluggableRenderPass, DebugEntityLabel, RenderPassDeps } from './types';
import { EntitySpritePass } from './entity-sprite-pass';
import { TransitionBlendPass } from './transition-blend-pass';
import { ColorEntityPass } from './color-entity-pass';

export interface EntityLayerOrchestratorConfig {
    setupColorShader: (gl: WebGL2RenderingContext, projection: Float32Array) => void;
}

export class EntityLayerOrchestrator implements PluggableRenderPass {
    private readonly passTransitionBlend: TransitionBlendPass;
    private readonly passEntitySprite: EntitySpritePass;
    private readonly passColorEntity: ColorEntityPass;

    private readonly setupColorShader: (gl: WebGL2RenderingContext, projection: Float32Array) => void;

    /** Whether sprites were available when prepare() last ran — drives texturedBuildingsHandled. */
    private spritesAvailable = false;

    /** Stores reference to the last prepared context's debugDecoLabels array. */
    private preparedCtxDecoLabels: DebugEntityLabel[] = [];

    /** Total draw calls emitted by the sprite sub-pass in the last frame. */
    public lastDrawCalls = 0;
    /** Total sprite count from the sprite sub-pass in the last frame. */
    public lastSpriteCount = 0;

    /** Timing breakdown for profiler/debug overlay (milliseconds). */
    public readonly timings: { textured: number; color: number } = { textured: 0, color: 0 };

    /** Debug labels collected by the color pass — forwarded to the parent renderer. */
    public get debugDecoLabels(): DebugEntityLabel[] {
        return this.preparedCtxDecoLabels;
    }

    constructor(_deps: RenderPassDeps, config: EntityLayerOrchestratorConfig) {
        this.setupColorShader = config.setupColorShader;

        this.passTransitionBlend = new TransitionBlendPass();
        this.passEntitySprite = new EntitySpritePass(this.passTransitionBlend);
        this.passColorEntity = new ColorEntityPass();
    }

    public prepare(ctx: PassContext): void {
        // Capture sprite availability from the context before delegating.
        // This mirrors the check in EntitySpritePass.draw() and EntityRenderer.draw().
        this.spritesAvailable = !!(ctx.spriteManager?.hasSprites && ctx.spriteBatchRenderer.isInitialized);
        this.preparedCtxDecoLabels = ctx.debugDecoLabels;

        this.passTransitionBlend.prepare(ctx);
        this.passEntitySprite.prepare(ctx);
        this.passColorEntity.prepare(ctx);
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (this.spritesAvailable) {
            const texturedStart = performance.now();
            this.passEntitySprite.draw(gl, projection, viewPoint);
            this.timings.textured = performance.now() - texturedStart;

            this.setupColorShader(gl, projection);
            const colorStart = performance.now();
            this.passColorEntity.texturedBuildingsHandled = true;
            this.passColorEntity.draw(gl, projection, viewPoint);
            this.timings.color = performance.now() - colorStart;
        } else {
            this.timings.textured = 0;
            this.setupColorShader(gl, projection);
            const colorStart = performance.now();
            this.passColorEntity.texturedBuildingsHandled = false;
            this.passColorEntity.draw(gl, projection, viewPoint);
            this.timings.color = performance.now() - colorStart;
        }

        this.lastDrawCalls = this.passEntitySprite.lastDrawCalls;
        this.lastSpriteCount = this.passEntitySprite.lastSpriteCount;
    }
}
