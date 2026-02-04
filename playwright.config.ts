import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './tests/e2e/.results',
    timeout: 30000,
    retries: 0,
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
    expect: {
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
        viewport: { width: 1280, height: 720 }
    },
    webServer: {
        command: 'npm run build && npx vite preview --port 4173',
        url: 'http://localhost:4173',
        timeout: 120000,
        reuseExistingServer: true
    }
});
