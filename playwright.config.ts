import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration with project-based test tiers.
 *
 * Test Tiers:
 *   @smoke       - Core functionality, < 5s each, runs on every commit
 *   @integration - Full flows, < 15s each, runs on PR (default)
 *   @slow        - Complex tests, < 30s each
 *   @requires-assets - Needs real game files, < 60s, runs nightly/on-demand
 *   @screenshot  - Visual regression tests
 *
 * Run specific tiers:
 *   npx playwright test --project=smoke
 *   npx playwright test --project=slow
 *   npx playwright test --grep @requires-assets
 *   npx playwright test --grep-invert @requires-assets  # Skip asset tests
 */

// Detect cloud/CI environments for automatic mitigations
// CLAUDE_CODE_REMOTE is set by Claude Code web environments
const isCloudEnv = process.env.CI || process.env.CLAUDE_CODE_REMOTE === 'true';

// Base settings shared across projects
const baseSettings = {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    bypassCSP: true,
    trace: 'retain-on-failure' as const,
    screenshot: 'only-on-failure' as const,
    launchOptions: {
        args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            // Cloud/CI: avoid /dev/shm issues and enable software WebGL
            ...(isCloudEnv ? [
                '--disable-dev-shm-usage',
                '--use-gl=swiftshader',
                '--enable-webgl',
            ] : []),
        ],
    },
};

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './tests/e2e/.results',
    globalSetup: './tests/e2e/global-setup.ts',
    fullyParallel: true,
    reporter: process.env.CI
        ? [['list'], ['github-actions']]
        : [['list'], ['html', { open: 'never' }]],
    // Limit workers to avoid overwhelming shared worker fixtures (testMapPage)
    // Tests use worker-scoped pages that can't handle too many parallel tests
    workers: 2,
    retries: 0,
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

    expect: {
        timeout: 5_000,
        toMatchSnapshot: { maxDiffPixelRatio: 0.01 },
        toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    },

    // Project-based configuration for different test tiers
    projects: [
        {
            name: 'smoke',
            testMatch: '**/*.spec.ts',
            grep: /@smoke/,
            grepInvert: /@requires-assets|@slow/,
            timeout: 10_000,
            use: {
                ...baseSettings,
                actionTimeout: 2_000,
                navigationTimeout: 5_000,
            },
        },
        {
            name: 'default',
            testMatch: '**/*.spec.ts',
            grepInvert: /@requires-assets|@slow|@screenshot|@smoke/,
            timeout: 15_000,
            use: {
                ...baseSettings,
                actionTimeout: 3_000,
                navigationTimeout: 5_000,
            },
        },
        {
            name: 'slow',
            testMatch: '**/*.spec.ts',
            grep: /@slow/,
            grepInvert: /@requires-assets/,
            timeout: 30_000,
            use: {
                ...baseSettings,
                actionTimeout: 5_000,
                navigationTimeout: 10_000,
            },
        },
        {
            name: 'assets',
            testMatch: '**/*.spec.ts',
            grep: /@requires-assets/,
            timeout: 60_000,
            use: {
                ...baseSettings,
                actionTimeout: 10_000,
                navigationTimeout: 30_000,
            },
        },
        {
            name: 'visual',
            testMatch: '**/*.spec.ts',
            grep: /@screenshot/,
            timeout: 20_000,
            use: {
                ...baseSettings,
                actionTimeout: 3_000,
                navigationTimeout: 10_000,
            },
        },
    ],

    webServer: {
        command: 'npm run build && npx vite preview --port 4173',
        url: 'http://localhost:4173',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
    },
});
