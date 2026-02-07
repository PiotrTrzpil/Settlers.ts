import { type Page, type Locator, expect } from '@playwright/test';

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

    // ── Navigation ──────────────────────────────────────────

    /** Navigate to the map view with an optional test map. */
    async goto(options: { testMap?: boolean } = {}): Promise<void> {
        const query = options.testMap ? '?testMap=true' : '';
        await this.page.goto(`/map-view${query}`);
    }

    // ── Waiting ─────────────────────────────────────────────

    /** Wait until the game UI is mounted in the DOM. */
    async waitForGameUi(timeout = 20_000): Promise<void> {
        await this.gameUi.waitFor({ timeout });
    }

    /**
     * Wait until the renderer has drawn at least `minFrames` **new** frames.
     * Uses relative counting (reads current frameCount first, then waits for
     * current + minFrames) so it works correctly with the shared fixture where
     * frameCount is already high from previous tests.
     */
    async waitForFrames(minFrames = 5, timeout = 20_000): Promise<void> {
        const baseFrame = await this.page.evaluate(
            () => (window as any).__settlers_debug__?.frameCount ?? 0,
        );
        await this.page.waitForFunction(
            ({ base, n }) => (window as any).__settlers_debug__?.frameCount >= base + n,
            { base: baseFrame, n: minFrames },
            { timeout },
        );
    }

    /** Wait for game loaded + renderer ready + N frames rendered. */
    async waitForReady(minFrames = 5, timeout = 20_000): Promise<void> {
        await this.waitForGameUi(timeout);
        await this.page.waitForFunction(
            () => {
                const d = (window as any).__settlers_debug__;
                return d && d.gameLoaded && d.rendererReady;
            },
            null,
            { timeout },
        );
        await this.waitForFrames(minFrames, timeout);
    }

    // ── State reset ───────────────────────────────────────────

    /**
     * Remove all entities and reset mode to 'select'.
     * Uses the proper game command pipeline (game.execute) for entity removal
     * and InputManager.switchMode for mode changes (with full exit/enter lifecycle).
     */
    async resetGameState(): Promise<void> {
        await this.page.evaluate(() => {
            const game = (window as any).__settlers_game__;
            if (!game) return;
            // Remove all entities through the game's public API, which uses
            // the command pipeline (terrain restoration, territory rebuild, etc.)
            game.removeAllEntities();
            // Reset mode via InputManager — goes through proper onExit/onEnter
            // lifecycle so mode data is cleaned up and callbacks fire.
            const input = (window as any).__settlers_input__;
            if (input && input.getModeName() !== 'select') {
                input.switchMode('select');
            }
        });
        // Wait for cleanup to propagate
        await this.page.waitForFunction(
            () => (window as any).__settlers_debug__?.entityCount === 0,
            null,
            { timeout: 5000 },
        );
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

    async spawnBearer(): Promise<void> {
        // Switch to Units tab first
        await this.page.locator('.tab-btn', { hasText: 'Units' }).click();
        await this.clickButton('btn-spawn-bearer');
    }

    async spawnSwordsman(): Promise<void> {
        await this.page.locator('.tab-btn', { hasText: 'Units' }).click();
        await this.clickButton('btn-spawn-swordsman');
    }

    async pause(): Promise<void> {
        await this.clickButton('btn-pause');
    }

    async selectMode(): Promise<void> {
        await this.clickButton('btn-select-mode');
    }

    // ── Game state (via __settlers_game__) ─────────────────

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
        await this.waitForFrames(2, 5000);
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
    async waitForEntityCountAbove(n: number, timeout = 5000): Promise<void> {
        await this.page.waitForFunction(
            (min) => (window as any).__settlers_debug__?.entityCount > min,
            n,
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
        return this.page.evaluate(({ bt, x, y, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const idsBefore = new Set(game.state.entities.map((e: any) => e.id));
            const ok = game.execute({ type: 'place_building', buildingType: bt, x, y, player: p });
            if (!ok) return null;
            const newEntity = game.state.entities.find(
                (e: any) => !idsBefore.has(e.id) && e.type === 2
            );
            return newEntity
                ? { id: newEntity.id, type: newEntity.type, subType: newEntity.subType, x: newEntity.x, y: newEntity.y, player: newEntity.player }
                : null;
        }, { bt: buildingType, x, y, p: player });
    }

    /**
     * Spawn a unit via game.execute() command pipeline (bypasses UI buttons).
     * If x/y not provided, spawns at map center.
     * Returns the created entity info, or null if spawn failed.
     */
    async spawnUnit(unitType = 1, x?: number, y?: number, player = 0): Promise<{
        id: number; type: number; subType: number; x: number; y: number;
    } | null> {
        return this.page.evaluate(({ ut, x, y, p }) => {
            const game = (window as any).__settlers_game__;
            if (!game) return null;
            const spawnX = x ?? Math.floor(game.mapSize.width / 2);
            const spawnY = y ?? Math.floor(game.mapSize.height / 2);
            const idsBefore = new Set(game.state.entities.map((e: any) => e.id));
            game.execute({ type: 'spawn_unit', unitType: ut, x: spawnX, y: spawnY, player: p });
            const newEntity = game.state.entities.find(
                (e: any) => !idsBefore.has(e.id) && e.type === 1
            );
            return newEntity
                ? { id: newEntity.id, type: newEntity.type, subType: newEntity.subType, x: newEntity.x, y: newEntity.y }
                : null;
        }, { ut: unitType, x, y, p: player });
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
}
