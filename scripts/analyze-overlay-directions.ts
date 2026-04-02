/**
 * Analyze building overlay directions across all races.
 *
 * For each race, loads the GFX JIL/DIL files and the buildingInfo.xml patches,
 * then compares the XML patch ordering with the actual GFX direction count.
 *
 * Goal: determine whether the XML patch order (0-based position among patches)
 * corresponds to the DIL direction index (offset by 1 for the base building sprite).
 *
 * Usage:
 *   npx tsx scripts/analyze-overlay-directions.ts
 *   npx tsx scripts/analyze-overlay-directions.ts --building SMELTGOLD
 *   npx tsx scripts/analyze-overlay-directions.ts --building SMELTIRON,BAKERY
 */

import { DilFileReader } from '../src/resources/gfx/dil-file-reader';
import { JilFileReader } from '../src/resources/gfx/jil-file-reader';
import { NodeFileSystem } from '../src/resources/gfx/exporter/file-system';
import { parseBuildingInfo } from '../src/resources/game-data/building-info-parser';
import { BUILDING_JOB_INDICES } from '../src/game/renderer/sprite-metadata/jil-indices';
import { getBuildingTypesByXmlId } from '../src/game/data/game-data-access';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

// Polyfill DOMParser for Node.js
if (typeof globalThis.DOMParser === 'undefined') {
    const dom = new JSDOM('');
    globalThis.DOMParser = dom.window.DOMParser;
}

const GFX_DIR = 'public/Siedler4/Gfx';
const GAME_DATA_DIR = 'public/Siedler4/GameData';

const RACES: { name: string; id: string; gfxFile: number }[] = [
    { name: 'Roman', id: 'RACE_ROMAN', gfxFile: 10 },
    { name: 'Viking', id: 'RACE_VIKING', gfxFile: 11 },
    { name: 'Mayan', id: 'RACE_MAYA', gfxFile: 12 },
    { name: 'DarkTribe', id: 'RACE_DARK', gfxFile: 13 },
    { name: 'Trojan', id: 'RACE_TROJAN', gfxFile: 14 },
];

function parseArgs(): { buildingFilter: string[] | null } {
    const args = process.argv.slice(2);
    let buildingFilter: string[] | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--building' && args[i + 1]) {
            buildingFilter = args[++i]!.split(',').map(b => b.toUpperCase());
        }
    }
    return { buildingFilter };
}

interface RaceGfxData {
    jil: JilFileReader;
    dil: DilFileReader;
}

async function loadRaceGfx(gfxFile: number): Promise<RaceGfxData | null> {
    const nodeFs = new NodeFileSystem();
    const jilPath = `${GFX_DIR}/${gfxFile}.jil`;
    const dilPath = `${GFX_DIR}/${gfxFile}.dil`;

    if (!(await nodeFs.exists(jilPath)) || !(await nodeFs.exists(dilPath))) {
        return null;
    }

    const [jilData, dilData] = await Promise.all([nodeFs.readFile(jilPath), nodeFs.readFile(dilPath)]);

    return {
        jil: new JilFileReader(jilData),
        dil: new DilFileReader(dilData),
    };
}

function getDirectionCount(gfx: RaceGfxData, jobIndex: number): number | null {
    const job = gfx.jil.getItem(jobIndex);
    if (!job || job.length <= 0) return null;
    return job.length;
}

function getFrameCounts(gfx: RaceGfxData, jobIndex: number): number[] | null {
    const job = gfx.jil.getItem(jobIndex);
    if (!job || job.length <= 0) return null;

    const counts: number[] = [];
    for (let d = 0; d < job.length; d++) {
        const dilItem = gfx.dil.getItem(job.offset + d);
        counts.push(dilItem ? dilItem.length : 0);
    }
    return counts;
}

/**
 * Look up the JIL job index for a building by its XML ID.
 * Uses the game's actual BUILDING_JOB_INDICES via getBuildingTypesByXmlId.
 */
function getBuildingJobIndex(buildingXmlId: string): number | null {
    const buildingTypes = getBuildingTypesByXmlId(buildingXmlId);
    if (!buildingTypes || buildingTypes.length === 0) return null;
    return BUILDING_JOB_INDICES[buildingTypes[0]!] ?? null;
}

interface ValidationCounts {
    matches: number;
    empties: number;
    mismatches: number;
}

interface PatchEntry {
    slot: number;
    job: string;
    type: string;
}

function validatePatchDirections(
    gfx: RaceGfxData,
    jobIndex: number,
    patches: PatchEntry[],
    counts: ValidationCounts
): void {
    const compacted = gfx.dil.getItems(gfx.jil.getItem(jobIndex)!.offset, gfx.jil.getItem(jobIndex)!.length);
    let overlayIndex = 0;
    for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]!;
        if (!patch.job) {
            console.log(`    - SKIP: patch[${i}] (no job) — null DIL slot, skipped in compaction`);
            continue;
        }
        const compactedIdx = 2 + overlayIndex;
        if (compactedIdx >= compacted.length) {
            console.log(
                `    ✗ FAIL: patch[${i}] "${patch.job}" → compacted[${compactedIdx}] OUT OF RANGE (len=${compacted.length})`
            );
            counts.mismatches++;
        } else {
            const frames = compacted[compactedIdx]!.length;
            if (frames > 0) {
                console.log(`    ✓ OK:   patch[${i}] "${patch.job}" → compacted[${compactedIdx}] has ${frames} frames`);
                counts.matches++;
            } else {
                console.log(`    ~ EMPTY: patch[${i}] "${patch.job}" → compacted[${compactedIdx}] has 0 frames`);
                counts.empties++;
            }
        }
        overlayIndex++;
    }
}

function analyzeRaceBuilding(
    race: { name: string; id: string; gfxFile: number },
    allRaceData: ReturnType<typeof parseBuildingInfo>,
    raceGfx: Map<string, RaceGfxData>,
    buildingId: string,
    jobIndex: number,
    counts: ValidationCounts
): void {
    const raceData = allRaceData.get(race.id as 'RACE_ROMAN');
    const gfx = raceGfx.get(race.id);
    if (!raceData || !gfx) return;

    const buildingInfo = raceData.buildings.get(buildingId);
    if (!buildingInfo) return;

    const dirCount = getDirectionCount(gfx, jobIndex);
    const frameCounts = getFrameCounts(gfx, jobIndex);
    const patches = buildingInfo.patches;

    console.log(`\n  ${race.name} (file ${race.gfxFile}):`);
    console.log(
        `    GFX directions: ${dirCount ?? 'N/A'} ${frameCounts ? `(frames: [${frameCounts.join(', ')}])` : ''}`
    );
    console.log(`    XML patches (${patches.length}):`);

    for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]!;
        console.log(`      [${i}] slot=${patch.slot} job="${patch.job || '(empty)'}" type=${patch.type}`);
    }

    if (dirCount !== null && frameCounts && patches.length > 0) {
        validatePatchDirections(gfx, jobIndex, patches, counts);
    }
}

function matchesBuildingFilter(buildingId: string, filter: string[] | null): boolean {
    if (!filter) return true;
    const shortName = buildingId.replace('BUILDING_', '');
    return filter.some(f => shortName.includes(f));
}

async function loadAllRaceGfx(): Promise<Map<string, RaceGfxData>> {
    const raceGfx = new Map<string, RaceGfxData>();
    for (const race of RACES) {
        const gfx = await loadRaceGfx(race.gfxFile);
        if (gfx) {
            raceGfx.set(race.id, gfx);
        } else {
            console.warn(`WARNING: GFX files not found for ${race.name} (file ${race.gfxFile})`);
        }
    }
    return raceGfx;
}

async function main() {
    const { buildingFilter } = parseArgs();

    const xmlContent = readFileSync(`${GAME_DATA_DIR}/buildingInfo.xml`, 'utf-8');
    const allRaceData = parseBuildingInfo(xmlContent);
    const raceGfx = await loadAllRaceGfx();

    // Collect all building IDs that have patches across any race
    const buildingsWithPatches = new Set<string>();
    for (const [, raceData] of allRaceData) {
        for (const [buildingId, info] of raceData.buildings) {
            if (info.patches.length > 0) {
                buildingsWithPatches.add(buildingId);
            }
        }
    }

    const sortedBuildings = [...buildingsWithPatches].sort();
    const counts: ValidationCounts = { matches: 0, empties: 0, mismatches: 0 };

    for (const buildingId of sortedBuildings) {
        if (!matchesBuildingFilter(buildingId, buildingFilter)) continue;

        const jobIndex = getBuildingJobIndex(buildingId);
        if (jobIndex === null) continue;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`${buildingId} (job ${jobIndex})`);
        console.log('='.repeat(80));

        for (const race of RACES) {
            analyzeRaceBuilding(race, allRaceData, raceGfx, buildingId, jobIndex, counts);
        }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(
        `SUMMARY: ${counts.matches} OK, ${counts.empties} empty (0 frames), ${counts.mismatches} FAILED (out of range)`
    );
    console.log('='.repeat(80));
}

main().catch(console.error);
