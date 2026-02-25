/**
 * Vite dev-only plugin: POST /__api/write-file endpoint.
 *
 * Allows debug tools running in the browser to save data back to source files
 * (e.g., the stack position editor). Only active in `serve` mode.
 *
 * Body: { path: string (relative to project root), content: string }
 */

import type { Plugin, ViteDevServer } from 'vite';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';

/**
 * Temporarily suppress Vite HMR for a file path.
 * Unwatches before the write, re-watches after a short delay so the
 * file-system event is ignored and the page doesn't full-reload.
 */
function writeWithoutHmr(server: ViteDevServer, absolute: string, content: string): Promise<void> {
    server.watcher.unwatch(absolute);
    return writeFile(absolute, content, 'utf-8').then(() => {
        setTimeout(() => server.watcher.add(absolute), 500);
    });
}

function collectBody(req: { on(e: string, cb: (d: Buffer) => void): void }): Promise<string> {
    return new Promise(resolve => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
    });
}

async function handleWrite(
    server: ViteDevServer,
    projectRoot: string,
    body: string,
    res: { statusCode: number; end(msg: string): void }
): Promise<void> {
    const { path: filePath, content } = JSON.parse(body) as { path: string; content: string };
    const absolute = resolve(projectRoot, filePath);
    if (!absolute.startsWith(projectRoot)) {
        res.statusCode = 403;
        res.end('Path outside project root');
        return;
    }
    await writeWithoutHmr(server, absolute, content);
    res.statusCode = 200;
    res.end('ok');
}

function onError(res: { statusCode: number; end(msg: string): void }, err: Error): void {
    res.statusCode = 500;
    res.end(err.message);
}

export function devWriteFilePlugin(projectRoot: string): Plugin {
    return {
        name: 'dev-write-file',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use('/__api/write-file', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end('Method not allowed');
                    return;
                }
                collectBody(req)
                    .then(body => handleWrite(server, projectRoot, body, res))
                    .catch((err: Error) => onError(res, err));
            });
        },
    };
}
