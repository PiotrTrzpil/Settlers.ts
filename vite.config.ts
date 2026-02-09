/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import glsl from 'vite-plugin-glsl';
import { resolve } from 'path';

export default defineConfig({
    plugins: [
        vue(),
        glsl()
    ],
    define: {
        // Build timestamp for cache invalidation on server restart
        __BUILD_TIME__: JSON.stringify(Date.now().toString()),
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
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
        include: ['tests/unit/**/*.spec.ts']
    }
});
