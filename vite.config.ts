/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import glsl from 'vite-plugin-glsl';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';

// Only include polyfills in browser builds, not in test environment
const isTest = process.env.VITEST === 'true';

export default defineConfig({
    plugins: [
        vue(),
        glsl(),
        // Polyfill Node.js core modules for browser (required by fengari Lua VM)
        // Disabled in test mode to allow real Node.js fs/path etc.
        !isTest && nodePolyfills({
            globals: {
                process: true,
                Buffer: true,
                global: true,
            },
        }),
    ].filter(Boolean),
    define: {
        // Build timestamp for cache invalidation on server restart
        __BUILD_TIME__: JSON.stringify(Date.now().toString()),
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        }
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
        environment: 'jsdom',
        include: ['tests/unit/**/*.spec.ts'],
        // Limit parallelism to avoid resource exhaustion
        pool: 'threads',
        poolOptions: {
            threads: {
                minThreads: 1,
                maxThreads: 4,
            }
        },
        // Timeouts to prevent hung processes
        testTimeout: 10000,
        hookTimeout: 10000,
        teardownTimeout: 5000,
        // Force exit after tests complete (helps with stale processes)
        passWithNoTests: true,
    }
});
