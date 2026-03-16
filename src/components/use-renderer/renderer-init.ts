/**
 * Renderer initialization — async resource loading and e2e test bridge.
 */

import type { LandscapeRenderer } from '@/game/renderer/landscape/landscape-renderer';
import type { EntityRenderer } from '@/game/renderer/entity-renderer';
import type { BuildingIndicatorRenderer } from '@/game/renderer/building-indicator-renderer';
import type { ViewPoint } from '@/game/renderer/view-point';
import type { InputManager } from '@/game/input';
import { AVAILABLE_RACES } from '@/game/renderer/sprite-metadata';
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

/**
 * After building sprites finish loading, load overlay sprites for all races
 * and update the BuildingOverlayManager with the resolved frame counts.
 */
export async function loadOverlaySpritesAndUpdateFrameCounts(er: EntityRenderer, game: Game): Promise<void> {
    const spriteManager = er.spriteManager!;

    // Collect sprite refs for all races (overlays live in each race's GFX file)
    const manifest: { gfxFile: number; jobIndex: number; directionIndex?: number }[] = [];
    for (const race of AVAILABLE_RACES) {
        for (const def of game.services.overlayRegistry.getSpriteManifest(race)) {
            manifest.push(def.spriteRef);
        }
    }
    if (manifest.length === 0) {
        return;
    }

    // Check if overlays are already in the registry (cache hit with full overlay data).
    // Use .some() across the whole manifest — the first entry may fail to load (missing GFX job),
    // so checking only manifest[0] would trigger a reload every time.
    const alreadyLoaded = manifest.some(
        e => spriteManager.spriteRegistry?.getOverlayFrames(e.gfxFile, e.jobIndex, e.directionIndex ?? 0) !== null
    );

    if (!alreadyLoaded) {
        const tOverlay = performance.now();
        await spriteManager.loadOverlaySprites(manifest);
        debugStats.state.loadTimings.overlaySprites = Math.round(performance.now() - tOverlay);
        // Save cache now that overlays are included — subsequent hits skip overlay loading entirely.
        spriteManager.saveCache();
    }

    // Always update frame counts (cheap read from registry, no loading).
    for (const race of AVAILABLE_RACES) {
        for (const def of game.services.overlayRegistry.getSpriteManifest(race)) {
            const { gfxFile, jobIndex, directionIndex = 0 } = def.spriteRef;
            const frames = spriteManager.spriteRegistry?.getOverlayFrames(gfxFile, jobIndex, directionIndex);
            if (frames && frames.length > 0) {
                game.services.buildingOverlayManager.setFrameCountForDef(
                    gfxFile,
                    jobIndex,
                    directionIndex,
                    frames.length
                );
            }
        }
    }

    // Flag sprites are player-colored (not JIL-based) — update their frame count separately.
    game.services.buildingOverlayManager.setFlagFrameCount(spriteManager.spriteRegistry?.getFlagFrameCount(0) ?? 0);
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
