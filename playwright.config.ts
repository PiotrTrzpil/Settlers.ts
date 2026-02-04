import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 0,
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
