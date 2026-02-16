import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import glsl from 'vite-plugin-glsl';
import { resolve } from 'path';

// Only include polyfills in browser builds, not in test environment
const isTest = process.env.VITEST === 'true';
// Fast build skips fengari/node-polyfills (incompatible with rolldown-vite)
const isFastBuild = process.env.FAST_BUILD === '1';

// Load node polyfills plugin only when needed (full build + non-test)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugins: any[] = [vue(), glsl()];
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
        reporters: process.env.CI ? ['verbose', 'github-actions'] : ['verbose'],
        // Vitest 4 defaults to 'forks' pool with sensible parallelism
        // Timeouts to prevent hung processes
        testTimeout: 10000,
        hookTimeout: 10000,
        teardownTimeout: 5000,
        // Force exit after tests complete (helps with stale processes)
        passWithNoTests: true,
    },
});
