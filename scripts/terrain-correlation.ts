/**
 * Correlate unmapped decoration raw values with terrain types.
 * Shows which ground type each unmapped decoration appears on most.
 *
 * Run: npx tsx scripts/terrain-correlation.ts <map-file>
 */
import { RAW_OBJECT_REGISTRY } from '../src/resources/map/raw-object-registry';
import { loadMapData, getMapPathFromArgs, getGroundTypeName, DARK_GROUND_TYPES } from './map-analysis';

const mapFilePath = getMapPathFromArgs('terrain-correlation.ts');
const data = loadMapData(mapFilePath);

const knownRawValues = new Set(RAW_OBJECT_REGISTRY.map(e => e.raw));

// Build per-raw-value terrain histogram (only unmapped decoration values)
const terrainByRaw = new Map<number, Map<number, number>>();
const totalByRaw = new Map<number, number>();

for (let i = 0; i < data.tileCount; i++) {
    const rawVal = data.objectBytes[i]!;
    if (rawVal <= 18 || rawVal === 0) continue; // skip trees and empty
    if (rawVal >= 124 && rawVal <= 135) continue; // skip resource stone
    if (knownRawValues.has(rawVal)) continue; // skip already mapped

    const groundType = data.groundTypes[i]!;
    if (!terrainByRaw.has(rawVal)) terrainByRaw.set(rawVal, new Map());
    const terrainHist = terrainByRaw.get(rawVal)!;
    terrainHist.set(groundType, (terrainHist.get(groundType) ?? 0) + 1);
    totalByRaw.set(rawVal, (totalByRaw.get(rawVal) ?? 0) + 1);
}

// Sort by count descending
const sorted = [...totalByRaw.entries()].sort((a, b) => b[1] - a[1]);

console.log(`Map: ${data.filename} (${data.mapWidth}x${data.mapWidth})`);
console.log(`Unmapped decoration types: ${sorted.length}\n`);

console.log('Raw\tCount\tDark%\tTop terrains');
console.log('---\t-----\t-----\t------------');

for (const [raw, total] of sorted) {
    const terrainHist = terrainByRaw.get(raw)!;
    const terrainSorted = [...terrainHist.entries()].sort((a, b) => b[1] - a[1]);

    let darkCount = 0;
    for (const [gt, count] of terrainHist) {
        if (DARK_GROUND_TYPES.has(gt)) darkCount += count;
    }
    const darkPct = Math.round((darkCount / total) * 100);

    const topTerrains = terrainSorted
        .slice(0, 3)
        .map(([gt, c]) => `${getGroundTypeName(gt)}:${c}`)
        .join(', ');

    console.log(`${raw}\t${total}\t${darkPct}%\t${topTerrains}`);
}

// Summary: group by dark ground affinity
console.log('\n--- Dark ground candidates (>50% on dark terrain) ---');
const darkCandidates: Array<{ raw: number; count: number; darkPct: number }> = [];
const nonDarkCandidates: Array<{ raw: number; count: number; darkPct: number }> = [];

for (const [raw, total] of sorted) {
    const terrainHist = terrainByRaw.get(raw)!;
    let darkCount = 0;
    for (const [gt, count] of terrainHist) {
        if (DARK_GROUND_TYPES.has(gt)) darkCount += count;
    }
    const darkPct = Math.round((darkCount / total) * 100);
    if (darkPct > 50) {
        darkCandidates.push({ raw, count: total, darkPct });
    } else {
        nonDarkCandidates.push({ raw, count: total, darkPct });
    }
}

for (const c of darkCandidates) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkPct}%`);
}

console.log('\n--- Non-dark unmapped ---');
for (const c of nonDarkCandidates) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkPct}%`);
}
