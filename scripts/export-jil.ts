/**
 * Export images from a GFX file set organized by JIL job index.
 *
 * Traverses the JIL → DIL → GIL → GFX chain and writes PNGs into
 * per-job directories with direction/frame naming.
 *
 * Usage:
 *   npx tsx scripts/export-jil.ts <baseName>
 *   npx tsx scripts/export-jil.ts 20              # Roman settlers
 *   npx tsx scripts/export-jil.ts 5               # Map objects
 *   npx tsx scripts/export-jil.ts 20 --jobs 1,5,19  # Only specific jobs
 *   npx tsx scripts/export-jil.ts 20 --output /tmp/jil-export
 */
import { DilFileReader } from '../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../src/resources/gfx/palette-collection';
import { PilFileReader } from '../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../src/resources/gfx/exporter/file-system';
import { GfxImageExporter } from '../src/resources/gfx/exporter/gfx-image-exporter';

// Polyfill ImageData for Node.js (used by GfxImage.getImageData)
if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as Record<string, unknown>)['ImageData'] = class ImageData {
        width: number;
        height: number;
        data: Uint8ClampedArray;
        constructor(sw: number | Uint8ClampedArray, sh?: number) {
            if (typeof sw === 'number') {
                this.width = sw;
                this.height = sh!;
                this.data = new Uint8ClampedArray(sw * sh! * 4);
            } else {
                this.data = sw;
                this.width = sh!;
                this.height = sw.length / (4 * sh!);
            }
        }
    };
}

const GFX_DIR = 'public/Siedler4/Gfx';
const DEFAULT_OUTPUT = 'output/jil-export';

function parseArgs(): { baseName: string; outputDir: string; jobFilter: number[] | null } {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx tsx scripts/export-jil.ts <baseName> [--jobs 1,5,19] [--output /tmp/jil-export]');
        process.exit(1);
    }

    const baseName = args[0]!;
    let outputDir = DEFAULT_OUTPUT;
    let jobFilter: number[] | null = null;

    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--output' && args[i + 1]) {
            outputDir = args[++i]!;
        } else if (args[i] === '--jobs' && args[i + 1]) {
            jobFilter = args[++i]!.split(',').map(Number);
        }
    }

    return { baseName, outputDir, jobFilter };
}

function resolveCompanionPath(baseName: string, ext: string): string {
    return `${GFX_DIR}/${baseName}.${ext}`;
}

interface ExportContext {
    gilReader: GilFileReader;
    gfxReader: GfxFileReader;
    exporter: GfxImageExporter;
    nodeFs: NodeFileSystem;
    counts: { exported: number; failed: number; skipped: number };
}

async function exportDirection(
    ctx: ExportContext,
    dilItem: { offset: number; length: number },
    jobIndex: number,
    d: number,
    jobDir: string
): Promise<number> {
    let exported = 0;
    for (let f = 0; f < dilItem.length; f++) {
        const gilIndex = dilItem.offset + f;
        if (gilIndex < 0 || gilIndex >= ctx.gilReader.length) {
            ctx.counts.failed++;
            continue;
        }
        const gfxOffset = ctx.gilReader.getImageOffset(gilIndex);
        if (gfxOffset <= 0) {
            ctx.counts.skipped++;
            continue;
        }
        try {
            const image = ctx.gfxReader.readImage(gfxOffset, jobIndex);
            if (!image || image.width === 0 || image.height === 0) {
                ctx.counts.skipped++;
                continue;
            }
            const filename = `d${d}_f${String(f).padStart(3, '0')}_${image.width}x${image.height}.png`;
            await ctx.exporter.exportImage(image, ctx.nodeFs.join(jobDir, filename));
            exported++;
            ctx.counts.exported++;
        } catch {
            ctx.counts.failed++;
        }
    }
    return exported;
}

async function exportJob(
    jobIndex: number,
    jilReader: JilFileReader,
    dilReader: DilFileReader,
    ctx: ExportContext,
    outputDir: string,
    baseName: string,
    padJob: number
): Promise<number> {
    const jilItem = jilReader.getItem(jobIndex);
    if (!jilItem || jilItem.length <= 0) return 0;

    const jobDir = ctx.nodeFs.join(outputDir, baseName, `job_${String(jobIndex).padStart(padJob, '0')}`);
    await ctx.nodeFs.mkdir(jobDir);
    let jobExported = 0;

    for (let d = 0; d < jilItem.length; d++) {
        const dilItem = dilReader.getItem(jilItem.offset + d);
        if (!dilItem || dilItem.length <= 0) continue;
        jobExported += await exportDirection(ctx, dilItem, jobIndex, d, jobDir);
    }
    return jobExported;
}

async function main() {
    const { baseName, outputDir, jobFilter } = parseArgs();
    const nodeFs = new NodeFileSystem();

    // Resolve file paths, trying both palette/pil extensions
    const gfxPath = resolveCompanionPath(baseName, 'gfx');
    const gilPath = resolveCompanionPath(baseName, 'gil');
    const jilPath = resolveCompanionPath(baseName, 'jil');
    const dilPath = resolveCompanionPath(baseName, 'dil');

    const p46Path = resolveCompanionPath(baseName, 'p46');
    const pa6Path = resolveCompanionPath(baseName, 'pa6');
    const pi4Path = resolveCompanionPath(baseName, 'pi4');
    const pilPath = resolveCompanionPath(baseName, 'pil');

    const hasPa6 = await nodeFs.exists(pa6Path);
    const hasPi4 = await nodeFs.exists(pi4Path);
    const palettePath = hasPa6 ? pa6Path : p46Path;
    const palIdxPath = hasPi4 ? pi4Path : pilPath;

    // Load all required files
    console.log(`Loading ${baseName}.gfx file set...`);
    const [gfxData, gilData, jilData, dilData, paletteData, pilData] = await Promise.all([
        nodeFs.readFile(gfxPath),
        nodeFs.readFile(gilPath),
        nodeFs.readFile(jilPath),
        nodeFs.readFile(dilPath),
        nodeFs.readFile(palettePath),
        nodeFs.readFile(palIdxPath),
    ]);

    const gilReader = new GilFileReader(gilData);
    const jilReader = new JilFileReader(jilData);
    const dilReader = new DilFileReader(dilData);
    const pilReader = new PilFileReader(pilData);
    const paletteCollection = new PaletteCollection(paletteData, pilReader);
    const gfxReader = new GfxFileReader(gfxData, gilReader, jilReader, dilReader, paletteCollection);

    // Build exporter for PNG encoding
    const exporter = new GfxImageExporter(nodeFs, nodeFs);

    const totalJobs = jilReader.length;
    const jobs = jobFilter ?? Array.from({ length: totalJobs }, (_, i) => i);
    const padJob = String(totalJobs).length;

    console.log(`JIL has ${totalJobs} entries, DIL has ${dilReader.length}, GIL has ${gilReader.length}`);
    console.log(`Exporting ${jobs.length} jobs to ${outputDir}/${baseName}/`);

    const ctx: ExportContext = {
        gilReader,
        gfxReader,
        exporter,
        nodeFs,
        counts: { exported: 0, failed: 0, skipped: 0 },
    };

    for (const jobIndex of jobs) {
        const jobExported = await exportJob(jobIndex, jilReader, dilReader, ctx, outputDir, baseName, padJob);
        if (jobExported > 0) {
            const dirCount = jilReader.getItem(jobIndex)!.length;
            console.log(`  job ${jobIndex}: ${jobExported} frames (${dirCount} directions)`);
        }
    }

    console.log(
        `\nDone: ${ctx.counts.exported} exported, ${ctx.counts.failed} failed, ${ctx.counts.skipped} skipped (empty)`
    );
}

main().catch(console.error);
