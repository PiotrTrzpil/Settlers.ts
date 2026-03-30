/**
 * Aggregate object profiler — scans ALL maps and builds a comprehensive
 * per-raw-value report: terrain distribution, dark%, height stats,
 * neighbor analysis, map count.
 *
 * Usage: npx tsx scripts/map-analysis/cli-aggregate-profile.ts [--unmapped-only] [--sequential]
 */
import * as fs from 'fs';
import * as path from 'path';
import { findMapFiles, DEFAULT_MAP_DIR } from './map-data-loader';
import { profileMapsSequential } from './profile-builder';
import { buildAggregateProfiles } from './aggregate-builder';
import { writeAggregateYaml } from './yaml-writer';
import { profileMapsParallel } from './parallel-profiler';

const MAX_PARALLEL = 4;
const unmappedOnly = process.argv.includes('--unmapped-only');
const sequential = process.argv.includes('--sequential');
const maps = findMapFiles(DEFAULT_MAP_DIR);

console.log(`Scanning ${maps.length} maps${sequential ? ' (sequential)' : ` (${MAX_PARALLEL} workers)`}...`);

async function run(): Promise<void> {
    const { results: mapProfiles, scanned } = sequential
        ? profileMapsSequential(maps)
        : await profileMapsParallel(maps, MAX_PARALLEL);

    console.log(`Scanned ${scanned}/${maps.length} maps successfully.\n`);

    let aggregated = buildAggregateProfiles(mapProfiles);
    if (unmappedOnly) {
        aggregated = aggregated.filter(p => !p.hasType);
    }

    const yaml = writeAggregateYaml(aggregated, scanned);
    const outPath = path.resolve('scripts/map-analysis/results/aggregate-profile.yaml');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, yaml);
    console.log(`Written ${aggregated.length} entries to ${outPath}`);
}

run();
