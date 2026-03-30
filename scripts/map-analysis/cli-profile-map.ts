/**
 * Unified map object profiler.
 * Analyzes ALL map objects and their terrain context: ground type distribution,
 * height statistics, dark-land/pond flag correlations, category & group summaries.
 *
 * Always writes a YAML report file alongside console output.
 *
 * Run: npx tsx scripts/map-analysis/cli-profile-map.ts <map-file> [options]
 *
 * Options:
 *   --unmapped-only    Only show unmapped raw values
 *   --category <cat>   Filter by category (e.g., "trees", "plants", "stone")
 *   --sort <field>     Sort by: count (default), raw, height, dark, pond
 *   --top <n>          Show only top N entries (default: all)
 *   --json             Output profiles as JSON to stdout (no table)
 *   --out <path>       Custom YAML output path (default: <mapname>-object-profile.yaml)
 *   --no-yaml          Skip YAML file output
 */
import {
    loadMapData,
    getMapPathFromArgs,
    buildObjectProfiles,
    buildCategorySummaries,
    buildTerrainGroupSummaries,
    printFullReport,
    writeYamlReport,
} from './index';

// Parse CLI args
const mapFilePath = getMapPathFromArgs('map-analysis/cli-profile-map.ts');

const args = process.argv.slice(3);
const unmappedOnly = args.includes('--unmapped-only');
const jsonOutput = args.includes('--json');
const noYaml = args.includes('--no-yaml');
const categoryIdx = args.indexOf('--category');
const categoryFilter = categoryIdx >= 0 ? args[categoryIdx + 1]?.toLowerCase() : undefined;
const sortIdx = args.indexOf('--sort');
const sortField = sortIdx >= 0 ? args[sortIdx + 1] : 'count';
const topIdx = args.indexOf('--top');
const topN = topIdx >= 0 ? parseInt(args[topIdx + 1]!, 10) : undefined;
const outIdx = args.indexOf('--out');
const yamlOutputPath = outIdx >= 0 ? args[outIdx + 1] : undefined;

// Load and analyze
const data = loadMapData(mapFilePath);
let profiles = buildObjectProfiles(data);

// Keep unfiltered profiles for YAML (write full report regardless of display filters)
const allProfiles = profiles;

// Apply filters
if (unmappedOnly) {
    profiles = profiles.filter(p => !p.registered);
}
if (categoryFilter) {
    profiles = profiles.filter(p => p.category.toLowerCase().includes(categoryFilter));
}

// Apply sort
switch (sortField) {
    case 'raw':
        profiles.sort((a, b) => a.raw - b.raw);
        break;
    case 'height':
        profiles.sort((a, b) => b.height.avg - a.height.avg);
        break;
    case 'dark':
        profiles.sort((a, b) => b.darkLandPct - a.darkLandPct);
        break;
    case 'pond':
        profiles.sort((a, b) => b.pondPct - a.pondPct);
        break;
    // 'count' is the default sort from buildObjectProfiles
}

// Apply top limit
if (topN && topN > 0) {
    profiles = profiles.slice(0, topN);
}

// Console output
if (jsonOutput) {
    console.log(JSON.stringify(profiles, null, 2));
} else {
    const categorySummaries = buildCategorySummaries(profiles);
    const terrainGroupSummaries = buildTerrainGroupSummaries(profiles);
    printFullReport(data.filename, data.mapWidth, data.tileCount, profiles, categorySummaries, terrainGroupSummaries);
}

// YAML file output (always full unfiltered data)
if (!noYaml) {
    const allCategorySummaries = buildCategorySummaries(allProfiles);
    const allTerrainGroupSummaries = buildTerrainGroupSummaries(allProfiles);
    const yamlPath = writeYamlReport(
        {
            filename: data.filename,
            mapWidth: data.mapWidth,
            tileCount: data.tileCount,
            profiles: allProfiles,
            categorySummaries: allCategorySummaries,
            terrainGroupSummaries: allTerrainGroupSummaries,
        },
        yamlOutputPath
    );
    console.log(`\nYAML report written to: ${yamlPath}`);
}
