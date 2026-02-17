import { type Page, type Locator, expect } from '@playwright/test';
import type { DebugStatsState } from '@/game/debug-stats';
import type { GameViewStateData } from '@/game/game-view-state';
import { Frames, Timeout } from './wait-config';
import { WaitProfiler, type WaitCategory } from './wait-profiler';
import * as gameActions from './game-actions';
import * as gameQueries from './game-queries';
import * as audioHelpers from './audio-helpers';
import * as spriteHelpers from './sprite-helpers';

// Re-export types from helper modules for consumers that import from game-page
export type { LoadTimings } from './sprite-helpers';

/**
 * Page Object Model for the Settlers.ts map view.
 *
 * Central facade for navigation, waiting, and game readiness.
 * Domain-specific helpers are in dedicated modules:
 * - game-actions.ts — entity placement, game commands, map queries
 * - game-queries.ts — unit state, animation, movement queries
 * - audio-helpers.ts — audio state and controls
 * - sprite-helpers.ts — sprite loading and cache
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
     * @param label - Format: "category:method:condition"
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
    private async _profiledWait<T>(label: string, timeout: number, fn: () => Promise<T>): Promise<T> {
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
        await this._profiledWait('dom:waitForGameUi:game UI visible', timeout, () => this.gameUi.waitFor({ timeout }));
    }

    /**
     * Wait until the renderer has drawn at least `minFrames` **new** frames.
     *
     * @param minFrames - Number of frames to wait. Use Frames constants.
     */
    async waitForFrames(
        minFrames: number = Frames.RENDER_SETTLE,
        timeout: number = Timeout.INITIAL_LOAD
    ): Promise<void> {
        await this._profiledWait(`frame:waitForFrames:${minFrames} frames`, timeout, () =>
            this.page.evaluate(
                ({ n, timeoutMs }) => {
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
                                reject(
                                    new Error(
                                        `Timeout waiting for ${n} frames: got ${currentFrame - startFrame}/${n} ` +
                                            `(start=${startFrame}, current=${currentFrame}, target=${targetFrame})`
                                    )
                                );
                            } else {
                                requestAnimationFrame(checkFrame);
                            }
                        }
                        requestAnimationFrame(checkFrame);
                    });
                },
                { n: minFrames, timeoutMs: timeout }
            )
        );
    }

    /**
     * Wait for game loaded + renderer ready + N frames rendered.
     */
    async waitForReady(
        minFrames: number = Frames.RENDER_SETTLE,
        timeout: number = Timeout.INITIAL_LOAD
    ): Promise<void> {
        await this._profiledWait(`frame:waitForReady:gameLoaded && rendererReady + ${minFrames} frames`, timeout, () =>
            this.page.evaluate(
                ({ n, timeoutMs }) => {
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

                            if (!debug || !debug.gameLoaded || !debug.rendererReady) {
                                requestAnimationFrame(checkReady);
                                return;
                            }

                            if (startFrame === null) {
                                startFrame = debug.frameCount ?? 0;
                            }

                            const currentFrame = debug.frameCount ?? 0;
                            const base = startFrame as number;
                            const targetFrame = base + n;

                            if (currentFrame >= targetFrame) {
                                resolve();
                            } else if (now > deadline) {
                                reject(
                                    new Error(
                                        `Timeout waiting for ${n} frames after ready: ` +
                                            `got ${currentFrame - base}/${n}`
                                    )
                                );
                            } else {
                                requestAnimationFrame(checkReady);
                            }
                        }
                        requestAnimationFrame(checkReady);
                    });
                },
                { n: minFrames, timeoutMs: timeout }
            )
        );
    }

    /**
     * Wait for game state to be initialized, WITHOUT requiring WebGL rendering.
     */
    async waitForGameReady(minTicks: number = 5, timeout: number = Timeout.INITIAL_LOAD): Promise<void> {
        await this._profiledWait(`state:waitForGameReady:gameLoaded + ${minTicks} ticks`, timeout, () =>
            this.page.evaluate(
                ({ n, timeoutMs }) => {
                    return new Promise<void>((resolve, reject) => {
                        const deadline = Date.now() + timeoutMs;
                        let startTick: number | null = null;

                        function check() {
                            const debug = (window as any).__settlers_debug__;
                            const now = Date.now();

                            if (now > deadline) {
                                const state = debug
                                    ? `gameLoaded=${debug.gameLoaded}, tickCount=${debug.tickCount}`
                                    : 'debug not available';
                                reject(new Error(`Timeout waiting for game ready: ${state}`));
                                return;
                            }

                            if (!debug || !debug.gameLoaded) {
                                requestAnimationFrame(check);
                                return;
                            }

                            if (startTick === null) {
                                startTick = debug.tickCount ?? 0;
                            }

                            const currentTick = debug.tickCount ?? 0;
                            const base = startTick as number;
                            if (currentTick >= base + n) {
                                resolve();
                            } else {
                                requestAnimationFrame(check);
                            }
                        }
                        requestAnimationFrame(check);
                    });
                },
                { n: minTicks, timeoutMs: timeout }
            )
        );
    }

    /**
     * Wait for N game ticks to elapse (not render frames).
     */
    async waitForTicks(minTicks: number = 5, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait(`state:waitForTicks:${minTicks} ticks`, timeout, () =>
            this.page.evaluate(
                ({ n, timeoutMs }) => {
                    return new Promise<void>((resolve, reject) => {
                        const debug = (window as any).__settlers_debug__;
                        const startTick = debug?.tickCount ?? 0;
                        const targetTick = startTick + n;
                        const deadline = Date.now() + timeoutMs;

                        function check() {
                            const currentTick = (window as any).__settlers_debug__?.tickCount ?? 0;
                            if (currentTick >= targetTick) {
                                resolve();
                            } else if (Date.now() > deadline) {
                                reject(
                                    new Error(
                                        `Timeout waiting for ${n} ticks: got ${currentTick - startTick}/${n} ` +
                                            `(start=${startTick}, current=${currentTick}, target=${targetTick})`
                                    )
                                );
                            } else {
                                requestAnimationFrame(check);
                            }
                        }
                        requestAnimationFrame(check);
                    });
                },
                { n: minTicks, timeoutMs: timeout }
            )
        );
    }

    // ── State reset ───────────────────────────────────────────

    /**
     * Remove user-placed entities but preserve environment objects.
     * Resets mode to 'select'.
     */
    async resetGameState(): Promise<void> {
        await this.page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;

            game.resetToCleanState({ keepEnvironment: true, rebuildInventory: true });

            const input = (window as any).__settlers_input__;
            if (input && input.getModeName() !== 'select') {
                input.switchMode('select');
            }

            const viewState = (window as any).__settlers_view_state__;
            viewState?.forceCountUpdate();
        });
        const rendererReady = await this.getDebugField('rendererReady');
        if (rendererReady) {
            await this.waitForFrames(Frames.IMMEDIATE, Timeout.DEFAULT);
        } else {
            await this.waitForTicks(1, Timeout.DEFAULT);
        }
    }

    // ── Debug bridge reads ──────────────────────────────────

    /** Read the full debug state object from the page. */
    async getDebug(): Promise<DebugStatsState> {
        return this.page.evaluate(() => {
            const d = (window as any).__settlers_debug__;
            return { ...d };
        });
    }

    /** Read a single debug field. */
    async getDebugField<K extends keyof DebugStatsState>(key: K): Promise<DebugStatsState[K]> {
        return this.page.evaluate(k => (window as any).__settlers_debug__?.[k], key);
    }

    /** Read the full view state object (mode, selection, entity counts). */
    async getView(): Promise<GameViewStateData> {
        return this.page.evaluate(() => {
            const v = (window as any).__settlers_view__;
            return { ...v };
        });
    }

    /** Read a single view state field. */
    async getViewField<K extends keyof GameViewStateData>(key: K): Promise<GameViewStateData[K]> {
        return this.page.evaluate(k => (window as any).__settlers_view__?.[k], key);
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

    // ── UI Actions ──────────────────────────────────────────

    async clickButton(testId: string): Promise<void> {
        await this.page.locator(`[data-testid="${testId}"]`).click();
    }

    async pause(): Promise<void> {
        await this.clickButton('btn-pause');
    }

    async selectMode(): Promise<void> {
        await this.page.locator('[data-testid="btn-select-mode"]').click({ force: true });
    }

    // ── Polling waits ───────────────────────────────────────

    /** Wait for entity count to exceed a given value. */
    async waitForEntityCountAbove(n: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForEntityCountAbove:entityCount > ${n}`,
            min => (window as any).__settlers_view__?.entityCount > min,
            n,
            { timeout }
        );
    }

    /** Wait for unit count to reach expected value. */
    async waitForUnitCount(expected: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForUnitCount:unitCount === ${expected}`,
            n => (window as any).__settlers_view__?.unitCount === n,
            expected,
            { timeout }
        );
    }

    /** Wait for building count to reach expected value. */
    async waitForBuildingCount(expected: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `state:waitForBuildingCount:buildingCount === ${expected}`,
            n => (window as any).__settlers_view__?.buildingCount === n,
            expected,
            { timeout }
        );
    }

    /** Wait for mode to change to expected value. */
    async waitForMode(expectedMode: string, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `render:waitForMode:mode === ${expectedMode}`,
            mode => (window as any).__settlers_view__?.mode === mode,
            expectedMode,
            { timeout }
        );
    }

    // ── Movement waits ──────────────────────────────────────

    /**
     * Wait for at least N units to be moving.
     */
    async waitForUnitsMoving(minMoving: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait(`movement:waitForUnitsMoving:unitsMoving >= ${minMoving}`, timeout, () =>
            this.page.evaluate(
                ({ n, timeoutMs }) => {
                    return new Promise<void>((resolve, reject) => {
                        const deadline = Date.now() + timeoutMs;
                        function check() {
                            const view = (window as any).__settlers_view__;
                            const moving = view?.unitsMoving ?? 0;
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
                },
                { n: minMoving, timeoutMs: timeout }
            )
        );
    }

    /**
     * Wait for no units to be moving (all stationary).
     */
    async waitForNoUnitsMoving(timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._profiledWait('movement:waitForNoUnitsMoving:unitsMoving === 0', timeout, () =>
            this.page.evaluate(
                ({ timeoutMs }) => {
                    return new Promise<void>((resolve, reject) => {
                        const deadline = Date.now() + timeoutMs;
                        function check() {
                            const view = (window as any).__settlers_view__;
                            const moving = view?.unitsMoving ?? 0;
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
                },
                { timeoutMs: timeout }
            )
        );
    }

    /**
     * Wait for a specific unit to reach its destination.
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
            () =>
                this.page.evaluate(
                    ({ id, tx, ty, timeoutMs }) => {
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
                                    reject(
                                        new Error(
                                            `Timeout waiting for unit ${id} at (${tx},${ty}): ` +
                                                `current=${pos}, pathLength=${pathLen}`
                                        )
                                    );
                                } else {
                                    requestAnimationFrame(check);
                                }
                            }
                            requestAnimationFrame(check);
                        });
                    },
                    { id: unitId, tx: targetX, ty: targetY, timeoutMs: timeout }
                )
        );
    }

    /**
     * Wait for a unit to move away from its starting position.
     */
    async waitForUnitToMove(
        unitId: number,
        startX: number,
        startY: number,
        timeout: number = Timeout.DEFAULT
    ): Promise<void> {
        await this._profiledWait(
            `movement:waitForUnitToMove:unit ${unitId} moved from (${startX},${startY})`,
            timeout,
            () =>
                this.page.evaluate(
                    ({ id, sx, sy, timeoutMs }) => {
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
                                    reject(
                                        new Error(
                                            `Timeout waiting for unit ${id} to move from (${sx},${sy}): current=${pos}`
                                        )
                                    );
                                } else {
                                    requestAnimationFrame(check);
                                }
                            }
                            requestAnimationFrame(check);
                        });
                    },
                    { id: unitId, sx: startX, sy: startY, timeoutMs: timeout }
                )
        );
    }

    /**
     * Wait for a unit's movement controller to reach 'idle' state.
     */
    async waitForMovementIdle(unitId: number, timeout: number = Timeout.DEFAULT): Promise<void> {
        await this._waitForFunction(
            `movement:waitForMovementIdle:controller idle for unit ${unitId}`,
            id => {
                const game = (window as any).__settlers_game__;
                if (!game) return false;
                const controller = game.state.movement.getController(id);
                return controller && controller.state === 'idle';
            },
            unitId,
            { timeout }
        );
    }

    // ── Delegated: Game actions (game-actions.ts) ───────────

    async setGameSpeed(speed: number): Promise<void> {
        return gameActions.setGameSpeed(this.page, speed);
    }

    async getGameState() {
        return gameActions.getGameState(this.page);
    }

    async getEntities(filter?: { type?: number; subType?: number; player?: number }) {
        return gameActions.getEntities(this.page, filter);
    }

    async getMapCenter() {
        return gameActions.getMapCenter(this.page);
    }

    async isTerrainPassable(x: number, y: number) {
        return gameActions.isTerrainPassable(this.page, x, y);
    }

    async getPlacementPreview() {
        return gameActions.getPlacementPreview(this.page);
    }

    async placeBuilding(buildingType: number, x: number, y: number, player = 0) {
        return gameActions.placeBuilding(this.page, buildingType, x, y, player);
    }

    async placeResource(materialType: number, x: number, y: number, amount = 1) {
        return gameActions.placeResource(this.page, materialType, x, y, amount);
    }

    async spawnUnit(unitType = 1, x?: number, y?: number, player = 0) {
        return gameActions.spawnUnit(this.page, unitType, x, y, player);
    }

    async moveUnit(entityId: number, targetX: number, targetY: number) {
        return gameActions.moveUnit(this.page, entityId, targetX, targetY);
    }

    async findBuildableTile(buildingType = 1) {
        return gameActions.findBuildableTile(this.page, buildingType);
    }

    async findPassableTile() {
        return gameActions.findPassableTile(this.page);
    }

    async placeMultipleBuildings(count: number, buildingTypes?: number[], players?: number[]) {
        return gameActions.placeMultipleBuildings(this.page, count, buildingTypes, players);
    }

    async placeMultipleResources(count: number, materialTypes?: number[]) {
        return gameActions.placeMultipleResources(this.page, count, materialTypes);
    }

    /**
     * Move camera to center on a specific tile position.
     * Waits for the camera position to propagate through the render loop.
     */
    async moveCamera(tileX: number, tileY: number): Promise<void> {
        await gameActions.setCameraPosition(this.page, tileX, tileY);
        await this.waitForFrames(Frames.STATE_PROPAGATE, Timeout.DEFAULT);
    }

    // ── Delegated: Game queries (game-queries.ts) ───────────

    async getUnitState(unitId: number) {
        return gameQueries.getUnitState(this.page, unitId);
    }

    async getAnimationState(unitId: number) {
        return gameQueries.getAnimationState(this.page, unitId);
    }

    async getMovementControllerState(unitId: number) {
        return gameQueries.getMovementControllerState(this.page, unitId);
    }

    async sampleAnimationStates(unitId: number, numSamples: number = 10) {
        return gameQueries.sampleAnimationStates(this.page, unitId, numSamples);
    }

    async sampleUnitPositions(unitId: number, numSamples: number = 10) {
        return gameQueries.sampleUnitPositions(this.page, unitId, numSamples);
    }

    async captureMovementEvents() {
        return gameQueries.captureMovementEvents(this.page);
    }

    // ── Delegated: Audio (audio-helpers.ts) ──────────────────

    async getAudioState() {
        return audioHelpers.getAudioState(this.page);
    }

    /** Toggle music on or off via SoundManager. */
    async toggleMusic(enabled: boolean): Promise<void> {
        await audioHelpers.setMusicEnabled(this.page, enabled);
        await this.waitForFrames(Frames.STATE_PROPAGATE);
    }

    /**
     * Trigger user interaction to unlock AudioContext.
     * Waits for AudioContext to be in 'running' state or times out gracefully.
     */
    async unlockAudio(): Promise<void> {
        await this.canvas.click();

        await this._waitForFunction(
            'audio:unlockAudio:AudioContext running',
            () => {
                const game = (window as any).__settlers_game__;
                const ctx = game?.soundManager?.audioContext;
                return !ctx || ctx.state === 'running';
            },
            null,
            { timeout: Timeout.FAST }
        ).catch(() => {
            // AudioContext may not exist or may be suspended - that's OK for tests
            // that don't actually need audio
        });
    }

    // ── Delegated: Sprites (sprite-helpers.ts) ──────────────

    async hasSpritesLoaded() {
        return spriteHelpers.hasSpritesLoaded(this.page);
    }

    async getLoadedUnitSprites() {
        return spriteHelpers.getLoadedUnitSprites(this.page);
    }

    async getSpriteRegistrySize() {
        return spriteHelpers.getSpriteRegistrySize(this.page);
    }

    async testJilLookup(fileId: string, jobIndices: number[]) {
        return spriteHelpers.testJilLookup(this.page, fileId, jobIndices);
    }

    async getLoadTimings() {
        return spriteHelpers.getLoadTimings(this.page);
    }

    async clearSpriteCache() {
        return spriteHelpers.clearSpriteCache(this.page);
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
     */
    collectErrors(): { errors: string[]; check: () => void } {
        const errors: string[] = [];
        this.page.on('pageerror', err => errors.push(err.message));
        return {
            errors,
            check: () => {
                const unexpected = errors.filter(
                    e => !e.includes('2.gh6') && !e.includes('WebGL') && !e.startsWith('texture fallback:')
                );
                expect(unexpected).toHaveLength(0);
            },
        };
    }
}
