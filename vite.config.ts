import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import glsl from 'vite-plugin-glsl';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';
import { computeSourceHash } from './tests/e2e/source-hash';
import { devWriteFilePlugin } from './vite-plugins/dev-write-file';
import { cliWsPlugin } from './vite-plugins/cli-ws-plugin';

// Only include polyfills in browser builds, not in test environment
const isTest = process.env['VITEST'] === 'true';
// Fast build skips fengari/node-polyfills (incompatible with rolldown-vite)
const isFastBuild = process.env['FAST_BUILD'] === '1';

// Deterministic run ID shared by all Vitest workers → single timeline DB per run
const timelineRunId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
if (isTest) {
    const dbPath = `tests/unit/.timeline/run_${timelineRunId}.db`;

    console.log(`Timeline DB: ${dbPath}`);
}

// Load node polyfills plugin only when needed (full build + non-test)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugins: any[] = [
    vue({ features: { optionsAPI: false } }),
    glsl(),
    wasm(),
    devWriteFilePlugin(resolve(__dirname)),
    cliWsPlugin(),
];
if (!isTest && !isFastBuild) {
    const { nodePolyfills } = await import('vite-plugin-node-polyfills');
    plugins.push(
        nodePolyfills({
            globals: {
                process: true,
                Buffer: true,
                global: true,
            },
        })
    );
}

export default defineConfig({
    plugins,
    define: {
        // Build timestamp for cache invalidation on server restart
        __BUILD_TIME__: JSON.stringify(Date.now().toString()),
        // Source hash for stale server detection in e2e tests
        __SOURCE_HASH__: JSON.stringify(computeSourceHash()),
        // Vue feature flags — tree-shake unused features in production
        __VUE_OPTIONS_API__: false,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    build: {
        // Skip gzip size computation in fast builds (saves ~1-2s)
        reportCompressedSize: !isFastBuild,
        rollupOptions: {
            // In fast builds, externalize fengari so the dynamic import fails gracefully
            // (game.ts already catches this and disables Lua scripting)
            external: isFastBuild ? ['fengari', 'fengari-interop'] : [],
        },
    },
    server: {
        port: 5173,
        hmr: {
            // If HMR update fails, trigger full reload instead of getting stuck
            overlay: true,
        },
        // Note: COOP/COEP headers for SharedArrayBuffer can be enabled later
        // when SharedArrayBuffer support is properly implemented
    },
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.spec.ts'],
        globalSetup: ['tests/unit/helpers/global-setup.ts'],
        reporters: process.env['CI'] ? ['verbose', 'github-actions'] : ['dot'],
        setupFiles: ['tests/unit/helpers/silence-console.ts'],
        disableConsoleIntercept: true,
        // Timeouts to prevent hung processes
        testTimeout: 10000,
        hookTimeout: 10000,
        teardownTimeout: 5000,
        passWithNoTests: true,
        // Shared run ID so all workers write to the same timeline DB file
        env: {
            TIMELINE_RUN_ID: timelineRunId,
        },
        // Node v25+ exposes a global localStorage that warns when accessed without
        // --localstorage-file. Game code accesses localStorage transitively during tests.
        // Give each worker fork a unique temp file (PID-based) to avoid SQLite lock contention.
        execArgv: ['--localstorage-file', `${process.env['TMPDIR'] ?? '/tmp'}/vitest-localstorage`],
    },
});
