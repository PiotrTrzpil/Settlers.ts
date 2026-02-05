import { test } from '@playwright/test';
import { GamePage } from './game-page';

test('capture current river state', async ({ page }) => {
    const gp = new GamePage(page);
    await gp.goto({ testMap: false });
    await gp.waitForReady(10, 60000);

    // Find the river-sea junction area (around 576,265 based on earlier analysis)
    await page.evaluate(() => {
        const cam = (window as any).__settlers_camera__;
        if (cam) cam.setPosition(576, 265);
    });
    await gp.waitForFrames(15);
    await page.setViewportSize({ width: 1200, height: 900 });
    await gp.waitForFrames(5);
    
    await gp.canvas.screenshot({ path: 'tests/e2e/.results/current-river-state.png' });
    console.log('Screenshot saved to tests/e2e/.results/current-river-state.png');
});
