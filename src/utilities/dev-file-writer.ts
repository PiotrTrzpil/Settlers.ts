/**
 * Dev File Writer — saves files via the Vite dev server endpoint.
 *
 * The server plugin (`vite-plugins/dev-write-file.ts`) temporarily unwatches
 * the file before writing, so the save does not trigger an HMR reload.
 *
 * Usage:
 *   import { writeDevFile } from '@/utilities/dev-file-writer';
 *   writeDevFile('src/game/features/foo/data/bar.yaml', yamlContent);
 */

/**
 * Write a file to disk via the Vite dev server `/__api/write-file` endpoint.
 * The server handles HMR suppression automatically.
 *
 * @param filePath Relative path from project root (e.g. 'src/game/data/foo.yaml')
 * @param content  File content to write
 */
export function writeDevFile(filePath: string, content: string): void {
    fetch('/__api/write-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
    }).then(
        res => {
            if (res.ok) {
                console.log(`Saved ${filePath}`);
            } else {
                console.warn(`Failed to save ${filePath}:`, res.statusText);
            }
        },
        () => {
            console.warn(`Dev server unavailable. Content for ${filePath}:\n${content}`);
        }
    );
}
