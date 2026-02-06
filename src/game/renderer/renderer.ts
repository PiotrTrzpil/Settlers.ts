import { LogHandler } from '@/utilities/log-handler';
import { IRenderer } from './i-renderer';
import { Matrix } from './landscape/matrix';
import { ViewPoint } from './view-point';

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
    private gl: WebGL2RenderingContext | null = null;
    private renderers: IRenderer[] = [];
    private animRequest = 0;
    public viewPoint: ViewPoint;

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

        let newGl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
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

        this.gl = newGl;

        Object.seal(this);
    }

    public destroy(): void {
        this.gl = null;
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
        const projection = Matrix
            .createOrthographic(-aspect, aspect, 1, -1, -1, 1)
            .scale(zoomV, zoomV, 1.0)
            .translate(-zoomV, zoomV, 0);

        // draw all renderers
        for (const r of this.renderers) {
            r.draw(gl, projection.mat, this.viewPoint);
        }
    }

    /** Initializes all sub-renderers and triggers the first draw */
    public async init(): Promise<void> {
        if (!this.gl) {
            return;
        }

        const totalStart = performance.now();
        Renderer.log.debug('=== Renderer init starting ===');

        for (const r of this.renderers) {
            const name = r.constructor.name;
            const start = performance.now();
            try {
                await r.init(this.gl);
                Renderer.log.debug(`${name} init: ${Math.round(performance.now() - start)}ms`);
            } catch (e) {
                Renderer.log.error('Renderer init failed', e instanceof Error ? e : new Error(String(e)));
            }
        }

        Renderer.log.debug(`=== Renderer init complete: ${Math.round(performance.now() - totalStart)}ms ===`);
        this.requestDraw();
    }

    public add(newRenderer: IRenderer): void {
        this.renderers.push(newRenderer);
    }

    /** Clear all renderers (call before adding new ones on game change) */
    public clear(): void {
        this.renderers = [];
    }
}
