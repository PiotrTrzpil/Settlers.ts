import { type Page, type Locator, expect } from '@playwright/test';
import type { DebugStatsState } from '@/game/debug/debug-stats';
import type { GameViewStateData } from '@/game/ui/game-view-state';
import { Frames, Timeout } from './wait-config';
import * as gameActions from './game-actions';
import * as gameQueries from './game-queries';
import * as audioHelpers from './audio-helpers';
import * as spriteHelpers from './sprite-helpers';
import * as waitHelpers from './wait-helpers';

// ── Module binding ──────────────────────────────────────────

/**
 * Strips the first `Page` parameter from every function in a module,
 * producing a version where `page` is pre-bound.
 */
type PageBound<T> = {
    [K in keyof T]: T[K] extends (page: Page, ...args: infer A) => infer R ? (...args: A) => R : T[K];
};

function bindPage<T extends Record<string, unknown>>(mod: T, page: Page): PageBound<T> {
    const bound = {} as Record<string, unknown>;
    for (const key of Object.keys(mod)) {
        const val = mod[key];
        bound[key] =
            typeof val === 'function'
                ? (...args: unknown[]) => (val as (...a: unknown[]) => unknown)(page, ...args)
                : val;
    }
    return bound as PageBound<T>;
}

/**
 * Page Object Model for the Settlers.ts map view.
 *
 * Central facade for navigation, waiting, and game readiness.
 * Domain-specific helpers are exposed as pre-bound modules:
 *
 *   gp.actions.placeBuilding(1, x, y)
 *   gp.wait.waitForFrames(5)
 *   gp.queries.getUnitState(unitId)
 *   gp.audio.getAudioState()
 *   gp.sprites.hasSpritesLoaded()
 */
export class GamePage {
    readonly page: Page;
    readonly canvas: Locator;
    readonly gameUi: Locator;
    readonly entityCount: Locator;
    readonly modeIndicator: Locator;

    /** Entity placement, game commands, map queries */
    readonly actions: PageBound<typeof gameActions>;
    /** Profiled wait functions: frames, ticks, movement, inventory */
    readonly wait: PageBound<typeof waitHelpers>;
    /** Unit state, animation, movement queries */
    readonly queries: PageBound<typeof gameQueries>;
    /** Audio state and controls */
    readonly audio: PageBound<typeof audioHelpers>;
    /** Sprite loading and cache */
    readonly sprites: PageBound<typeof spriteHelpers>;

    constructor(page: Page) {
        this.page = page;
        this.canvas = page.locator('canvas.cav');
        this.gameUi = page.locator('[data-testid="game-ui"]');
        this.entityCount = page.locator('[data-testid="entity-count"]');
        this.modeIndicator = page.locator('[data-testid="mode-indicator"]');

        this.actions = bindPage(gameActions, page);
        this.wait = bindPage(waitHelpers, page);
        this.queries = bindPage(gameQueries, page);
        this.audio = bindPage(audioHelpers, page);
        this.sprites = bindPage(spriteHelpers, page);
    }

    // ── Navigation ──────────────────────────────────────────

    /** Navigate to the map view with an optional test/empty map or specific map file. */
    async goto(options: { testMap?: boolean; emptyMap?: boolean; mapFile?: string } = {}): Promise<void> {
        const query = options.testMap
            ? '?testMap=true'
            : options.emptyMap
              ? '?emptyMap=true'
              : options.mapFile
                ? `?mapFile=${encodeURIComponent(options.mapFile)}`
                : '';
        await this.page.goto(`/map-view${query}`);
    }

    // ── State reset ───────────────────────────────────────────

    /**
     * Remove user-placed entities but preserve environment objects.
     * Resets mode to 'select'.
     */
    async resetGameState(): Promise<void> {
        await this.page.evaluate(() => {
            const game = window.__settlers__?.game;
            if (!game) return;

            game.restoreToInitialState();

            const input = window.__settlers__?.input;
            if (input && input.getModeName() !== 'select') {
                input.switchMode('select');
            }

            const viewState = window.__settlers__?.viewState;
            viewState?.forceCountUpdate();
        });
        const rendererReady = await this.getDebugField('rendererReady');
        if (rendererReady) {
            await this.wait.waitForFrames(Frames.IMMEDIATE, Timeout.DEFAULT);
        } else {
            await this.wait.waitForTicks(1, Timeout.DEFAULT);
        }
    }

    // ── Debug bridge reads ──────────────────────────────────

    /** Read the full debug state object from the page. */
    async getDebug(): Promise<DebugStatsState> {
        return this.page.evaluate(() => {
            return { ...window.__settlers__!.debug! };
        });
    }

    /** Read a single debug field. */
    async getDebugField<K extends keyof DebugStatsState>(key: K): Promise<DebugStatsState[K]> {
        return this.page.evaluate(k => window.__settlers__!.debug![k], key) as Promise<DebugStatsState[K]>;
    }

    /** Read the full view state object (mode, selection, entity counts). */
    async getView(): Promise<GameViewStateData> {
        return this.page.evaluate(() => {
            return { ...window.__settlers__!.view! };
        });
    }

    /** Read a single view state field. */
    async getViewField<K extends keyof GameViewStateData>(key: K): Promise<GameViewStateData[K]> {
        return this.page.evaluate(k => window.__settlers__!.view![k], key) as Promise<GameViewStateData[K]>;
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
        await this.page.keyboard.press('Escape');
    }

    // ── Composite actions (multi-step) ──────────────────────

    /** Wait until the game UI is mounted in the DOM. */
    async waitForGameUi(timeout?: number): Promise<void> {
        return this.wait.waitForGameUi(this.gameUi, timeout);
    }

    /**
     * Move camera to center on a specific tile position.
     * Waits for the camera position to propagate through the render loop.
     */
    async moveCamera(tileX: number, tileY: number): Promise<void> {
        await this.actions.setCameraPosition(tileX, tileY);
        await this.wait.waitForFrames(Frames.STATE_PROPAGATE, Timeout.DEFAULT);
    }

    /** Toggle music on or off via SoundManager. */
    async toggleMusic(enabled: boolean): Promise<void> {
        await this.audio.setMusicEnabled(enabled);
        await this.wait.waitForFrames(Frames.STATE_PROPAGATE);
    }

    /**
     * Trigger user interaction to unlock AudioContext.
     * Waits for AudioContext to be in 'running' state or times out gracefully.
     */
    async unlockAudio(): Promise<void> {
        await this.canvas.click();
        // AudioContext may not exist or may be suspended — that's OK for tests that don't need audio
        await this.wait.waitForAudioContextRunning().catch(() => {});
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
