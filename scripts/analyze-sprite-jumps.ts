/**
 * Analyze ALL sprites via JIL files for sudden pixel jumps between
 * consecutive animation frames. Processes each direction separately.
 *
 * Detects:
 * - Offset jumps: sudden changes in GfxImage left/top positioning
 * - Size jumps: sudden width/height changes between frames
 * - Centroid jumps: visual center-of-mass shifts in non-transparent pixels
 *
 * Usage:
 *   npx tsx scripts/analyze-sprite-jumps.ts                # All JIL files
 *   npx tsx scripts/analyze-sprite-jumps.ts --files 20,5   # Specific files
 *   npx tsx scripts/analyze-sprite-jumps.ts --threshold 8  # Custom pixel threshold (default: 5)
 *   npx tsx scripts/analyze-sprite-jumps.ts --jobs 1,54    # Filter specific jobs
 *   npx tsx scripts/analyze-sprite-jumps.ts --min-delta 15 # Only show jumps >= 15px
 *   npx tsx scripts/analyze-sprite-jumps.ts --verbose      # Show per-frame details
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
import { buildJobNameIndex, buildFileLabel } from './sprite-jump-helpers/job-name-index';

const GFX_DIR = 'public/Siedler4/Gfx';

/** Direction names for unit files (6-direction settler sprites) */
const DIRECTION_NAMES = ['SE', 'E', 'SW', 'NW', 'W', 'NE'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FrameInfo {
    index: number;
    width: number;
    height: number;
    left: number;
    top: number;
    centroidX: number;
    centroidY: number;
    opaquePixels: number;
}

interface Jump {
    file: string;
    job: number;
    direction: number;
    fromFrame: number;
    toFrame: number;
    kind: string;
    delta: number;
    detail: string;
}

interface Args {
    files: string[] | null;
    threshold: number;
    minDelta: number;
    jobFilter: number[] | null;
    verbose: boolean;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    let files: string[] | null = null;
    let threshold = 5;
    let minDelta = 0;
    let jobFilter: number[] | null = null;
    let verbose = false;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--files' && argv[i + 1]) {
            files = argv[++i]!.split(',');
        } else if (argv[i] === '--threshold' && argv[i + 1]) {
            threshold = Number(argv[++i]);
        } else if (argv[i] === '--min-delta' && argv[i + 1]) {
            minDelta = Number(argv[++i]);
        } else if (argv[i] === '--jobs' && argv[i + 1]) {
            jobFilter = argv[++i]!.split(',').map(Number);
        } else if (argv[i] === '--verbose') {
            verbose = true;
        }
    }

    return { files, threshold, minDelta, jobFilter, verbose };
}

// ---------------------------------------------------------------------------
// Image analysis
// ---------------------------------------------------------------------------

function computeFrameInfo(image: GfxImage, frameIndex: number): FrameInfo {
    const imgData = image.getImageData();
    const pixels = new Uint32Array(imgData.data.buffer);
    const { width, height } = image;

    let sumX = 0;
    let sumY = 0;
    let opaqueCount = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = pixels[y * width + x]!;
            const alpha = (pixel >>> 24) & 0xff;
            if (alpha > 0) {
                sumX += x;
                sumY += y;
                opaqueCount++;
            }
        }
    }

    const centroidX = opaqueCount > 0 ? sumX / opaqueCount : 0;
    const centroidY = opaqueCount > 0 ? sumY / opaqueCount : 0;

    return {
        index: frameIndex,
        width, height,
        left: image.left, top: image.top,
        centroidX, centroidY,
        opaquePixels: opaqueCount,
    };
}

function detectJumps(
    frames: FrameInfo[],
    file: string,
    job: number,
    direction: number,
    threshold: number
): Jump[] {
    const jumps: Jump[] = [];
    if (frames.length < 2) return jumps;

    for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1]!;
        const curr = frames[i]!;

        if (prev.opaquePixels < 4 || curr.opaquePixels < 4) continue;

        // Offset jump (left/top from image header)
        const dLeft = Math.abs(curr.left - prev.left);
        const dTop = Math.abs(curr.top - prev.top);
        if (dLeft > threshold || dTop > threshold) {
            const delta = Math.max(dLeft, dTop);
            jumps.push({
                file, job, direction,
                fromFrame: prev.index, toFrame: curr.index,
                kind: 'offset', delta,
                detail: `left: ${prev.left}->${curr.left} (d${dLeft}), top: ${prev.top}->${curr.top} (d${dTop})`,
            });
        }

        // Size jump
        const dW = Math.abs(curr.width - prev.width);
        const dH = Math.abs(curr.height - prev.height);
        if (dW > threshold || dH > threshold) {
            const delta = Math.max(dW, dH);
            jumps.push({
                file, job, direction,
                fromFrame: prev.index, toFrame: curr.index,
                kind: 'size', delta,
                detail: `${prev.width}x${prev.height} -> ${curr.width}x${curr.height} (dw${dW}, dh${dH})`,
            });
        }

        // Centroid jump in world-space (image centroid + offset)
        const prevWX = prev.centroidX + prev.left;
        const prevWY = prev.centroidY + prev.top;
        const currWX = curr.centroidX + curr.left;
        const currWY = curr.centroidY + curr.top;
        const dCX = currWX - prevWX;
        const dCY = currWY - prevWY;
        const centroidDist = Math.sqrt(dCX * dCX + dCY * dCY);

        if (centroidDist > threshold) {
            jumps.push({
                file, job, direction,
                fromFrame: prev.index, toFrame: curr.index,
                kind: 'centroid',
                delta: Math.round(centroidDist * 10) / 10,
                detail: `world centroid (${prevWX.toFixed(1)},${prevWY.toFixed(1)}) -> (${currWX.toFixed(1)},${currWY.toFixed(1)})`,
            });
        }
    }

    return jumps;
}

// ---------------------------------------------------------------------------
// File set loading
// ---------------------------------------------------------------------------

interface LoadedFileSet {
    gfxReader: GfxFileReader;
    gilReader: GilFileReader;
    jilReader: JilFileReader;
    dilReader: DilFileReader;
}

async function loadFileSet(baseName: string, nodeFs: NodeFileSystem): Promise<LoadedFileSet> {
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

// ---------------------------------------------------------------------------
// Per-direction analysis
// ---------------------------------------------------------------------------

function analyzeDirection(
    fileSet: LoadedFileSet,
    jobIndex: number,
    dilOffset: number
): FrameInfo[] {
    const { gilReader, gfxReader, dilReader } = fileSet;
    const dilItem = dilReader.getItem(dilOffset);
    if (!dilItem || dilItem.length <= 0) return [];

    const frames: FrameInfo[] = [];

    for (let f = 0; f < dilItem.length; f++) {
        const gilIndex = dilItem.offset + f;
        if (gilIndex < 0 || gilIndex >= gilReader.length) continue;

        const gfxOffset = gilReader.getImageOffset(gilIndex);
        if (gfxOffset <= 0) continue;

        try {
            const image = gfxReader.readImage(gfxOffset, jobIndex);
            if (!image || image.width === 0 || image.height === 0) continue;
            frames.push(computeFrameInfo(image, f));
        } catch {
            // Skip unreadable frames
        }
    }

    return frames;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatDirectionName(dirIndex: number, numDirections: number): string {
    if (numDirections === 6 && dirIndex < DIRECTION_NAMES.length) {
        return `${DIRECTION_NAMES[dirIndex]} (d${dirIndex})`;
    }
    return `d${dirIndex}`;
}

function formatGroupKey(
    file: string,
    job: number,
    direction: number,
    numDirections: number,
    jobNameIndex: Map<string, string>
): string {
    const jobName = jobNameIndex.get(`${file}:${job}`);
    const jobLabel = jobName ? `${jobName} (job ${job})` : `job ${job}`;
    const dirLabel = formatDirectionName(direction, numDirections);
    const fileLabel = buildFileLabel(file);
    return `${fileLabel} / ${jobLabel} / ${dirLabel}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs();
    const nodeFs = new NodeFileSystem();

    // Build reverse index: "fileNum:jobIndex" -> human-readable name
    const jobNameIndex = buildJobNameIndex();

    // Discover JIL files
    const allJilFiles = await nodeFs.listFiles(GFX_DIR, /\.jil$/i);
    const baseNames = allJilFiles
        .map(f => nodeFs.basenameWithoutExt(f))
        .sort((a, b) => Number(a) - Number(b));

    const filesToProcess = args.files
        ? baseNames.filter(b => args.files!.includes(b))
        : baseNames;

    console.log(`Analyzing ${filesToProcess.length} JIL file(s) with threshold=${args.threshold}px`);
    if (args.minDelta > 0) console.log(`Filtering results to min delta >= ${args.minDelta}px`);
    console.log('');

    const allJumps: Jump[] = [];
    // Track direction count per file/job for display
    const directionCounts = new Map<string, number>();
    let totalJobs = 0;
    let totalDirections = 0;
    let totalFrames = 0;

    for (const baseName of filesToProcess) {
        let fileSet: LoadedFileSet;
        try {
            fileSet = await loadFileSet(baseName, nodeFs);
        } catch (e) {
            console.log(`  Skipping ${baseName}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }

        const { jilReader } = fileSet;
        const jobs = args.jobFilter
            ? args.jobFilter.filter(j => j < jilReader.length)
            : Array.from({ length: jilReader.length }, (_, i) => i);

        console.log(`[${buildFileLabel(baseName)}] ${jilReader.length} jobs, scanning ${jobs.length}...`);

        for (const jobIndex of jobs) {
            const jilItem = jilReader.getItem(jobIndex);
            if (!jilItem || jilItem.length <= 0) continue;

            totalJobs++;
            const jobKey = `${baseName}:${jobIndex}`;
            directionCounts.set(jobKey, jilItem.length);

            for (let d = 0; d < jilItem.length; d++) {
                const frames = analyzeDirection(fileSet, jobIndex, jilItem.offset + d);
                if (frames.length < 2) continue;

                totalDirections++;
                totalFrames += frames.length;

                if (args.verbose) {
                    const jobName = jobNameIndex.get(jobKey);
                    const label = jobName ? `${jobName}` : `job ${jobIndex}`;
                    for (const fr of frames) {
                        console.log(
                            `    ${label} ${formatDirectionName(d, jilItem.length)} f${fr.index}: ` +
                            `${fr.width}x${fr.height} offset=(${fr.left},${fr.top}) ` +
                            `centroid=(${fr.centroidX.toFixed(1)},${fr.centroidY.toFixed(1)}) ` +
                            `opaque=${fr.opaquePixels}`
                        );
                    }
                }

                const jumps = detectJumps(frames, baseName, jobIndex, d, args.threshold);
                allJumps.push(...jumps);
            }
        }
    }

    // Apply min-delta filter
    const filtered = args.minDelta > 0
        ? allJumps.filter(j => j.delta >= args.minDelta)
        : allJumps;

    // ---------------------------------------------------------------------------
    // Report
    // ---------------------------------------------------------------------------
    console.log('');
    console.log('='.repeat(80));
    console.log(`ANALYSIS COMPLETE: ${totalJobs} jobs, ${totalDirections} directions, ${totalFrames} frames`);
    console.log(`Found ${allJumps.length} jump(s) exceeding ${args.threshold}px threshold`);
    if (args.minDelta > 0) {
        console.log(`Showing ${filtered.length} jump(s) with delta >= ${args.minDelta}px`);
    }
    console.log('='.repeat(80));

    if (filtered.length === 0) {
        console.log('No jumps detected.');
        return;
    }

    // Group by file -> job -> direction
    const grouped = new Map<string, Jump[]>();
    for (const jump of filtered) {
        const numDirs = directionCounts.get(`${jump.file}:${jump.job}`) ?? 1; // eslint-disable-line no-restricted-syntax -- fallback for missing
        const key = formatGroupKey(jump.file, jump.job, jump.direction, numDirs, jobNameIndex);
        let list = grouped.get(key);
        if (!list) {
            list = [];
            grouped.set(key, list);
        }
        list.push(jump);
    }

    // Sort by severity (largest delta first)
    const sortedKeys = [...grouped.keys()].sort((a, b) => {
        const maxA = Math.max(...grouped.get(a)!.map(j => j.delta));
        const maxB = Math.max(...grouped.get(b)!.map(j => j.delta));
        return maxB - maxA;
    });

    for (const key of sortedKeys) {
        const jumps = grouped.get(key)!;
        console.log('');
        console.log(`--- ${key} ---`);
        for (const j of jumps) {
            console.log(`  f${j.fromFrame}->f${j.toFrame}  [${j.kind}]  d${j.delta}px  ${j.detail}`);
        }
    }

    // Summary table by kind
    console.log('');
    console.log('Summary by kind:');
    const byKind = new Map<string, number>();
    for (const j of filtered) {
        byKind.set(j.kind, (byKind.get(j.kind) ?? 0) + 1); // eslint-disable-line no-restricted-syntax -- aggregation default
    }
    for (const [kind, count] of byKind) {
        console.log(`  ${kind}: ${count}`);
    }
}

main().catch(console.error);
