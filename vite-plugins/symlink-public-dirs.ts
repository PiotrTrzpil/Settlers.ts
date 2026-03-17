/**
 * Vite build plugin: symlink large public directories instead of copying them.
 *
 * Vite's default behavior copies everything from public/ into dist/ at build time.
 * For large asset directories (e.g. Siedler4 at ~5GB), this wastes disk space.
 * This plugin disables copyPublicDir, copies small files normally, and creates
 * relative symlinks for the specified directories.
 */

import type { Plugin } from 'vite';
import { cpSync, existsSync, readdirSync, rmSync, symlinkSync, statSync } from 'fs';
import { resolve, relative, dirname } from 'path';

export function symlinkPublicDirsPlugin(dirs: string[]): Plugin {
    const dirSet = new Set(dirs);
    let outDir: string;
    let publicDir: string;

    return {
        name: 'symlink-public-dirs',
        apply: 'build',

        configResolved(config) {
            outDir = config.build.outDir;
            publicDir = config.publicDir;
            // Disable Vite's built-in public copy — we handle it ourselves
            config.build.copyPublicDir = false;
        },

        closeBundle() {
            const absOut = resolve(outDir);

            for (const entry of readdirSync(publicDir)) {
                const src = resolve(publicDir, entry);
                const dest = resolve(absOut, entry);

                if (dirSet.has(entry) && statSync(src).isDirectory()) {
                    // Clean up any previous copy/symlink before creating
                    if (existsSync(dest)) rmSync(dest, { recursive: true });
                    // Relative symlink so it works if the project is moved
                    const target = relative(dirname(dest), src);
                    symlinkSync(target, dest);
                } else {
                    cpSync(src, dest, { recursive: true });
                }
            }
        },
    };
}
