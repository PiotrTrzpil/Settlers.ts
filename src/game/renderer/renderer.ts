import { LogHandler } from '@/utilities/log-handler';
import { IRenderer } from './i-renderer';
import { ViewPoint } from './view-point';
import type { EntityRenderer } from './entity-renderer';
import { gameSettings } from '@/game/game-settings';

/** Detailed render timing for a single frame */
export interface FrameRenderTiming {
    /** Total GPU render time in ms */
    render: number;
    /** Landscape render time in ms */
    landscape: number;
    /** All entities draw time in ms */
    entities: number;
    /** Entity culling and sorting time in ms */
    cullSort: number;
    /** Number of visible entities */
    visibleCount: number;
    /** Number of draw calls */
    drawCalls: number;
    /** Number of sprites rendered */
    spriteCount: number;
    /** Building indicators draw time in ms */
    indicators: number;
    /** Textured sprites draw time in ms */
    textured: number;
    /** Color fallback draw time in ms */
    color: number;
    /** Selection overlay draw time in ms */
    selection: number;
}

declare let WebGLDebugUtils: any;

/**
 * Options for Renderer constructor.
 */
export interface RendererOptions {
    /**
     * If true, ViewPoint will not attach its own event listeners.
     * Use when integrating with an external InputManager.
     */
    externalInput?: boolean;
}

/** Manages the WebGL context and the IRenderers that draw to it */
export class Renderer {
    private static log = new LogHandler('Renderer');
    public canvas: HTMLCanvasElement;
    private _gl: WebGL2RenderingContext | null = null;
    private renderers: IRenderer[] = [];
    private animRequest = 0;
    public viewPoint: ViewPoint;

    // Pre-allocated projection matrix to avoid GC pressure during rendering
    private readonly projectionMatrix = new Float32Array(16);

    /** Timing data from the last draw call */
    private lastRenderTiming: FrameRenderTiming = {
        render: 0, landscape: 0, entities: 0, cullSort: 0,
        visibleCount: 0, drawCalls: 0, spriteCount: 0,
        indicators: 0, textured: 0, color: 0, selection: 0,
    };

    /** Get the WebGL2 context */
    public get gl(): WebGL2RenderingContext | null {
        return this._gl;
    }

    constructor(canvas: HTMLCanvasElement, options?: RendererOptions) {
        const webGlogger = new LogHandler('WebGL');

        function processWebGlDebugErrors(err: any, funcName: string, args: any) {
            const argString = WebGLDebugUtils.glFunctionArgsToString(funcName, args) ?? '';

            webGlogger.error(WebGLDebugUtils.glEnumToString(err) +
            ' was caused by calling: ' + funcName + ' ' +
            argString.substring(0, 300));
        }

        this.canvas = canvas;
        this.viewPoint = new ViewPoint(canvas, { externalInput: options?.externalInput });
        // Note: onMove callback removed - the game loop now drives all rendering via drawOnce()

        const antialias = gameSettings.state.antialias;
        let newGl = canvas.getContext('webgl2', { antialias, preserveDrawingBuffer: true });
        if (!newGl) {
            Renderer.log.error('Unable to initialize WebGL2. Your browser may not support it.');
            return;
        }

        try {
            if (WebGLDebugUtils) {
                Renderer.log.debug('Run with WebGL debug');
                newGl = WebGLDebugUtils.makeDebugContext(newGl, processWebGlDebugErrors) as WebGL2RenderingContext | null;
            }
        } catch {
            // WebGLDebugUtils is optional; not available in production
        }

        this._gl = newGl;

        Object.seal(this);
    }

    public destroy(): void {
        // Cancel any pending animation frame
        if (this.animRequest) {
            cancelAnimationFrame(this.animRequest);
            this.animRequest = 0;
        }
        // Clean up all child renderers first
        this.clear();
        this._gl = null;
        this.viewPoint.destroy();
    }

    /** Perform a single draw call (used by game loop) */
    public drawOnce(): void {
        this.draw();
    }

    public requestDraw(): void {
        if (this.animRequest) {
            return;
        }

        this.animRequest = requestAnimationFrame(() => {
            this.animRequest = 0;
            this.draw();
        });
    }

    private draw() {
        const gl = this.gl;
        if (!gl) {
            return;
        }

        // Sync the drawing buffer to the canvas display size, accounting for
        // HiDPI displays so the rendered image is crisp on retina screens.
        const canvas = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = Math.round(canvas.clientWidth * dpr);
        const displayHeight = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const zoomV = this.viewPoint.zoom;
        const aspect = canvas.width / canvas.height;

        // Compute projection matrix in-place to avoid allocations
        // Equivalent to: orthographic(-aspect, aspect, 1, -1, -1, 1) * scale(zoomV) * translate(-zoomV, zoomV, 0)
        // ortho: 2/(right-left)=1/aspect, 2/(top-bottom)=-1, 2/(near-far)=-1
        // Note: top=-1, bottom=1 in original ortho, so Y is inverted (sy = -zoomV)
        const m = this.projectionMatrix;
        const sx = zoomV / aspect;
        const sy = -zoomV;  // Negative because top < bottom in ortho params
        m[0] = sx;
        m[1] = 0;
        m[2] = 0;
        m[3] = 0;
        m[4] = 0;
        m[5] = sy;
        m[6] = 0;
        m[7] = 0;
        m[8] = 0;
        m[9] = 0;
        m[10] = -1;
        m[11] = 0;
        m[12] = -zoomV;  // translate X component
        m[13] = zoomV;   // translate Y component
        m[14] = 0;
        m[15] = 1;

        // draw all renderers with timing
        const frameStart = performance.now();
        let landscapeTime = 0;
        let entityTiming = {
            cullSort: 0, entities: 0, visibleCount: 0, drawCalls: 0, spriteCount: 0,
            indicators: 0, textured: 0, color: 0, selection: 0,
        };

        for (let i = 0; i < this.renderers.length; i++) {
            const r = this.renderers[i];
            const start = performance.now();
            r.draw(gl, m, this.viewPoint);
            const elapsed = performance.now() - start;

            // First renderer is typically LandscapeRenderer
            if (i === 0) {
                landscapeTime = elapsed;
            }
            // Second renderer is typically EntityRenderer - collect detailed timing
            if (i === 1 && 'getLastFrameTiming' in r) {
                entityTiming = (r as EntityRenderer).getLastFrameTiming();
            }
        }

        const totalTime = performance.now() - frameStart;

        // Store timing for retrieval by game loop
        this.lastRenderTiming.render = totalTime;
        this.lastRenderTiming.landscape = landscapeTime;
        this.lastRenderTiming.cullSort = entityTiming.cullSort;
        this.lastRenderTiming.entities = entityTiming.entities;
        this.lastRenderTiming.visibleCount = entityTiming.visibleCount;
        this.lastRenderTiming.drawCalls = entityTiming.drawCalls;
        this.lastRenderTiming.spriteCount = entityTiming.spriteCount;
        this.lastRenderTiming.indicators = entityTiming.indicators;
        this.lastRenderTiming.textured = entityTiming.textured;
        this.lastRenderTiming.color = entityTiming.color;
        this.lastRenderTiming.selection = entityTiming.selection;
    }

    /** Get timing data from the last draw call */
    public getLastRenderTiming(): FrameRenderTiming {
        return this.lastRenderTiming;
    }

    /** Initializes all sub-renderers and triggers the first draw */
    public async init(): Promise<void> {
        if (!this.gl) {
            return;
        }

        for (const r of this.renderers) {
            try {
                await r.init(this.gl);
            } catch (e) {
                Renderer.log.error('Renderer init failed', e instanceof Error ? e : new Error(String(e)));
            }
        }
        this.requestDraw();
    }

    public add(newRenderer: IRenderer): void {
        this.renderers.push(newRenderer);
    }

    /** Clear all renderers, destroying their GPU resources (call before adding new ones on game change) */
    public clear(): void {
        for (const r of this.renderers) {
            r.destroy?.();
        }
        this.renderers = [];
    }
}
