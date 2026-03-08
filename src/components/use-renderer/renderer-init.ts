/**
 * Renderer initialization — async resource loading and e2e test bridge.
 */

import type { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import type { ViewPoint } from '@/game/renderer/view-point';
import type { InputManager } from '@/game/input';
import { debugStats } from '@/game/debug/debug-stats';
import type { Race } from '@/game/core/race';
import type { Game } from '@/game/game';

/** Radius (in tiles) around player start to scan for nearby entities */
const NEARBY_ENTITY_RADIUS = 40;

/**
 * Initialize renderers asynchronously (landscape first for camera, then sprites).
 * @param localPlayerRace Race of the local player — required for sprite loading. Null for test maps (no sprites loaded).
 * @param game Game instance — used to compute nearby entities for layer priority.
 */
export async function initRenderersAsync(
    gl: WebGL2RenderingContext,
    landscapeRenderer: LandscapeRenderer,
    indicatorRenderer: BuildingIndicatorRenderer,
    entityRenderer: EntityRenderer,
    localPlayerRace: Race | null,
    game: Game | null
): Promise<void> {
    // Set race before prefetch so the cache uses the correct IDB key
    if (localPlayerRace !== null) {
        entityRenderer.setInitialRace(localPlayerRace);
    }

    // Compute entities near player start for layer priority (before prefetch)
    if (game && entityRenderer.spriteManager) {
        const startPos = game.findPlayerStartPosition();
        if (startPos) {
            const r = NEARBY_ENTITY_RADIUS;
            const nearby = game.state.getEntitiesInRect(startPos.x - r, startPos.y - r, startPos.x + r, startPos.y + r);
            entityRenderer.spriteManager.setNearbyEntities(nearby);
        }
    }

    // Start Cache API read in worker — overlaps with landscape init
    entityRenderer.spriteManager?.prefetchCache();

    // Yield before landscape — lets prefetch promise microtasks run
    await Promise.resolve();

    const t0 = performance.now();
    await landscapeRenderer.init(gl);
    debugStats.state.loadTimings.landscape = Math.round(performance.now() - t0);
    debugStats.state.gameLoaded = true;

    // Yield after landscape — lets prefetch resolve before sprite restore
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
