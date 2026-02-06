import { defineConfig } from '@playwright/test';

// Global test timeout in ms — override with E2E_TIMEOUT env variable:
//   E2E_TIMEOUT=60000 npx playwright test
const globalTimeout = Number(process.env.E2E_TIMEOUT) || 30_000;

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './tests/e2e/.results',
    timeout: globalTimeout,
    retries: 0,
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
    expect: {
        timeout: Math.min(globalTimeout, 10_000),
        toMatchSnapshot: {
            maxDiffPixelRatio: 0.01,
        },
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
            animations: 'disabled',
        },
    },
    use: {
        baseURL: 'http://localhost:4173',
        headless: true,
        viewport: { width: 1280, height: 720 },
        // Cap individual actions (clicks, fills, etc.) and navigation
        actionTimeout: Math.min(globalTimeout, 10_000),
        navigationTimeout: Math.min(globalTimeout, 15_000),
        // Disable cache to avoid ERR_CACHE_WRITE_FAILURE with large GFX files
        bypassCSP: true,
        launchOptions: {
            args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
        },
    },
    webServer: {
        command: 'npm run build && npx vite preview --port 4173',
        url: 'http://localhost:4173',
        timeout: 120000,
        reuseExistingServer: true
    }
});
