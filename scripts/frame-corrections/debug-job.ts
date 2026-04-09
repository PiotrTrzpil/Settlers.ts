/**
 * Debug a specific job — dump all frames for all directions as image strips.
 * Usage: npx tsx scripts/frame-corrections/debug-job.ts <file> <job> [direction]
 */
import '../lib/node-image-data-polyfill';
import { DilFileReader } from '../../src/resources/gfx/dil-file-reader';
import { GfxFileReader } from '../../src/resources/gfx/gfx-file-reader';
import { GilFileReader } from '../../src/resources/gfx/gil-file-reader';
import { JilFileReader } from '../../src/resources/gfx/jil-file-reader';
import { PaletteCollection } from '../../src/resources/gfx/palette-collection';
import { PilFileReader } from '../../src/resources/gfx/pil-file-reader';
import { NodeFileSystem } from '../../src/resources/gfx/exporter/file-system';
import { mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { writeBmp } from './frame-analysis';

const GFX_DIR = 'public/Siedler4/Gfx';
const OUT_DIR = '/tmp/debug-job'; // eslint-disable-line sonarjs/publicly-writable-directories -- debug script temp output

// eslint-disable-next-line sonarjs/cognitive-complexity -- debug script with nested frame iteration
async function main() {
    const fileId = process.argv[2] ?? '20';
    const jobId = Number(process.argv[3] ?? '250');
    const dirFilter = process.argv[4] !== undefined ? Number(process.argv[4]) : null;

    mkdirSync(OUT_DIR, { recursive: true });
    const nodeFs = new NodeFileSystem();
    const resolve = (ext: string) => `${GFX_DIR}/${fileId}.${ext}`;
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
    const palettes = new PaletteCollection(paletteData, pilReader);
    const gfxReader = new GfxFileReader(gfxData, gilReader, jilReader, dilReader, palettes);

    const jilItem = jilReader.getItem(jobId)!;
    if (!jilItem) {
        console.error(`Job ${jobId} not found`);
        return;
    }

    console.log(`File ${fileId}, Job ${jobId}: ${jilItem.length} directions`);

    for (let d = 0; d < jilItem.length; d++) {
        if (dirFilter !== null && d !== dirFilter) continue;
        const dilItem = dilReader.getItem(jilItem.offset + d)!;
        if (!dilItem) continue;
        console.log(`  Dir ${d}: ${dilItem.length} frames`);

        const framePaths: string[] = [];
        for (let f = 0; f < dilItem.length; f++) {
            const gilIndex = dilItem.offset + f;
            const gfxOffset = gilReader.getImageOffset(gilIndex);
            if (gfxOffset <= 0) continue;
            try {
                const image = gfxReader.readImage(gfxOffset, jobId);
                const imgData = image.getImageData();
                const bmpPath = `${OUT_DIR}/f${fileId}_j${jobId}_d${d}_f${f}.bmp`;
                writeBmp(bmpPath, imgData.data, image.width, image.height);

                const rgba = imgData.data;
                let opaque = 0,
                    leftBorder = 0,
                    rightBorder = 0;
                for (let y = 0; y < image.height; y++) {
                    for (let x = 0; x < image.width; x++) {
                        const i = (y * image.width + x) * 4;
                        if (rgba[i + 3]! > 0) {
                            opaque++;
                            if (x < 3) leftBorder++;
                            if (x >= image.width - 3) rightBorder++;
                        }
                    }
                }
                console.log(
                    `    f${f}: ${image.width}x${image.height} opaque=${opaque} left=${leftBorder} right=${rightBorder}`
                );

                const pngPath = bmpPath.replace('.bmp', '.png');
                execSync(`magick "${bmpPath}" -scale 400% "${pngPath}"`);
                framePaths.push(pngPath);
            } catch (e) {
                console.log(`    f${f}: ERROR ${e}`);
            }
        }

        if (framePaths.length > 0) {
            const stripPath = `${OUT_DIR}/strip_f${fileId}_j${jobId}_d${d}.png`;
            execSync(`magick ${framePaths.map(p => `"${p}"`).join(' ')} +append "${stripPath}"`);
            console.log(`  Strip: ${stripPath}`);
        }
    }
}
main();
