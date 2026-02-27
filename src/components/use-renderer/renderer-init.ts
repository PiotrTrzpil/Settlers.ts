/**
 * Renderer initialization — async resource loading and e2e test bridge.
 */

import type { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import type { ViewPoint } from '@/game/renderer/view-point';
import type { InputManager } from '@/game/input';
import { debugStats } from '@/game/debug-stats';

/**
 * Initialize renderers asynchronously (landscape first for camera, then sprites).
 */
export async function initRenderersAsync(
    gl: WebGL2RenderingContext,
    landscapeRenderer: LandscapeRenderer,
    indicatorRenderer: BuildingIndicatorRenderer,
    entityRenderer: EntityRenderer
): Promise<void> {
    // Start IndexedDB cache read in parallel with landscape init
    entityRenderer.spriteManager?.prefetchCache();

    // Yield before landscape — lets prefetch promise microtasks run
    await Promise.resolve();

    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    // Yield after landscape — lets prefetch arrayBuffer() resolve before sprite restore
    await Promise.resolve();

    await indicatorRenderer.init(gl);
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
