/**
 * Export a single representative frame (d0_f000) per JIL job.
 * Usage: npx tsx scripts/export-jil-single.ts <baseName> --jobs 2,3,4 [--output dir]
 */
import { DilFileReader } from '../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../src/resources/gfx/palette-collection';
import { PilFileReader } from '../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../src/resources/gfx/exporter/file-system';
import { GfxImageExporter } from '../src/resources/gfx/exporter/gfx-image-exporter';

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

function parseArgs(args: string[]): { baseName: string; outputDir: string; jobFilter: number[]; direction: number } {
    const baseName = args[0]!;
    let outputDir = 'output/carrier-sprites';
    let jobFilter: number[] = [];
    let direction = 0;
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--output' && args[i + 1]) outputDir = args[++i]!;
        else if (args[i] === '--jobs' && args[i + 1]) jobFilter = args[++i]!.split(',').map(Number);
        else if (args[i] === '--direction' && args[i + 1]) direction = Number(args[++i]);
    }
    return { baseName, outputDir, jobFilter, direction };
}

async function exportJob(
    jobIndex: number,
    direction: number,
    jilReader: JilFileReader,
    dilReader: DilFileReader,
    gilReader: GilFileReader,
    gfxReader: GfxFileReader,
    exporter: GfxImageExporter,
    nodeFs: NodeFileSystem,
    outputDir: string
): Promise<void> {
    const jilItem = jilReader.getItem(jobIndex);
    if (!jilItem || jilItem.length <= 0) return;
    const dirIndex = jilItem.offset + direction;
    if (dirIndex >= jilItem.offset + jilItem.length) return;
    const dilItem = dilReader.getItem(dirIndex);
    if (!dilItem || dilItem.length <= 0) return;
    const gilIndex = dilItem.offset;
    if (gilIndex < 0 || gilIndex >= gilReader.length) return;
    const gfxOffset = gilReader.getImageOffset(gilIndex);
    if (gfxOffset <= 0) return;
    try {
        const image = gfxReader.readImage(gfxOffset, jobIndex);
        if (!image || image.width === 0 || image.height === 0) return;
        const filename = `job_${String(jobIndex).padStart(3, '0')}.png`;
        await exporter.exportImage(image, nodeFs.join(outputDir, filename));
        console.log(`  job ${jobIndex}: ${image.width}x${image.height}`);
    } catch {
        console.log(`  job ${jobIndex}: FAILED`);
    }
}

async function main() {
    const { baseName, outputDir, jobFilter, direction } = parseArgs(process.argv.slice(2));
    const nodeFs = new NodeFileSystem();
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
    const exporter = new GfxImageExporter(nodeFs, nodeFs);

    await nodeFs.mkdir(outputDir);
    for (const jobIndex of jobFilter) {
        await exportJob(jobIndex, direction, jilReader, dilReader, gilReader, gfxReader, exporter, nodeFs, outputDir);
    }
}

main().catch(console.error);
