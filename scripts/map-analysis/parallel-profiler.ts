/**
 * Parallel map profiler — spawns child processes to profile map batches.
 * Each child receives map paths as CLI args, outputs JSON to stdout.
 */
import { execFile } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { MapProfileResult } from './object-profile';

const CHILD_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'profile-batch-child.ts');

const TSX_BIN = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

interface BatchResult {
    results: MapProfileResult[];
    scanned: number;
}

/**
 * Profile all maps in parallel by splitting into batches across child processes.
 */
export async function profileMapsParallel(mapPaths: string[], concurrency: number): Promise<BatchResult> {
    if (mapPaths.length === 0) return { results: [], scanned: 0 };

    const batches: string[][] = Array.from({ length: concurrency }, () => []);
    for (let i = 0; i < mapPaths.length; i++) {
        batches[i % concurrency]!.push(mapPaths[i]!);
    }

    const empty: BatchResult = { results: [], scanned: 0 };

    const promises = batches
        .filter(batch => batch.length > 0)
        .map(
            batch =>
                new Promise<BatchResult>(resolve => {
                    execFile(
                        TSX_BIN,
                        [CHILD_SCRIPT, ...batch],
                        { maxBuffer: 256 * 1024 * 1024 },
                        (err, stdout, stderr) => {
                            if (stderr) process.stderr.write(stderr);
                            if (err) {
                                console.error(`Worker process failed: ${err.message}`);
                                resolve(empty);
                                return;
                            }
                            if (!stdout) {
                                resolve(empty);
                                return;
                            }
                            try {
                                resolve(JSON.parse(stdout));
                            } catch {
                                console.error('Failed to parse worker output');
                                resolve(empty);
                            }
                        }
                    );
                })
        );

    const batchResults = await Promise.all(promises);
    const allResults: MapProfileResult[] = [];
    let totalScanned = 0;
    for (const r of batchResults) {
        allResults.push(...r.results);
        totalScanned += r.scanned;
    }
    return { results: allResults, scanned: totalScanned };
}
