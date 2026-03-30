/**
 * Correlate unmapped decoration raw values with terrain types.
 * Shows which ground type each unmapped decoration appears on most,
 * grouped by dark-ground affinity.
 *
 * Run: npx tsx scripts/map-analysis/cli-terrain-correlation.ts <map-file>
 */
import { loadMapData, getMapPathFromArgs, buildObjectProfiles } from './index';

const mapFilePath = getMapPathFromArgs('map-analysis/cli-terrain-correlation.ts');
const data = loadMapData(mapFilePath);
const profiles = buildObjectProfiles(data).filter(p => !p.registered);

console.log(`Map: ${data.filename} (${data.mapWidth}x${data.mapWidth})`);
console.log(`Unmapped decoration types: ${profiles.length}\n`);

console.log('Raw\tCount\tDark%\tTop terrains');
console.log('---\t-----\t-----\t------------');

for (const p of profiles) {
    const topTerrains = p.terrainGroups
        .slice(0, 3)
        .map(g => `${g.group}:${g.pct}%`)
        .join(', ');
    console.log(`${p.raw}\t${p.count}\t${p.darkLandPct}%\t${topTerrains}`);
}

const darkCandidates = profiles.filter(p => p.darkLandPct > 50);
const nonDark = profiles.filter(p => p.darkLandPct <= 50);

console.log(`\n--- Dark ground candidates (>50% on dark terrain): ${darkCandidates.length} ---`);
for (const c of darkCandidates) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkLandPct}%`);
}

console.log(`\n--- Non-dark unmapped: ${nonDark.length} ---`);
for (const c of nonDark) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkLandPct}%`);
}
