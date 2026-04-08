/**
 * Detect displaced animation frames and generate frame-corrections.yaml.
 *
 * Scans GFX files via JIL→DIL→GIL pipeline, detects frames where pixel
 * content is shifted (border-pixel anomaly), and writes a YAML data file
 * with per-frame offset corrections.
 *
 * Usage:
 *   npx tsx scripts/generate-frame-corrections.ts                # All settler files, dev >= 8px
 *   npx tsx scripts/generate-frame-corrections.ts --min-dev 6    # Lower threshold
 *   npx tsx scripts/generate-frame-corrections.ts --files 20     # Roman only
 *   npx tsx scripts/generate-frame-corrections.ts --dry-run      # Print to stdout
 */
import './lib/node-image-data-polyfill';
import { DilFileReader } from '../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../src/resources/gfx/palette-collection';
import { PilFileReader } from '../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../src/resources/gfx/exporter/file-system';
import type { GfxImage } from '../src/resources/gfx/gfx-image';
import { SETTLER_JOB_INDICES } from '../src/game/renderer/sprite-metadata/jil-indices';

const GFX_DIR = 'public/Siedler4/Gfx';
const OUTPUT_PATH = 'src/game/renderer/sprite-metadata/frame-corrections.yaml';
const SETTLER_FILES = ['20', '21', '22', '23', '24'];
const BORDER_WIDTH = 3;

/**
 * Job indices to exclude from correction detection.
 * These animations have intentional large movement (miner cart entering/exiting/tipping)
 * that the border-pixel detector would incorrectly flag as displacement bugs.
 */
const EXCLUDED_JOBS: Set<number> = new Set([
    // Miner push-in animations (cart entering mine)
    SETTLER_JOB_INDICES.miner.M_PUSHIN_COAL,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_IRONORE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_GOLDORE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_STONE,
    SETTLER_JOB_INDICES.miner.M_PUSHIN_SULFUR,
    // Miner push-out animations (cart exiting mine)
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_COAL,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_IRONORE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_GOLDORE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_STONE,
    SETTLER_JOB_INDICES.miner.M_PUSHOUT_SULFUR,
    // Miner tip animations (dumping cart)
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
// Frame analysis
// ---------------------------------------------------------------------------

interface FrameInfo {
    index: number;
    width: number;
    opaquePixels: number;
    /** Column pixel counts — columnDensity[x] = number of opaque pixels in column x */
    columnDensity: number[];
    /** First column with >= EDGE_MIN_PIXELS opaque pixels (left edge of sprite mass) */
    leftEdge: number;
    /** Last column with >= EDGE_MIN_PIXELS opaque pixels (right edge of sprite mass) */
    rightEdge: number;
    leftBorderPixels: number;
    rightBorderPixels: number;
    centroidY: number;
}

/** Minimum opaque pixels in a column to count as a real edge (filters stray lines) */
const EDGE_MIN_PIXELS = 3;

interface Spike {
    file: string;
    job: number;
    direction: number;
    frame: number;
    dx: number;
    dy: number;
    deviation: number;
}

/** Find leftmost/rightmost columns with enough opaque pixels to count as a real edge. */
function findSpriteEdges(columnDensity: number[], width: number): { leftEdge: number; rightEdge: number } {
    let leftEdge = 0;
    for (let x = 0; x < width; x++) {
        if (columnDensity[x]! >= EDGE_MIN_PIXELS) {
            leftEdge = x;
            break;
        }
    }
    let rightEdge = width - 1;
    for (let x = width - 1; x >= 0; x--) {
        if (columnDensity[x]! >= EDGE_MIN_PIXELS) {
            rightEdge = x;
            break;
        }
    }
    return { leftEdge, rightEdge };
}

function computeFrameInfo(image: GfxImage, frameIndex: number): FrameInfo {
    const imgData = image.getImageData();
    const pixels = new Uint32Array(imgData.data.buffer);
    const { width, height } = image;
    const columnDensity = new Array<number>(width).fill(0);
    let sumY = 0,
        count = 0,
        leftBorder = 0,
        rightBorder = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (pixels[y * width + x]! >>> 24 > 0) {
                columnDensity[x]!++;
                sumY += y;
                count++;
                if (x < BORDER_WIDTH) leftBorder++;
                if (x >= width - BORDER_WIDTH) rightBorder++;
            }
        }
    }

    const { leftEdge, rightEdge } = findSpriteEdges(columnDensity, width);

    return {
        index: frameIndex,
        width,
        opaquePixels: count,
        columnDensity,
        leftEdge,
        rightEdge,
        leftBorderPixels: leftBorder,
        rightBorderPixels: rightBorder,
        centroidY: count > 0 ? sumY / count : 0,
    };
}

/**
 * Compute the horizontal displacement between baseline and current frame.
 * Uses the edge shift from the side where the border spike appeared, since
 * ghost pixels keep the opposite edge in place.
 */
function computeDisplacementDx(
    f0: FrameInfo,
    curr: FrameInfo,
    leftExcess: number,
    rightExcess: number,
    threshold: number
): number {
    const leftShift = f0.leftEdge - curr.leftEdge; // positive = curr shifted left
    const rightShift = f0.rightEdge - curr.rightEdge; // positive = curr shifted left
    if (leftExcess >= threshold && rightExcess >= threshold) {
        return Math.abs(leftShift) >= Math.abs(rightShift) ? leftShift : rightShift;
    }
    return leftExcess >= threshold ? leftShift : rightShift;
}

function detectSpikes(frames: FrameInfo[], file: string, job: number, dir: number): Spike[] {
    const spikes: Spike[] = [];
    if (frames.length < 3) return spikes;

    // Baseline = frame 0 (assumed correct).
    const f0 = frames[0]!;
    if (f0.opaquePixels < 50) return spikes;

    const MIN_BORDER_SPIKE = 8;

    for (let i = 1; i < frames.length; i++) {
        const curr = frames[i]!;
        if (curr.opaquePixels < 50) continue;

        const leftExcess = curr.leftBorderPixels - f0.leftBorderPixels;
        const rightExcess = curr.rightBorderPixels - f0.rightBorderPixels;
        if (leftExcess < MIN_BORDER_SPIKE && rightExcess < MIN_BORDER_SPIKE) continue;

        const dx = computeDisplacementDx(f0, curr, leftExcess, rightExcess, MIN_BORDER_SPIKE);
        const dy = Math.round(f0.centroidY - curr.centroidY);
        const deviation = Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
        if (deviation < 3) continue;

        spikes.push({ file, job, direction: dir, frame: curr.index, dx, dy, deviation });
    }

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

import { parse } from 'yaml';

/** Nested YAML data: fileId → jobIndex → direction → frame → [dx, dy] */
type CorrectionData = Record<number, Record<number, Record<number, Record<number, [number, number]>>>>;

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

function ensureNested(obj: Record<number, any>, ...keys: number[]): Record<number, any> {
    let current = obj;
    for (const key of keys) {
        if (!current[key]) {
            current[key] = {};
        }
        current = current[key];
    }
    return current;
}

/** Deep merge: entries from `override` take priority over `base`. */
function mergeData(base: CorrectionData, override: CorrectionData): CorrectionData {
    const result = structuredClone(base);
    for (const [fileId, jobs] of Object.entries(override)) {
        for (const [job, dirs] of Object.entries(jobs)) {
            for (const [dir, frames] of Object.entries(dirs)) {
                const target = ensureNested(result, Number(fileId), Number(job), Number(dir));
                for (const [frame, shift] of Object.entries(frames)) {
                    target[Number(frame)] = shift;
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
        '# Structure: fileId → jobIndex → direction → frame: [dx, dy]',
        '# Directions: 0=SE, 1=E, 2=SW, 3=NW, 4=W, 5=NE',
        '#',
        '# Auto-generated by: npx tsx scripts/generate-frame-corrections.ts',
        '# Manual edits (via JIL viewer Save) are preserved on re-generation.',
    ];

    const sortedFiles = Object.keys(data).map(Number).sort((a, b) => a - b);
    for (const fileId of sortedFiles) {
        lines.push(`${fileId}:`);
        const jobs = data[fileId]!;
        const sortedJobs = Object.keys(jobs).map(Number).sort((a, b) => a - b);
        for (const job of sortedJobs) {
            lines.push(`  ${job}:`);
            const dirs = jobs[job]!;
            const sortedDirs = Object.keys(dirs).map(Number).sort((a, b) => a - b);
            for (const dir of sortedDirs) {
                lines.push(`    ${dir}:`);
                const frames = dirs[dir]!;
                const sortedFrames = Object.keys(frames).map(Number).sort((a, b) => a - b);
                for (const frame of sortedFrames) {
                    const [dx, dy] = frames[frame]!;
                    lines.push(`      ${frame}: [${dx}, ${dy}]`);
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

    const merged = mergeData(generated, existing);
    const finalYaml = serializeYaml(merged);

    if (args.dryRun) {
        console.log(finalYaml);
    } else {
        await fs.writeFile(OUTPUT_PATH, finalYaml);
        console.error(`Written ${OUTPUT_PATH}`);
    }
}

main().catch(console.error);
