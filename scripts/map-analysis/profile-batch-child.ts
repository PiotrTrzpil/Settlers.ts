/**
 * Child process: receives map paths as CLI args, profiles each,
 * writes JSON results to stdout.
 */
import * as path from 'path';
import { loadMapData } from './map-data-loader';
import { buildObjectProfiles } from './profile-builder';
import type { MapProfileResult } from './object-profile';

const mapPaths = process.argv.slice(2);
const results: MapProfileResult[] = [];
let scanned = 0;

for (const mapPath of mapPaths) {
    try {
        const data = loadMapData(mapPath);
        const profiles = buildObjectProfiles(data);
        results.push({ mapName: path.basename(mapPath, '.map'), profiles });
        scanned++;
    } catch (err) {
        process.stderr.write(
            `Failed to parse ${path.basename(mapPath)}: ${err instanceof Error ? err.message : err}\n`
        );
    }
}

process.stdout.write(JSON.stringify({ results, scanned }));
