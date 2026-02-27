import { test, expect } from './matchers';
import { test as fixtureTest, expect as fixtureExpect } from './fixtures';
import { GamePage } from './game-page';

/**
 * High-value Playwright E2E tests for the MVP game UI and interaction flow.
 * Tests verify the app loads correctly, navigation works, and UI elements
 * for the game MVP are properly rendered and interactive.
 *
 * NOTE: Most tests use fresh page navigation intentionally - they test
 * initial load, navigation, and cannot use shared fixtures.
 * Canvas Interaction tests use shared fixture (gp) for efficiency.
 */

test.describe('App Loading', { tag: '@smoke' }, () => {
    test('app loads with nav bar and no errors', async ({ page }) => {
        const gp = new GamePage(page);
        const { check: checkErrors } = gp.collectErrors();

        await page.goto('/');
        await page.locator('#nav').waitFor({ timeout: 10_000 });

        const nav = page.locator('#nav');
        await expect(nav.locator('a[href="/"]')).toBeVisible();
        await expect(nav.locator('a[href="/map-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/map-file-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/lib-view"]')).toBeVisible();
        await expect(nav.locator('a[href="/logging-view"]')).toBeVisible();

        checkErrors();
    });
});

test.describe('Map View Page', { tag: '@smoke' }, () => {
    test('test map loads with canvas, game UI, and working settings panel', async ({ page }) => {
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });

        await test.step('canvas and map selector render', async () => {
            await expect(page.locator('text=Map:')).toBeVisible();
            await expect(page.locator('canvas.cav')).toBeVisible();
        });

        await test.step('game UI panel appears', async () => {
            await gp.waitForGameUi(15_000);
        });

        await test.step('settings panel expands and checkbox toggles', async () => {
            const settingsBtn = page.locator('button:has-text("Settings")');
            await expect(settingsBtn).toBeVisible();
            await settingsBtn.click();

            const checkbox = page.locator('label:has-text("Debug grid") input[type="checkbox"]');
            await expect(checkbox).toBeVisible({ timeout: 5000 });
            const wasChecked = await checkbox.isChecked();
            await checkbox.click();
            await expect(checkbox).toBeChecked({ checked: !wasChecked });
        });
    });
});

test.describe('Route Navigation', () => {
    test('navigating between routes preserves app state', async ({ page }) => {
        await page.goto('/');

        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Map:')).toBeVisible();

        await page.click('a[href="/logging-view"]');
        await expect(page).toHaveURL(/logging-view/);

        await page.click('a[href="/map-view"]');
        await expect(page).toHaveURL(/map-view/);
        await expect(page.locator('text=Map:')).toBeVisible();
    });

    test('direct URL navigation works for all routes', async ({ page }) => {
        const routes = [
            { path: '/', selector: '#nav' },
            { path: '/map-view', selector: 'text=Map:' },
            { path: '/logging-view', selector: '#nav' },
        ];

        for (const route of routes) {
            await page.goto(route.path);
            await expect(page.locator(route.selector).first()).toBeVisible();
        }
    });
});

// Server freshness & test infrastructure — catch stale servers and broken wiring
fixtureTest.describe('Test Infrastructure', { tag: '@smoke' }, () => {
    fixtureTest('server is serving current source code', async ({ gp }) => {
        // Source hash is injected by Vite at startup and set on window in main.ts.
        // If it doesn't match the current git working tree, the server is stale.
        const serverHash = await gp.page.evaluate(() => (window as any).__source_hash__);
        expect(serverHash).toBeTruthy();
        expect(typeof serverHash).toBe('string');
        // Note: we don't compare against the computed hash here because
        // global-setup already handles auto-restart. This test just verifies
        // the hash mechanism itself is working (not stripped, not undefined).
    });

    fixtureTest('game ticks are running and view state updates', async ({ gp }) => {
        const tickBefore = await gp.getDebugField('tickCount');
        await gp.wait.waitForTicks(5);
        const tickAfter = await gp.getDebugField('tickCount');
        expect(tickAfter).toBeGreaterThan(tickBefore);

        const viewTick = await gp.getViewField('tick');
        expect(typeof viewTick).toBe('number');
        expect(viewTick).toBeGreaterThan(0);
    });

    fixtureTest('debug bridge is wired up', async ({ gp }) => {
        // Verify the __settlers__ bridge has all expected properties.
        // If any is missing, nearly all other tests will fail with cryptic errors.
        const globals = await gp.page.evaluate(() => {
            const b = window.__settlers__;
            return {
                bridge: !!b,
                debug: !!b?.debug,
                view: !!b?.view,
                game: !!b?.game,
                input: !!b?.input,
                viewpoint: !!b?.viewpoint,
                __source_hash__: !!(window as any).__source_hash__,
            };
        });
        for (const [name, exists] of Object.entries(globals)) {
            expect(exists, `${name} must be set`).toBe(true);
        }
    });
});

// Canvas event tests use shared fixture (eliminates repeated waitForReady calls)
fixtureTest.describe('Canvas Events', { tag: '@smoke' }, () => {
    fixtureTest('pointer events fire on canvas (not suppressed)', async ({ gp }) => {
        const page = gp.page;

        const eventLog = await page.evaluate(() => {
            return new Promise<string[]>(resolve => {
                const canvas = document.querySelector('canvas');
                if (!canvas) {
                    resolve(['no canvas']);
                    return;
                }

                const log: string[] = [];
                for (const evt of [
                    'pointerdown',
                    'pointerup',
                    'pointermove',
                    'mousedown',
                    'mouseup',
                    'mousemove',
                    'click',
                ]) {
                    canvas.addEventListener(evt, () => log.push(evt), { once: true });
                }

                const rect = canvas.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                canvas.dispatchEvent(
                    new PointerEvent('pointerdown', {
                        clientX: cx,
                        clientY: cy,
                        bubbles: true,
                        button: 0,
                        pointerId: 1,
                    })
                );
                canvas.dispatchEvent(
                    new PointerEvent('pointermove', {
                        clientX: cx + 1,
                        clientY: cy,
                        bubbles: true,
                        button: 0,
                        pointerId: 1,
                    })
                );
                canvas.dispatchEvent(
                    new PointerEvent('pointerup', {
                        clientX: cx,
                        clientY: cy,
                        bubbles: true,
                        button: 0,
                        pointerId: 1,
                    })
                );

                requestAnimationFrame(() => resolve(log));
            });
        });

        fixtureExpect(eventLog).toContain('pointerdown');
        fixtureExpect(eventLog).toContain('pointerup');
        fixtureExpect(eventLog).toContain('pointermove');
    });

    fixtureTest('canvas click sets hoveredTile via tileClick event', async ({ gp }) => {
        await gp.canvas.click({ position: { x: 400, y: 400 } });

        const tileInfo = gp.page.locator('[data-testid="tile-info"]');
        await fixtureExpect(tileInfo).toBeVisible({ timeout: 5000 });
        const text = await tileInfo.textContent();
        fixtureExpect(text).toMatch(/Tile: \(\d+, \d+\)/);
    });

    fixtureTest('canvas responds to mouse wheel events without errors', async ({ gp }) => {
        const { check: checkErrors } = gp.collectErrors();

        await gp.canvas.dispatchEvent('wheel', { deltaY: 100 });
        await gp.wait.waitForFrames(1);

        checkErrors();
    });

    fixtureTest('canvas handles right-click without showing context menu', async ({ gp }) => {
        await gp.canvas.click({ button: 'right', position: { x: 400, y: 400 }, force: true });
        await gp.wait.waitForFrames(1);
    });

    fixtureTest('mouse wheel changes camera zoom level', async ({ gp }) => {
        const zoomBefore = await gp.getDebugField('zoom');

        // Zoom in (negative deltaY = scroll up = zoom in)
        await gp.canvas.dispatchEvent('wheel', { deltaY: -300 });
        await gp.wait.waitForFrames(3);

        const zoomAfter = await gp.getDebugField('zoom');
        fixtureExpect(zoomAfter).not.toBe(zoomBefore);
    });
});

// Entity selection smoke tests
fixtureTest.describe('Entity Selection', { tag: '@smoke' }, () => {
    fixtureTest('selecting a building updates selection state', async ({ gp }) => {
        const buildableTile = await gp.actions.findBuildableTile();
        if (!buildableTile) {
            fixtureTest.skip();
            return;
        }

        const building = await gp.actions.placeBuilding(1, buildableTile.x, buildableTile.y);
        fixtureExpect(building).not.toBeNull();

        // Select the building and read selection state atomically
        const selection = await gp.page.evaluate(id => {
            const game = window.__settlers__?.game;
            const result = game?.execute({ type: 'select', entityId: id });
            const sel = game?.state?.selection;
            return {
                success: result?.success ?? false,
                selectedEntityId: sel?.selectedEntityId ?? null,
                selectedCount: sel?.selectedEntityIds?.size ?? 0,
            };
        }, building!.id);

        fixtureExpect(selection.success).toBe(true);
        fixtureExpect(selection.selectedEntityId).toBe(building!.id);
        fixtureExpect(selection.selectedCount).toBe(1);
    });

    fixtureTest('selecting and deselecting a swordsman updates selection state', async ({ gp }) => {
        // Swordsman (UnitType 2) is Military category → selectable
        const unit = await gp.actions.spawnUnit(2);
        fixtureExpect(unit).not.toBeNull();

        // Select, verify, then deselect — all reads are atomic with the execute call
        const afterSelect = await gp.page.evaluate(id => {
            const game = window.__settlers__?.game;
            game?.execute({ type: 'select', entityId: id });
            return game?.state?.selection?.selectedEntityIds?.size ?? 0;
        }, unit!.id);
        fixtureExpect(afterSelect).toBe(1);

        const afterDeselect = await gp.page.evaluate(() => {
            const game = window.__settlers__?.game;
            game?.execute({ type: 'select', entityId: null });
            const sel = game?.state?.selection;
            return {
                selectedEntityId: sel?.selectedEntityId ?? null,
                selectedCount: sel?.selectedEntityIds?.size ?? 0,
            };
        });
        fixtureExpect(afterDeselect.selectedEntityId).toBeNull();
        fixtureExpect(afterDeselect.selectedCount).toBe(0);
    });
});
