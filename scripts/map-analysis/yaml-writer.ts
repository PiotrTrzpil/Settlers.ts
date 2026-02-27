/**
 * YAML output writer for map analysis results.
 * Writes structured YAML with map metadata, per-object profiles,
 * category summaries, and terrain group summaries.
 *
 * Uses manual YAML generation (no dependency) for clean, readable output.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ObjectProfile, CategorySummary, TerrainGroupSummary } from './object-profile';

interface YamlReportInput {
    filename: string;
    mapWidth: number;
    tileCount: number;
    profiles: ObjectProfile[];
    categorySummaries: CategorySummary[];
    terrainGroupSummaries: TerrainGroupSummary[];
}

/** Write analysis results to a YAML file. Returns the output path. */
export function writeYamlReport(input: YamlReportInput, outputPath?: string): string {
    const { filename, mapWidth, tileCount, profiles, categorySummaries, terrainGroupSummaries } = input;
    const totalObjects = profiles.reduce((s, p) => s + p.count, 0);
    const unmappedProfiles = profiles.filter(p => !p.mapped);

    const resolvedPath = outputPath ?? deriveOutputPath(filename);
    const lines: string[] = [];

    const w = (line: string) => lines.push(line);

    // Map metadata
    w('# Map Object Profile Analysis');
    w(`# Generated: ${new Date().toISOString()}`);
    w('');
    w('map:');
    w(`  filename: ${filename}`);
    w(`  size: ${mapWidth}x${mapWidth}`);
    w(`  total_tiles: ${tileCount}`);
    w(`  object_tiles: ${totalObjects}`);
    w(`  coverage_pct: ${Math.round((totalObjects / tileCount) * 100)}`);
    w(`  unique_raw_values: ${profiles.length}`);
    w(`  mapped_types: ${profiles.length - unmappedProfiles.length}`);
    w(`  unmapped_types: ${unmappedProfiles.length}`);

    // Terrain group summary
    w('');
    w('terrain_groups:');
    for (const tgs of terrainGroupSummaries) {
        w(`  - group: ${tgs.group}`);
        w(`    objects: ${tgs.objectCount}`);
        w(`    pct_of_total: ${tgs.pctOfTotal}`);
        w(`    unique_types: ${tgs.uniqueTypes}`);
    }

    // Category summary
    w('');
    w('categories:');
    for (const cs of categorySummaries) {
        w(`  - category: ${cs.category}`);
        w(`    count: ${cs.totalCount}`);
        w(`    unique_types: ${cs.uniqueTypes}`);
        w(`    avg_height: ${cs.avgHeight}`);
        w(`    primary_terrain: ${cs.primaryGroup}`);
        w(`    primary_terrain_pct: ${cs.primaryGroupPct}`);
    }

    // Per-object profiles
    w('');
    w('objects:');
    for (const p of profiles) {
        w(`  - raw: ${p.raw}`);
        w(`    label: ${yamlStr(p.label)}`);
        w(`    category: ${p.category}`);
        w(`    mapped: ${p.mapped}`);
        w(`    count: ${p.count}`);
        w(`    primary_group: ${p.primaryGroup}`);

        // Height
        w('    height:');
        w(`      min: ${p.height.min}`);
        w(`      max: ${p.height.max}`);
        w(`      avg: ${p.height.avg}`);
        w(`      median: ${p.height.median}`);

        // Flags
        w(`    dark_land_pct: ${p.darkLandPct}`);
        w(`    pond_pct: ${p.pondPct}`);

        // Terrain groups (compact)
        w('    terrain_groups:');
        for (const tg of p.terrainGroups) {
            w(`      - { group: ${tg.group}, count: ${tg.count}, pct: ${tg.pct} }`);
        }

        // Top terrain types (limit to top 5 for readability)
        w('    terrain_types:');
        for (const t of p.terrain.slice(0, 5)) {
            w(`      - { type: ${yamlStr(t.name)}, ground_type: ${t.groundType}, count: ${t.count}, pct: ${t.pct} }`);
        }
    }

    const content = lines.join('\n') + '\n';
    fs.writeFileSync(resolvedPath, content, 'utf-8');
    return resolvedPath;
}

/** Derive output path from input filename: same dir as script output. */
function deriveOutputPath(mapFilename: string): string {
    const base = path.basename(mapFilename, path.extname(mapFilename));
    return path.resolve(process.cwd(), `${base}-object-profile.yaml`);
}

/** Escape a string for YAML (wrap in quotes if needed). */
function yamlStr(s: string): string {
    if (/^[a-zA-Z0-9_/().]+$/.test(s) && !s.includes(': ')) return s;
    return `"${s.replace(/"/g, '\\"')}"`;
}
