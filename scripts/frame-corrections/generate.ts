/**
 * Detect displaced animation frames and generate frame-corrections.yaml.
 *
 * Scans GFX files via JIL→DIL→GIL pipeline, detects frames where pixel
 * content is shifted, and writes a YAML data file with per-frame offset
 * corrections.
 *
 * Usage:
 *   npx tsx scripts/frame-corrections/generate.ts                # All settler files, dev >= 8px
 *   npx tsx scripts/frame-corrections/generate.ts --min-dev 6    # Lower threshold
 *   npx tsx scripts/frame-corrections/generate.ts --files 20     # Roman only
 *   npx tsx scripts/frame-corrections/generate.ts --dry-run      # Print to stdout
 */
import '../lib/node-image-data-polyfill';
import { DilFileReader } from '../../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../../src/resources/gfx/palette-collection';
import { PilFileReader } from '../../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../../src/resources/gfx/exporter/file-system';
import { SETTLER_JOB_INDICES } from '../../src/game/renderer/sprite-metadata/jil-indices';
import { parse } from 'yaml';
import { type FrameInfo, computeFrameInfo, measureFrame, phaseCorrelationShift, median } from './frame-analysis';

const GFX_DIR = 'public/Siedler4/Gfx';
const OUTPUT_PATH = 'src/game/renderer/sprite-metadata/frame-corrections.yaml';
const SETTLER_FILES = ['20', '21', '22', '23', '24'];

/**
 * Job indices to exclude from correction detection.
 * These animations have intentional large movement (miner cart entering/exiting/tipping)
 * that the detector would incorrectly flag as displacement bugs.
 */
const EXCLUDED_JOBS: Set<number> = new Set([
    SETTLER_JOB_INDICES.miner.M_PUSHIN_COAL,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_IRONORE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_GOLDORE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_STONE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_SULFUR,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_COAL,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_IRONORE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_GOLDORE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_STONE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_SULFUR,
    SETTLER_JOB_INDICES.miner.M_TIP_COAL,
    SETTLER_JOB_INDICES.miner.M_TIP_IRONORE,
    SETTLER_JOB_INDICES.miner.M_TIP_GOLDORE,
    SETTLER_JOB_INDICES.miner.M_TIP_STONE,
    SETTLER_JOB_INDICES.miner.M_TIP_SULFUR,
]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
    files: string[] | null;
    minDev: number;
    dryRun: boolean;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    let files: string[] | null = null;
    let minDev = 8;
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--files' && argv[i + 1]) files = argv[++i]!.split(',');
        else if (argv[i] === '--min-dev' && argv[i + 1]) minDev = Number(argv[++i]);
        else if (argv[i] === '--dry-run') dryRun = true;
    }
    return { files, minDev, dryRun };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface Spike {
    file: string;
    job: number;
    direction: number;
    frame: number;
    dx: number;
    dy: number;
    deviation: number;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- two-pass detection with neighbor propagation
function detectSpikes(frames: FrameInfo[], file: string, job: number, dir: number): Spike[] {
    const spikes: Spike[] = [];
    if (frames.length < 3) return spikes;

    const f0 = frames[0]!;
    if (f0.opaquePixels < 50) return spikes;

    const medianHGap = median(frames.map(f => f.hGap));
    const medianCentroidY = median(frames.map(f => f.centroidY));

    // First pass: detect frames with strong phase correlation against f0
    const detected = new Map<number, Spike>();
    const weakDetections: number[] = []; // indices with evidence but weak phase correlation

    for (let i = 1; i < frames.length; i++) {
        const curr = frames[i]!;
        const result = measureFrame(f0, curr, medianHGap, medianCentroidY);
        if (!result) continue;

        const deviation = Math.round(Math.sqrt(result.dx * result.dx + result.dy * result.dy) * 10) / 10;
        if (deviation >= 3) {
            const spike = { file, job, direction: dir, frame: curr.index, dx: result.dx, dy: result.dy, deviation };
            detected.set(i, spike);
        } else {
            weakDetections.push(i);
        }
    }

    // Second pass: for frames with evidence but weak phase correlation against f0,
    // try phase correlation against a nearby detected frame. If the shift relative to
    // that neighbor is small, the frame has the same displacement — adopt the neighbor's dx.
    for (const i of weakDetections) {
        const curr = frames[i]!;
        let adoptedSpike: Spike | null = null;
        for (let radius = 1; radius < frames.length; radius++) {
            for (const neighbor of [i - radius, i + radius]) {
                const neighborSpike = detected.get(neighbor);
                if (!neighborSpike) continue;
                const neighborFrame = frames[neighbor]!;
                const relDx = phaseCorrelationShift(neighborFrame.colGray, curr.colGray);
                if (Math.abs(relDx) <= 3) {
                    const dy = Math.round(medianCentroidY - curr.centroidY);
                    const dx = neighborSpike.dx;
                    const deviation = Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
                    if (deviation >= 3) {
                        adoptedSpike = { file, job, direction: dir, frame: curr.index, dx, dy, deviation };
                    }
                    break;
                }
            }
            if (adoptedSpike) break;
        }
        if (adoptedSpike) detected.set(i, adoptedSpike);
    }

    spikes.push(...detected.values());
    return spikes;
}

// ---------------------------------------------------------------------------
// GFX loading
// ---------------------------------------------------------------------------

async function loadFileSet(baseName: string, nodeFs: NodeFileSystem) {
    const resolve = (ext: string) => `${GFX_DIR}/${baseName}.${ext}`;
    const hasPa6 = await nodeFs.exists(resolve('pa6'));
    const hasPi4 = await nodeFs.exists(resolve('pi4'));

    const [gfxData, gilData, jilData, dilData, paletteData, pilData] = await Promise.all([
        nodeFs.readFile(resolve('gfx')),
        nodeFs.readFile(resolve('gil')),
        nodeFs.readFile(resolve('jil')),
        nodeFs.readFile(resolve('dil')),
        nodeFs.readFile(hasPa6 ? resolve('pa6') : resolve('p46')),
        nodeFs.readFile(hasPi4 ? resolve('pi4') : resolve('pil')),
    ]);

    const gilReader = new GilFileReader(gilData);
    const jilReader = new JilFileReader(jilData);
    const dilReader = new DilFileReader(dilData);
    const pilReader = new PilFileReader(pilData);
    const paletteCollection = new PaletteCollection(paletteData, pilReader);
    const gfxReader = new GfxFileReader(gfxData, gilReader, jilReader, dilReader, paletteCollection);
    return { gfxReader, gilReader, jilReader, dilReader };
}

function readDirectionFrames(
    fileSet: { gfxReader: GfxFileReader; gilReader: GilFileReader; dilReader: DilFileReader },
    jobIndex: number,
    dilOffset: number
): FrameInfo[] {
    const dilItem = fileSet.dilReader.getItem(dilOffset);
    if (!dilItem || dilItem.length <= 0) return [];
    const frames: FrameInfo[] = [];
    for (let f = 0; f < dilItem.length; f++) {
        const gilIndex = dilItem.offset + f;
        if (gilIndex < 0 || gilIndex >= fileSet.gilReader.length) continue;
        const gfxOffset = fileSet.gilReader.getImageOffset(gilIndex);
        if (gfxOffset <= 0) continue;
        try {
            const image = fileSet.gfxReader.readImage(gfxOffset, jobIndex);
            if (!image || image.width === 0 || image.height === 0) continue;
            frames.push(computeFrameInfo(image, f));
        } catch {
            /* skip */
        }
    }
    return frames;
}

// ---------------------------------------------------------------------------
// Scan all files → collect spikes
// ---------------------------------------------------------------------------

async function scanSingleFile(baseName: string, nodeFs: NodeFileSystem, minDev: number): Promise<Spike[]> {
    const fileSet = await loadFileSet(baseName, nodeFs);
    const { jilReader } = fileSet;
    const spikes: Spike[] = [];
    console.error(`[${baseName}.jil] scanning ${jilReader.length} jobs...`);

    for (let jobIndex = 0; jobIndex < jilReader.length; jobIndex++) {
        if (EXCLUDED_JOBS.has(jobIndex)) continue;
        const jilItem = jilReader.getItem(jobIndex);
        if (!jilItem || jilItem.length <= 0) continue;

        for (let d = 0; d < jilItem.length; d++) {
            const frames = readDirectionFrames(fileSet, jobIndex, jilItem.offset + d);
            spikes.push(...detectSpikes(frames, baseName, jobIndex, d).filter(s => s.deviation >= minDev));
        }
    }

    return spikes;
}

async function scanFiles(filesToProcess: string[], minDev: number): Promise<Spike[]> {
    const nodeFs = new NodeFileSystem();
    const allSpikes: Spike[] = [];

    for (const baseName of filesToProcess) {
        try {
            allSpikes.push(...(await scanSingleFile(baseName, nodeFs, minDev)));
        } catch {
            continue;
        }
    }

    return allSpikes;
}

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

/** Nested YAML data: fileId → jobIndex → direction → frame → [dx, dy] or [dx, dy, true] */
type YamlShift = [number, number] | [number, number, true];
type CorrectionData = Record<number, Record<number, Record<number, Record<number, YamlShift>>>>;

interface DirGroup {
    direction: number;
    frames: { frame: number; dx: number; dy: number }[];
}
interface JobGroup {
    file: number;
    job: number;
    directions: DirGroup[];
}

function groupSpikes(spikes: Spike[]): JobGroup[] {
    const byFileJob = new Map<string, Spike[]>();
    for (const s of spikes) {
        const key = `${s.file}:${s.job}`;
        let list = byFileJob.get(key);
        if (!list) {
            list = [];
            byFileJob.set(key, list);
        }
        list.push(s);
    }

    const groups: JobGroup[] = [];
    for (const entries of byFileJob.values()) {
        const { file, job } = entries[0]!;
        const byDir = new Map<number, Spike[]>();
        for (const e of entries) {
            let list = byDir.get(e.direction);
            if (!list) {
                list = [];
                byDir.set(e.direction, list);
            }
            list.push(e);
        }
        const directions: DirGroup[] = [];
        for (const [dir, dirEntries] of [...byDir.entries()].sort((a, b) => a[0] - b[0])) {
            const frames = dirEntries
                .sort((a, b) => a.frame - b.frame)
                .map(e => ({ frame: e.frame, dx: e.dx, dy: e.dy }));
            directions.push({ direction: dir, frames });
        }
        groups.push({ file: Number(file), job, directions });
    }

    return groups.sort((a, b) => a.file - b.file || a.job - b.job);
}

function spikesToData(groups: JobGroup[]): CorrectionData {
    const data: CorrectionData = {};
    for (const g of groups) {
        if (!data[g.file]) {
            data[g.file] = {};
        }
        const jobMap: Record<number, Record<number, [number, number]>> = {};
        for (const d of g.directions) {
            const frameMap: Record<number, [number, number]> = {};
            for (const f of d.frames) {
                frameMap[f.frame] = [f.dx, f.dy];
            }
            jobMap[d.direction] = frameMap;
        }
        data[g.file]![g.job] = jobMap;
    }
    return data;
}

function ensureNested(obj: Record<number, Record<number, unknown>>, ...keys: number[]): Record<number, unknown> {
    let current: Record<number, unknown> = obj;
    for (const key of keys) {
        if (!current[key]) {
            current[key] = {};
        }
        current = current[key] as Record<number, unknown>;
    }
    return current;
}

/** Merge manual entries from existing YAML into freshly generated data. */
function mergeManualEntries(generated: CorrectionData, existing: CorrectionData): CorrectionData {
    const result = structuredClone(generated);
    for (const [fileId, jobs] of Object.entries(existing)) {
        for (const [job, dirs] of Object.entries(jobs)) {
            for (const [dir, frames] of Object.entries(dirs)) {
                for (const [frame, shift] of Object.entries(frames)) {
                    if (shift[2] === true) {
                        const target = ensureNested(result, Number(fileId), Number(job), Number(dir));
                        target[Number(frame)] = shift;
                    }
                }
            }
        }
    }
    return result;
}

function serializeYaml(data: CorrectionData): string {
    const lines: string[] = [
        '# JIL frame offset corrections — fixes mispositioned frames in original game art.',
        '#',
        '# Structure: fileId → jobIndex → direction → frame: [dx, dy] or [dx, dy, true] for manual',
        '# Directions: 0=SE, 1=E, 2=SW, 3=NW, 4=W, 5=NE',
        '#',
        '# Auto-generated by: npx tsx scripts/frame-corrections/generate.ts',
        '# Manual edits (via JIL viewer Save) are preserved on re-generation.',
    ];

    const sortedFiles = Object.keys(data)
        .map(Number)
        .sort((a, b) => a - b);
    for (const fileId of sortedFiles) {
        lines.push(`${fileId}:`);
        const jobs = data[fileId]!;
        const sortedJobs = Object.keys(jobs)
            .map(Number)
            .sort((a, b) => a - b);
        for (const job of sortedJobs) {
            lines.push(`  ${job}:`);
            const dirs = jobs[job]!;
            const sortedDirs = Object.keys(dirs)
                .map(Number)
                .sort((a, b) => a - b);
            for (const dir of sortedDirs) {
                lines.push(`    ${dir}:`);
                const frames = dirs[dir]!;
                const sortedFrames = Object.keys(frames)
                    .map(Number)
                    .sort((a, b) => a - b);
                for (const frame of sortedFrames) {
                    const shift = frames[frame]!;
                    const suffix = shift[2] === true ? ', true' : '';
                    lines.push(`      ${frame}: [${shift[0]}, ${shift[1]}${suffix}]`);
                }
            }
        }
    }

    return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs();
    const filesToProcess = args.files ?? [...SETTLER_FILES];

    console.error(`Scanning ${filesToProcess.length} file(s), min deviation ${args.minDev}px...`);
    const spikes = await scanFiles(filesToProcess, args.minDev);
    console.error(`Found ${spikes.length} displaced frames`);

    const generated = spikesToData(groupSpikes(spikes));

    // Load existing YAML to preserve manual edits — manual entries override auto-detected
    const fs = await import('fs/promises');
    let existing: CorrectionData = {};
    try {
        const raw = await fs.readFile(OUTPUT_PATH, 'utf-8');
        existing = parse(raw) ?? {};
    } catch {
        /* no existing file — start fresh */
    }

    const merged = mergeManualEntries(generated, existing);
    const finalYaml = serializeYaml(merged);

    if (args.dryRun) {
        console.log(finalYaml);
    } else {
        await fs.writeFile(OUTPUT_PATH, finalYaml);
        console.error(`Written ${OUTPUT_PATH}`);
    }
}

main().catch(console.error);
