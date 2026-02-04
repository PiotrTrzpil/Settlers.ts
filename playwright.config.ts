import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:8080',
        headless: true,
        viewport: { width: 1280, height: 720 }
    },
    webServer: {
        command: 'npm run build && npx serve dist -s -l 8080',
        url: 'http://localhost:8080',
        timeout: 120000,
        reuseExistingServer: true
    }
});
