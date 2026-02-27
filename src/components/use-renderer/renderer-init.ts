/**
 * Renderer initialization — async resource loading and e2e test bridge.
 */

import type { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import type { ViewPoint } from '@/game/renderer/view-point';
import type { InputManager } from '@/game/input';
import { debugStats } from '@/game/debug-stats';

/** Abort controller for the current init — cancelled when a new init starts or renderer is destroyed. */
let activeInitAbort: AbortController | null = null;

/**
 * Cancel any in-progress renderer initialization.
 * Call before starting a new init or on unmount to prevent stale async work.
 */
export function cancelRendererInit(): void {
    activeInitAbort?.abort();
    activeInitAbort = null;
}

/** Check if the init was cancelled (signal may be aborted by another call during await). */
function isCancelled(signal: AbortSignal): boolean {
    return signal.aborted;
}

/**
 * Initialize renderers asynchronously (landscape first for camera, then sprites).
 * Automatically cancels any previously running init to prevent stale work.
 */
export async function initRenderersAsync(
    gl: WebGL2RenderingContext,
    landscapeRenderer: LandscapeRenderer,
    indicatorRenderer: BuildingIndicatorRenderer,
    entityRenderer: EntityRenderer
): Promise<void> {
    // Cancel any previous in-progress init
    cancelRendererInit();
    const abort = new AbortController();
    activeInitAbort = abort;
    const { signal } = abort;

    // Start IndexedDB cache read in parallel with landscape init
    entityRenderer.spriteManager?.prefetchCache();

    // Yield before landscape — lets prefetch promise microtasks run
    await Promise.resolve();
    if (isCancelled(signal)) return;

    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    if (isCancelled(signal)) return;
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    // Yield after landscape — lets prefetch arrayBuffer() resolve before sprite restore
    await Promise.resolve();
    if (isCancelled(signal)) return;

    await indicatorRenderer.init(gl);
    if (isCancelled(signal)) return;
    await entityRenderer.init(gl);
    // Note: entityRenderer.init() returns immediately — sprites load in background.
    // markRendererReady() is called from the onSpritesLoaded callback instead.
}

/** Expose objects for e2e tests */
export function exposeForE2E(
    viewPoint: ViewPoint,
    landscapeRenderer: LandscapeRenderer,
    entityRenderer: EntityRenderer,
    inputManager: InputManager | null
): void {
    const bridge = (window.__settlers__ ??= {});
    bridge.viewpoint = viewPoint;
    bridge.landscape = landscapeRenderer;
    bridge.entityRenderer = entityRenderer;
    bridge.input = inputManager ?? undefined;
}
