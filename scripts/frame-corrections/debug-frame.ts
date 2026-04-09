/**
 * Debug a single job/direction — dump per-frame analysis with detection details.
 *
 * Shows: border pixels, hGap, centroid, phase correlation dx/dy, detection
 * triggers, and renders individual frame PNGs + a strip.
 *
 * Usage:
 *   npx tsx scripts/frame-corrections/debug-frame.ts <file> <job> <direction> [frame]
 *   npx tsx scripts/frame-corrections/debug-frame.ts 20 250 5        # all frames analysis
 *   npx tsx scripts/frame-corrections/debug-frame.ts 20 250 5 4      # baseline + frame 4 only
 */
import '../lib/node-image-data-polyfill';
import { DilFileReader } from '../../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../../src/resources/gfx/palette-collection';
import { PilFileReader } from '../../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../../src/resources/gfx/exporter/file-system';
import { mkdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { parse } from 'yaml';
import {
    type FrameInfo, computeFrameInfo, measureFrame, phaseCorrelationShift,
    writeBmp, median, MIN_BORDER_SPIKE, MIN_SPLIT_GAP_EXCESS,
} from './frame-analysis';

const GFX_DIR = 'public/Siedler4/Gfx';
const OUT_DIR = '/tmp/debug-frame';
const YAML_PATH = 'src/game/renderer/sprite-metadata/frame-corrections.yaml';

async function main() {
    const fileId = process.argv[2];
    const jobId = Number(process.argv[3]);
    const dirId = Number(process.argv[4]);
    const focusFrame = process.argv[5] !== undefined ? Number(process.argv[5]) : null;

    if (!fileId || isNaN(jobId) || isNaN(dirId)) {
        console.error('Usage: npx tsx scripts/frame-corrections/debug-frame.ts <file> <job> <direction> [frame]');
        process.exit(1);
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const nodeFs = new NodeFileSystem();
    const resolve = (ext: string) => `${GFX_DIR}/${fileId}.${ext}`;
    const hasPa6 = await nodeFs.exists(resolve('pa6'));
    const hasPi4 = await nodeFs.exists(resolve('pi4'));
    const [gfxData, gilData, jilData, dilData, paletteData, pilData] = await Promise.all([
        nodeFs.readFile(resolve('gfx')), nodeFs.readFile(resolve('gil')),
        nodeFs.readFile(resolve('jil')), nodeFs.readFile(resolve('dil')),
        nodeFs.readFile(hasPa6 ? resolve('pa6') : resolve('p46')),
        nodeFs.readFile(hasPi4 ? resolve('pi4') : resolve('pil')),
    ]);
    const gilReader = new GilFileReader(gilData);
    const jilReader = new JilFileReader(jilData);
    const dilReader = new DilFileReader(dilData);
    const pilReader = new PilFileReader(pilData);
    const palettes = new PaletteCollection(paletteData, pilReader);
    const gfxReader = new GfxFileReader(gfxData, gilReader, jilReader, dilReader, palettes);

    const jilItem = jilReader.getItem(jobId);
    if (!jilItem) { console.error(`Job ${jobId} not found`); return; }
    if (dirId >= jilItem.length) { console.error(`Direction ${dirId} out of range (0-${jilItem.length - 1})`); return; }

    const dilItem = dilReader.getItem(jilItem.offset + dirId)!;
    if (!dilItem) { console.error(`DIL item not found`); return; }

    // Load existing YAML corrections
    let yamlCorrections: Record<number, [number, number]> = {};
    try {
        const yamlData = parse(readFileSync(YAML_PATH, 'utf-8')) ?? {};
        const jobData = yamlData[Number(fileId)]?.[jobId]?.[dirId];
        if (jobData) yamlCorrections = jobData;
    } catch { /* no corrections */ }

    console.log(`\n=== File ${fileId}, Job ${jobId}, Direction ${dirId}: ${dilItem.length} frames ===\n`);

    // Analyze all frames (needed for medians), but only render baseline + focus frame
    const frames: FrameInfo[] = [];
    const renderPaths: string[] = [];
    for (let f = 0; f < dilItem.length; f++) {
        const gilIndex = dilItem.offset + f;
        if (gilIndex < 0 || gilIndex >= gilReader.length) continue;
        const gfxOffset = gilReader.getImageOffset(gilIndex);
        if (gfxOffset <= 0) continue;
        try {
            const image = gfxReader.readImage(gfxOffset, jobId);
            frames.push(computeFrameInfo(image, f));
            const shouldRender = focusFrame === null || f === 0 || f === focusFrame;
            if (shouldRender) {
                const bmpPath = `${OUT_DIR}/f${fileId}_j${jobId}_d${dirId}_f${f}.bmp`;
                writeBmp(bmpPath, image.getImageData().data, image.width, image.height);
                const pngPath = bmpPath.replace('.bmp', '.png');
                execSync(`magick "${bmpPath}" -scale 400% "${pngPath}"`);
                renderPaths.push(pngPath);
            }
        } catch (e) {
            console.log(`  f${f}: ERROR ${e}`);
        }
    }

    if (frames.length === 0) { console.error('No frames found'); return; }

    const f0 = frames[0]!;
    const medianHGap = median(frames.map(f => f.hGap));
    const medianCentroidY = median(frames.map(f => f.centroidY));

    // Print header
    console.log(
        `  f0 ref: ${f0.width}x${f0.height} opaque=${f0.opaquePixels}` +
        ` L=${f0.leftBorderPixels} R=${f0.rightBorderPixels} T=${f0.topBorderPixels} B=${f0.bottomBorderPixels}` +
        ` hGap=${f0.hGap}`,
    );
    console.log(`  medians: hGap=${medianHGap} centroidY=${medianCentroidY.toFixed(1)}`);
    console.log();

    // Print per-frame analysis using shared measureFrame
    const framesToPrint = focusFrame !== null ? frames.filter(f => f.index === 0 || f.index === focusFrame) : frames;

    for (const curr of framesToPrint) {
        const result = measureFrame(f0, curr, medianHGap, medianCentroidY);

        // Always compute raw values for display
        const rawDx = phaseCorrelationShift(f0.colGray, curr.colGray);
        const rawDy = phaseCorrelationShift(f0.rowGray, curr.rowGray);
        const centroidDy = Math.round(medianCentroidY - curr.centroidY);

        // Detection triggers
        const triggers: string[] = [];
        if (result) {
            if (result.hasBorderAnomaly) {
                const leftEx = curr.leftBorderPixels - f0.leftBorderPixels;
                const rightEx = curr.rightBorderPixels - f0.rightBorderPixels;
                triggers.push(`border(L+${leftEx},R+${rightEx})`);
            }
            if (result.hasHSplit) triggers.push(`hSplit(gap=${curr.hGap},med=${medianHGap})`);
            if (result.hasGapCollapse) triggers.push(`gapCollapse(gap=${curr.hGap},med=${medianHGap})`);
        }

        // YAML correction
        const yamlEntry = yamlCorrections[curr.index];
        const yamlStr = yamlEntry ? ` YAML=[${yamlEntry[0]},${yamlEntry[1]}]` : '';

        // Status
        let status = '';
        if (!result) {
            status = '  (no detection)';
        } else {
            const deviation = Math.round(Math.sqrt(result.dx * result.dx + result.dy * result.dy) * 10) / 10;
            if (deviation < 3) {
                status = '  (below threshold)';
            } else {
                const signFlipped = result.signFlipped ? ' SIGN-FLIPPED' : '';
                status = `  → dx=${result.dx} dy=${result.dy}(${result.dySource}) dev=${deviation}${signFlipped}`;
            }
        }

        console.log(
            `  f${curr.index}: ${curr.width}x${curr.height} opaque=${curr.opaquePixels} ` +
            `L=${curr.leftBorderPixels} R=${curr.rightBorderPixels} T=${curr.topBorderPixels} B=${curr.bottomBorderPixels} ` +
            `hGap=${curr.hGap} cY=${curr.centroidY.toFixed(1)} ` +
            `rawDx=${rawDx} rawDy=${rawDy} centDy=${centroidDy}` +
            `${triggers.length > 0 ? '  ' + triggers.join('+') : ''}` +
            status + yamlStr,
        );
    }

    // Generate comparison strip (baseline + focus frame, or all)
    if (renderPaths.length > 1) {
        const label = focusFrame !== null ? `compare_f0_f${focusFrame}` : 'strip';
        const stripPath = `${OUT_DIR}/${label}_f${fileId}_j${jobId}_d${dirId}.png`;
        execSync(`magick ${renderPaths.map(p => `"${p}"`).join(' ')} +append "${stripPath}"`);
        console.log(`\n  Compare: ${stripPath}`);
    } else if (renderPaths.length === 1) {
        console.log(`\n  Frame: ${renderPaths[0]}`);
    }
}

main().catch(console.error);
