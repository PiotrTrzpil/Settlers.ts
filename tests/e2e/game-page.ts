import { type Page, type Locator, expect } from '@playwright/test';
import { Frames, Timeout } from './wait-config';
import { WaitProfiler, type WaitCategory } from './wait-profiler';

/**
 * Mirrors LoadTimings from src/game/debug-stats.ts.
 */
interface LoadTimings {
    totalSprites: number;
    cacheHit: boolean;
    cacheSource: 'module' | 'indexeddb' | null;
}

/**
 * Mirrors DebugStatsState from src/game/debug-stats.ts.
 * Only the fields tests actually need — kept minimal to avoid drift.
 */
interface SettlersDebug {
    gameLoaded: boolean;
    rendererReady: boolean;
    frameCount: number;
    fps: number;
    entityCount: number;
    buildingCount: number;
    unitCount: number;
    unitsMoving: number;
    totalPathSteps: number;
    cameraX: number;
    cameraY: number;
    zoom: number;
    canvasWidth: number;
    canvasHeight: number;
    mode: string;
    selectedEntityId: number | null;
    selectedCount: number;
    // Audio state
    musicEnabled: boolean;
    musicPlaying: boolean;
    currentMusicId: string | null;
    // Load timings
    loadTimings: LoadTimings;
}

/**
 * Page Object Model for the Settlers.ts map view.
 *
 * Encapsulates navigation, waiting for game readiness, and
 * common assertions so E2E tests stay concise and readable.
 */
export class GamePage {
    readonly page: Page;
    readonly canvas: Locator;
    readonly gameUi: Locator;
    readonly entityCount: Locator;
    readonly modeIndicator: Locator;

    constructor(page: Page) {
        this.page = page;
        this.canvas = page.locator('canvas.cav');
        this.gameUi = page.locator('[data-testid="game-ui"]');
        this.entityCount = page.locator('[data-testid="entity-count"]');
        this.modeIndicator = page.locator('[data-testid="mode-indicator"]');
    }

    // ── Profiler Integration ─────────────────────────────────

    /**
     * Instrumented wrapper for page.waitForFunction with profiling.
     * Same signature as page.waitForFunction but with a label prefix.
     *
     * @param label - Format: "category:method:condition" e.g. "frame:waitForFrames:5 frames"
     */
    private async _waitForFunction<T>(
        label: string,
        pageFunction: (...args: any[]) => T | Promise<T>,
        arg?: any,
        options?: { timeout?: number }
    ): Promise<void> {
        const timeout = options?.timeout ?? Timeout.DEFAULT;

        if (!WaitProfiler.isEnabled()) {
            await this.page.waitForFunction(pageFunction as any, arg, options);
            return;
        }

        const [category, method, ...conditionParts] = label.split(':');
        const condition = conditionParts.join(':') || method;
        const startTime = performance.now();
        let timedOut = false;

        try {
            await this.page.waitForFunction(pageFunction as any, arg, options);
        } catch (error) {
            if (error instanceof Error && error.message.includes('Timeout')) {
                timedOut = true;
            }
            throw error;
        } finally {
            const endTime = performance.now();
            WaitProfiler.record({
                category: (category as WaitCategory) || 'state',
                method: method || 'waitForFunction',
                condition,
                startTime,
                endTime,
                duration: endTime - startTime,
                pollCount: 0,
                timedOut,
                timeout,
            });
        }
    }

    /**
     * Instrumented wrapper for any async wait operation.
     * @param label - Format: "category:method:condition"
     */
    private async _profiledWait<T>(
        label: string,
        timeout: number,
        fn: () => Promise<T>
    ): Promise<T> {
        if (!WaitProfiler.isEnabled()) {
            return fn();
        }

        const [category, method, ...conditionParts] = label.split(':');
        const condition = conditionParts.join(':') || method;
        const startTime = performance.now();
        let timedOut = false;

        try {
            return await fn();
        } catch (error) {
            if (error instanceof Error && error.message.includes('Timeout')) {
                timedOut = true;
            }
            throw error;
        } finally {
            const endTime = performance.now();
            WaitProfiler.record({
                category: (category as WaitCategory) || 'state',
                method: method || 'wait',
                condition,
                startTime,
                endTime,
                duration: endTime - startTime,
                pollCount: 0,
                timedOut,
                timeout,
            });
        }
    }

    // ── Navigation ──────────────────────────────────────────

    /** Navigate to the map view with an optional test map. */
    async goto(options: { testMap?: boolean } = {}): Promise<void> {
        const query = options.testMap ? '?testMap=true' : '';
        await this.page.goto(`/map-view${query}`);
    }

    // ── Waiting ─────────────────────────────────────────────

    /** Wait until the game UI is mounted in the DOM. */
    async waitForGameUi(timeout: number = Timeout.INITIAL_LOAD): Promise<void> {
        await this._profiledWait('dom:waitForGameUi:game UI visible', timeout, () =>
            this.gameUi.waitFor({ timeout })
        );
    }

    /**
     * Wait until the renderer has drawn at least `minFrames` **new** frames.
     * Uses relative counting (reads current frameCount first, then waits for
     * current + minFrames) so it works correctly with the shared fixture where
     * frameCount is already high from previous tests.
     *
     * **Optimized**: Uses browser-side requestAnimationFrame loop instead of
     * Playwright IPC polling. This reduces wait time from ~400ms to ~16ms per frame.
     *
     * @param minFrames - Number of frames to wait. Use Frames constants:
     *   - Frames.IMMEDIATE (1) - state already set, just need render tick
     *   - Frames.STATE_PROPAGATE (2) - camera move, mode switch
     *   - Frames.RENDER_SETTLE (5) - entity creation, basic rendering
     *   - Frames.ANIMATION_SETTLE (10) - animation state changes
     *   - Frames.VISUAL_STABLE (15) - screenshot comparisons
     */
    async waitForFrames(minFrames: number = Frames.RENDER_SETTLE, timeout: number = Timeout.INITIAL_LOAD): Promise<void> {
        await this._profiledWait(
            `frame:waitForFrames:${minFrames} frames`,
            timeout,
            () => this.page.evaluate(({ n, timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const debug = (window as any).__settlers_debug__;
                    const startFrame = debug?.frameCount ?? 0;
                    const targetFrame = startFrame + n;
                    const deadline = Date.now() + timeoutMs;

                    function checkFrame() {
                        const currentFrame = (window as any).__settlers_debug__?.frameCount ?? 0;
                        if (currentFrame >= targetFrame) {
                            resolve();
                        } else if (Date.now() > deadline) {
                            reject(new Error(
                                `Timeout waiting for ${n} frames: got ${currentFrame - startFrame}/${n} ` +
                                `(start=${startFrame}, current=${currentFrame}, target=${targetFrame})`
                            ));
                        } else {
                            requestAnimationFrame(checkFrame);
                        }
                    }
                    // Start checking on next frame
                    requestAnimationFrame(checkFrame);
                });
            }, { n: minFrames, timeoutMs: timeout })
        );
    }

    /**
     * Wait for game loaded + renderer ready + N frames rendered.
     *
     * **Optimized**: Single browser-side operation that:
     * 1. Polls for gameLoaded && rendererReady
     * 2. Then waits for N frames via requestAnimationFrame
     * All in one IPC call, eliminating ~400ms overhead.
     *
     * Note: We skip the DOM element wait (waitForGameUi) here because:
     * 1. The gameLoaded flag is only set AFTER the Vue component mounts
     * 2. By the time gameLoaded && rendererReady is true, the DOM is ready
     * 3. JS-based polling is faster than DOM element polling (~2s savings)
     */
    async waitForReady(minFrames: number = Frames.RENDER_SETTLE, timeout: number = Timeout.INITIAL_LOAD): Promise<void> {
        await this._profiledWait(
            `frame:waitForReady:gameLoaded && rendererReady + ${minFrames} frames`,
            timeout,
            () => this.page.evaluate(({ n, timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + timeoutMs;
                    let startFrame: number | null = null;

                    function checkReady() {
                        const debug = (window as any).__settlers_debug__;
                        const now = Date.now();

                        if (now > deadline) {
                            const state = debug
                                ? `gameLoaded=${debug.gameLoaded}, rendererReady=${debug.rendererReady}`
                                : 'debug not available';
                            reject(new Error(`Timeout waiting for game ready: ${state}`));
                            return;
                        }

                        // Phase 1: Wait for game to be loaded and renderer ready
                        if (!debug || !debug.gameLoaded || !debug.rendererReady) {
                            requestAnimationFrame(checkReady);
                            return;
                        }

                        // Phase 2: Once ready, wait for N frames
                        if (startFrame === null) {
                            startFrame = debug.frameCount ?? 0;
                        }

                        const currentFrame = debug.frameCount ?? 0;
                        const base = startFrame as number; // Narrowed after null check
                        const targetFrame = base + n;

                        if (currentFrame >= targetFrame) {
                            resolve();
                        } else if (now > deadline) {
                            reject(new Error(
                                `Timeout waiting for ${n} frames after ready: ` +
                                `got ${currentFrame - base}/${n}`
                            ));
                        } else {
                            requestAnimationFrame(checkReady);
                        }
                    }
                    requestAnimationFrame(checkReady);
                });
            }, { n: minFrames, timeoutMs: timeout })
        );
    }

    // ── State reset ───────────────────────────────────────────

    /**
     * Remove user-placed entities (buildings, units, resources) but preserve
     * environment objects (trees, stones). Resets mode to 'select'.
     */
    async resetGameState(): Promise<void> {
        await this.page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;
            // Remove only user-placed entities (type 1=Unit, 2=Building, 4=Resource)
            // Keep environment objects (type 3) which are part of the map
            const userEntities = game.state.entities.filter(
                (e: any) => e.type === 1 || e.type === 2 || e.type === 4
            );
            for (const e of userEntities) {
                game.execute({ type: 'remove_entity', entityId: e.id });
            }
            // Reset mode via InputManager
            const input = (window as any).__settlers_input__;
            if (input && input.getModeName() !== 'select') {
                input.switchMode('select');
            }
        });
        // Wait for state to settle - use longer timeout for parallel runs
        await this.waitForFrames(Frames.IMMEDIATE, Timeout.DEFAULT);
    }

    // ── Debug bridge reads ──────────────────────────────────

    /** Read the full debug state object from the page. */
    async getDebug(): Promise<SettlersDebug> {
        return this.page.evaluate(() => {
            const d = (window as any).__settlers_debug__;
            // Return a plain object (the Vue reactive proxy can't be serialised)
            return { ...d };
        });
    }

    /** Read a single debug field. */
    async getDebugField<K extends keyof SettlersDebug>(key: K): Promise<SettlersDebug[K]> {
        return this.page.evaluate(
            (k) => (window as any).__settlers_debug__?.[k],
            key,
        );
    }

    // ── Structured data-* attribute reads ───────────────────

    async getEntityCount(): Promise<number> {
        const val = await this.entityCount.getAttribute('data-count');
        return Number(val);
    }

    async getMode(): Promise<string> {
        const val = await this.modeIndicator.getAttribute('data-mode');
        return val ?? '';
    }

    // ── Actions ─────────────────────────────────────────────

    async clickButton(testId: string): Promise<void> {
        await this.page.locator(`[data-testid="${testId}"]`).click();
    }

    async pause(): Promise<void> {
        await this.clickButton('btn-pause');
    }

    async selectMode(): Promise<void> {
        // Use force: true to bypass stability checks (button may have CSS transitions)
        await this.page.locator('[data-testid="btn-select-mode"]').click({ force: true });
    }

    // ── Game state (via __settlers_game__) ─────────────────

    /**
     * Set game speed multiplier. Higher values = faster simulation.
     * Useful for speeding up movement tests.
     * @param speed - Speed multiplier (1.0 = normal, 4.0 = 4x faster)
     */
    async setGameSpeed(speed: number): Promise<void> {
        await this.page.evaluate((s) => {
            // gameSettings is imported globally in the game
            const settings = (window as any).__settlers_game_settings__;
            if (settings?.state) {
                settings.state.gameSpeed = s;
            }
        }, speed);
    }

    /** Read structured game state including entities and map size. */
    async getGameState(): Promise<{
        mode: string;
        placeBuildingType: number;
        entityCount: number;
        entities: Array<{ id: number; type: number; subType: number; x: number; y: number; player: number }>;
        mapWidth: number;
        mapHeight: number;
    } | null> {
        return this.page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            return {
                mode: game.mode,
                placeBuildingType: game.placeBuildingType,
                entityCount: game.state.entities.length,
                entities: game.state.entities.map((e: any) => ({
                    id: e.id, type: e.type, subType: e.subType,
                    x: e.x, y: e.y, player: e.player
                })),
                mapWidth: game.mapSize.width,
                mapHeight: game.mapSize.height,
            };
        });
    }

    /**
     * Move camera to center on a specific tile position.
     * Uses ViewPoint.setPosition() which does proper isometric coordinate
     * conversion, or falls back to CameraMode.setPosition() via InputManager.
     */
    async moveCamera(tileX: number, tileY: number): Promise<void> {
        await this.page.evaluate(({ x, y }) => {
            const vp = (window as any).__settlers_viewpoint__;
            if (vp?.setPosition) {
                // ViewPoint.setPosition(tileX, tileY) does proper isometric
                // coordinate conversion and centers the camera on the tile.
                vp.setPosition(x, y);
            }
        }, { x: tileX, y: tileY });
        // Wait for the camera position to propagate through the render loop
        await this.waitForFrames(Frames.STATE_PROPAGATE, Timeout.DEFAULT);
    }

    /**
     * Find a buildable tile by spiraling from map center.
     * Temporarily places and removes a building to validate terrain + slope.
     * @param buildingType BuildingType to test (default 1 = Lumberjack).
     *   Use 2 for Warehouse (3x3) to find spots with enough room.
     */
    async findBuildableTile(buildingType = 1): Promise<{ x: number; y: number } | null> {
        return this.page.evaluate((bt) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);
            const existingIds = new Set(game.state.entities.map((e: any) => e.id));

            for (let r = 0; r < Math.max(w, h) / 2; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const tx = cx + dx;
                        const ty = cy + dy;
                        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                        const ok = game.execute({
                            type: 'place_building',
                            buildingType: bt, x: tx, y: ty, player: 0
                        });
                        if (ok) {
                            const newEntities = game.state.entities.filter(
                                (e: any) => !existingIds.has(e.id)
                            );
                            for (const e of newEntities) {
                                game.execute({ type: 'remove_entity', entityId: e.id });
                            }
                            return { x: tx, y: ty };
                        }
                    }
                }
            }
            return null;
        }, buildingType);
    }

    /** Wait for entity count to exceed a given value. */
    async waitForEntityCountAbove(n: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForEntityCountAbove:entityCount > ${n}`,
            (min) => (window as any).__settlers_debug__?.entityCount > min,
            n,
            { timeout },
        );
    }

    // ── Polling helpers ─────────────────────────────────────────
    // Use these instead of point-in-time assertions when timing is uncertain
    // Note: Custom matchers in matchers.ts now poll automatically, so you can
    // use `await expect(gp).toHaveUnitCount(5)` instead of these helpers.

    /** Wait for unit count to reach expected value. */
    async waitForUnitCount(expected: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForUnitCount:unitCount === ${expected}`,
            (n) => (window as any).__settlers_debug__?.unitCount === n,
            expected,
            { timeout },
        );
    }

    /** Wait for building count to reach expected value. */
    async waitForBuildingCount(expected: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForBuildingCount:buildingCount === ${expected}`,
            (n) => (window as any).__settlers_debug__?.buildingCount === n,
            expected,
            { timeout },
        );
    }

    /**
     * Wait for at least N units to be moving.
     * **Optimized**: Uses browser-side requestAnimationFrame polling.
     */
    async waitForUnitsMoving(minMoving: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait(
            `movement:waitForUnitsMoving:unitsMoving >= ${minMoving}`,
            timeout,
            () => this.page.evaluate(({ n, timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + timeoutMs;
                    function check() {
                        const debug = (window as any).__settlers_debug__;
                        const moving = debug?.unitsMoving ?? 0;
                        if (moving >= n) {
                            resolve();
                        } else if (Date.now() > deadline) {
                            reject(new Error(`Timeout waiting for ${n} units moving, got ${moving}`));
                        } else {
                            requestAnimationFrame(check);
                        }
                    }
                    requestAnimationFrame(check);
                });
            }, { n: minMoving, timeoutMs: timeout })
        );
    }

    /**
     * Wait for no units to be moving (all stationary).
     * **Optimized**: Uses browser-side requestAnimationFrame polling.
     */
    async waitForNoUnitsMoving(timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait(
            'movement:waitForNoUnitsMoving:unitsMoving === 0',
            timeout,
            () => this.page.evaluate(({ timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + timeoutMs;
                    function check() {
                        const debug = (window as any).__settlers_debug__;
                        const moving = debug?.unitsMoving ?? 0;
                        if (moving === 0) {
                            resolve();
                        } else if (Date.now() > deadline) {
                            reject(new Error(`Timeout waiting for no units moving, still have ${moving}`));
                        } else {
                            requestAnimationFrame(check);
                        }
                    }
                    requestAnimationFrame(check);
                });
            }, { timeoutMs: timeout })
        );
    }

    /**
     * Wait for a specific unit to reach its destination.
     * Destination is considered reached when unit is at target AND path is empty.
     * **Optimized**: Uses browser-side requestAnimationFrame polling.
     */
    async waitForUnitAtDestination(
        unitId: number,
        targetX: number,
        targetY: number,
        timeout: number = Timeout.LONG_MOVEMENT
    ): Promise<void> {
        await this._profiledWait(
            `movement:waitForUnitAtDestination:unit ${unitId} at (${targetX},${targetY})`,
            timeout,
            () => this.page.evaluate(({ id, tx, ty, timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + timeoutMs;
                    function check() {
                        const game = (window as any).__settlers_game__;
                        if (!game) {
                            if (Date.now() > deadline) {
                                reject(new Error('Timeout: game not available'));
                            } else {
                                requestAnimationFrame(check);
                            }
                            return;
                        }
                        const unit = game.state.getEntity(id);
                        const unitState = game.state.unitStates.get(id);
                        const atTarget = unit && unit.x === tx && unit.y === ty;
                        const pathEmpty = unitState && unitState.path.length === 0;

                        if (atTarget && pathEmpty) {
                            resolve();
                        } else if (Date.now() > deadline) {
                            const pos = unit ? `(${unit.x},${unit.y})` : 'not found';
                            const pathLen = unitState?.path?.length ?? 'no state';
                            reject(new Error(
                                `Timeout waiting for unit ${id} at (${tx},${ty}): ` +
                                `current=${pos}, pathLength=${pathLen}`
                            ));
                        } else {
                            requestAnimationFrame(check);
                        }
                    }
                    requestAnimationFrame(check);
                });
            }, { id: unitId, tx: targetX, ty: targetY, timeoutMs: timeout })
        );
    }

    /**
     * Wait for a unit to move away from its starting position.
     * Useful for verifying movement has started.
     * **Optimized**: Uses browser-side requestAnimationFrame polling.
     */
    async waitForUnitToMove(unitId: number, startX: number, startY: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait(
            `movement:waitForUnitToMove:unit ${unitId} moved from (${startX},${startY})`,
            timeout,
            () => this.page.evaluate(({ id, sx, sy, timeoutMs }) => {
                return new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + timeoutMs;
                    function check() {
                        const game = (window as any).__settlers_game__;
                        if (!game) {
                            if (Date.now() > deadline) {
                                reject(new Error('Timeout: game not available'));
                            } else {
                                requestAnimationFrame(check);
                            }
                            return;
                        }
                        const unit = game.state.getEntity(id);
                        if (unit && (unit.x !== sx || unit.y !== sy)) {
                            resolve();
                        } else if (Date.now() > deadline) {
                            const pos = unit ? `(${unit.x},${unit.y})` : 'not found';
                            reject(new Error(
                                `Timeout waiting for unit ${id} to move from (${sx},${sy}): current=${pos}`
                            ));
                        } else {
                            requestAnimationFrame(check);
                        }
                    }
                    requestAnimationFrame(check);
                });
            }, { id: unitId, sx: startX, sy: startY, timeoutMs: timeout })
        );
    }

    /**
     * Wait for mode to change to expected value.
     */
    async waitForMode(expectedMode: string, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `render:waitForMode:mode === ${expectedMode}`,
            (mode) => (window as any).__settlers_debug__?.mode === mode,
            expectedMode,
            { timeout },
        );
    }

    // ── Higher-level game actions ────────────────────────────

    /**
     * Place a building via game.execute() command pipeline.
     * Returns the created entity info, or null if placement failed.
     */
    async placeBuilding(buildingType: number, x: number, y: number, player = 0): Promise<{
        id: number; type: number; subType: number; x: number; y: number; player: number;
    } | null> {
        return this.page.evaluate(({ bt, posX, posY, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const idsBefore = new Set(game.state.entities.map((e: any) => e.id));
            const ok = game.execute({ type: 'place_building', buildingType: bt, x: posX, y: posY, player: p });
            if (!ok) return null;
            const newEntity = game.state.entities.find(
                (e: any) => !idsBefore.has(e.id) && e.type === 2
            );
            return newEntity
                ? { id: newEntity.id, type: newEntity.type, subType: newEntity.subType, x: newEntity.x, y: newEntity.y, player: newEntity.player }
                : null;
        }, { bt: buildingType, posX: x, posY: y, p: player });
    }

    /**
     * Place a resource via game.execute() command pipeline.
     * Returns the created entity info, or null if placement failed.
     */
    async placeResource(materialType: number, x: number, y: number, amount = 1): Promise<{
        id: number; type: number; subType: number; x: number; y: number; amount: number;
    } | null> {
        return this.page.evaluate(({ mt, posX, posY, amt }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const idsBefore = new Set(game.state.entities.map((e: any) => e.id));
            const ok = game.execute({ type: 'place_resource', materialType: mt, x: posX, y: posY, amount: amt });
            if (!ok) return null;
            const newEntity = game.state.entities.find(
                (e: any) => !idsBefore.has(e.id) && e.type === 4 // EntityType.StackedResource
            );
            if (!newEntity) return null;
            const resourceState = game.state.resourceStates.get(newEntity.id);
            return {
                id: newEntity.id,
                type: newEntity.type,
                subType: newEntity.subType,
                x: newEntity.x,
                y: newEntity.y,
                amount: resourceState?.quantity ?? amt
            };
        }, { mt: materialType, posX: x, posY: y, amt: amount });
    }

    /**
     * Find a passable tile (suitable for resource placement) by spiraling from map center.
     * Resources require passable terrain without existing occupancy.
     */
    async findPassableTile(): Promise<{ x: number; y: number } | null> {
        return this.page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const w = game.mapSize.width;
            const h = game.mapSize.height;
            const cx = Math.floor(w / 2);
            const cy = Math.floor(h / 2);

            for (let r = 0; r < Math.max(w, h) / 2; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const tx = cx + dx;
                        const ty = cy + dy;
                        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;

                        const idx = game.mapSize.toIndex(tx, ty);
                        const gt = game.groundType[idx];
                        // Check if passable terrain (not water, not blocked)
                        const isPassable = gt > 8 && gt !== 32;
                        // Check if not already occupied
                        const key = `${tx},${ty}`;
                        const isOccupied = game.state.tileOccupancy?.has(key);

                        if (isPassable && !isOccupied) {
                            return { x: tx, y: ty };
                        }
                    }
                }
            }
            return null;
        });
    }

    /**
     * Spawn a unit via game.execute() command pipeline (bypasses UI buttons).
     * If x/y not provided, spawns at map center.
     * Returns the created entity info, or null if spawn failed.
     */
    async spawnUnit(unitType = 1, x?: number, y?: number, player = 0): Promise<{
        id: number; type: number; subType: number; x: number; y: number;
    } | null> {
        return this.page.evaluate(({ ut, posX, posY, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const spawnX = posX ?? Math.floor(game.mapSize.width / 2);
            const spawnY = posY ?? Math.floor(game.mapSize.height / 2);
            const idsBefore = new Set(game.state.entities.map((e: any) => e.id));
            game.execute({ type: 'spawn_unit', unitType: ut, x: spawnX, y: spawnY, player: p });
            const newEntity = game.state.entities.find(
                (e: any) => !idsBefore.has(e.id) && e.type === 1
            );
            return newEntity
                ? { id: newEntity.id, type: newEntity.type, subType: newEntity.subType, x: newEntity.x, y: newEntity.y }
                : null;
        }, { ut: unitType, posX: x, posY: y, p: player });
    }

    /**
     * Issue a move_unit command via game.execute().
     * Returns true if the command was accepted.
     */
    async moveUnit(entityId: number, targetX: number, targetY: number): Promise<boolean> {
        return this.page.evaluate(({ id, tx, ty }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return false;
            return !!game.execute({ type: 'move_unit', entityId: id, targetX: tx, targetY: ty });
        }, { id: entityId, tx: targetX, ty: targetY });
    }

    /**
     * Read entities from game state, optionally filtered.
     */
    async getEntities(filter?: { type?: number; subType?: number; player?: number }): Promise<
        Array<{ id: number; type: number; subType: number; x: number; y: number; player: number }>
    > {
        return this.page.evaluate((f) => {
            const game = (window as any).__settlers_game__;
            if (!game) return [];
            return game.state.entities
                .filter((e: any) => {
                    if (f?.type !== undefined && e.type !== f.type) return false;
                    if (f?.subType !== undefined && e.subType !== f.subType) return false;
                    if (f?.player !== undefined && e.player !== f.player) return false;
                    return true;
                })
                .map((e: any) => ({
                    id: e.id, type: e.type, subType: e.subType,
                    x: e.x, y: e.y, player: e.player
                }));
        }, filter ?? null);
    }

    // ── Canvas diagnostics ──────────────────────────────────

    /** Sample pixel colors from the WebGL canvas at named positions. */
    async samplePixels(): Promise<Record<string, number[]>> {
        return this.page.evaluate(() => {
            const c = document.querySelector('canvas');
            if (!c) return {};
            const gl = c.getContext('webgl2');
            if (!gl) return {};

            const spots: Record<string, [number, number]> = {
                center: [Math.floor(c.width / 2), Math.floor(c.height / 2)],
                topLeft: [10, 10],
                topRight: [c.width - 10, 10],
                bottomLeft: [10, c.height - 10],
                bottomRight: [c.width - 10, c.height - 10],
            };

            const result: Record<string, number[]> = {};
            for (const [name, [x, y]] of Object.entries(spots)) {
                const buf = new Uint8Array(4);
                gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
                result[name] = Array.from(buf);
            }
            return result;
        });
    }

    // ── Assertions ──────────────────────────────────────────

    /** Assert the canvas is visible and non-zero size. */
    async expectCanvasVisible(): Promise<void> {
        await expect(this.canvas).toBeVisible();
        const box = await this.canvas.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
    }

    /**
     * Assert no unexpected JS errors occurred.
     * Filters only specific known-harmless messages:
     * - Missing GFX asset files (e.g. '2.gh6')
     * - WebGL context warnings from headless Chrome
     * - Procedural texture fallback warnings (exact prefix match)
     */
    collectErrors(): { errors: string[]; check: () => void } {
        const errors: string[] = [];
        this.page.on('pageerror', (err) => errors.push(err.message));
        return {
            errors,
            check: () => {
                const unexpected = errors.filter(
                    (e) =>
                        !e.includes('2.gh6') &&
                        !e.includes('WebGL') &&
                        !e.startsWith('texture fallback:'),
                );
                expect(unexpected).toHaveLength(0);
            },
        };
    }

    // ── Audio controls ──────────────────────────────────────

    /** Get current audio state from debug bridge. */
    async getAudioState(): Promise<{
        musicEnabled: boolean;
        musicPlaying: boolean;
        currentMusicId: string | null;
    }> {
        return this.page.evaluate(() => {
            const d = (window as any).__settlers_debug__;
            return {
                musicEnabled: d?.musicEnabled ?? false,
                musicPlaying: d?.musicPlaying ?? false,
                currentMusicId: d?.currentMusicId ?? null,
            };
        });
    }

    /** Toggle music on or off via SoundManager. */
    async toggleMusic(enabled: boolean): Promise<void> {
        await this.page.evaluate((e) => {
            const game = (window as any).__settlers_game__;
            game?.soundManager?.toggleMusic(e);
        }, enabled);
        // Wait for state to propagate
        await this.waitForFrames(Frames.STATE_PROPAGATE);
    }

    /**
     * Trigger user interaction to unlock AudioContext.
     * Waits for AudioContext to be in 'running' state or times out gracefully.
     */
    async unlockAudio(): Promise<void> {
        // Click on the canvas to trigger user interaction
        await this.canvas.click();

        // Wait for AudioContext to unlock (running state) instead of hardcoded timeout
        // AudioContext may already be running, or may need user gesture to resume
        await this._waitForFunction(
            'audio:unlockAudio:AudioContext running',
            () => {
                const game = (window as any).__settlers_game__;
                const ctx = game?.soundManager?.audioContext;
                // Success if no audio context (audio disabled) or context is running
                return !ctx || ctx.state === 'running';
            },
            null,
            { timeout: Timeout.FAST },
        ).catch(() => {
            // AudioContext may not exist or may be suspended - that's OK for tests
            // that don't actually need audio
        });
    }

    // ── Sprite cache helpers ─────────────────────────────────

    /** Get sprite load timings from debug state. */
    async getLoadTimings(): Promise<LoadTimings> {
        return this.page.evaluate(() => {
            const d = (window as any).__settlers_debug__;
            return {
                totalSprites: d?.loadTimings?.totalSprites ?? 0,
                cacheHit: d?.loadTimings?.cacheHit ?? false,
                cacheSource: d?.loadTimings?.cacheSource ?? null,
            };
        });
    }

    /** Clear the IndexedDB sprite atlas cache. */
    async clearSpriteCache(): Promise<void> {
        await this.page.evaluate(async() => {
            const DB_NAME = 'settlers-atlas-cache';
            return new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(DB_NAME);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
            });
        });
    }
}
