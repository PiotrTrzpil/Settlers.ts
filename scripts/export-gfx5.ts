/**
 * Export all images from 5.gfx (map objects) to PNG files.
 * Usage: npx tsx scripts/export-gfx5.ts
 */
import { NodeFileSystem } from '../src/resources/gfx/exporter/file-system';
import { GfxImageExporter } from '../src/resources/gfx/exporter/gfx-image-exporter';

// Polyfill ImageData for Node.js (used by GfxImage.getImageData)
if (typeof globalThis.ImageData === 'undefined') {
     
    (globalThis as Record<string, unknown>).ImageData = class ImageData {
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
const OUTPUT_DIR = 'output/gfx5-export';

async function main() {
    const fs = new NodeFileSystem();
    const exporter = new GfxImageExporter(fs, fs);

    const info = {
        baseName: '5',
        gfxPath: `${GFX_DIR}/5.gfx`,
        gilPath: `${GFX_DIR}/5.gil`,
        palettePath: `${GFX_DIR}/5.p46`,
        pilPath: `${GFX_DIR}/5.pi4`,
        jilPath: `${GFX_DIR}/5.jil`,
        dilPath: `${GFX_DIR}/5.dil`,
        imageCount: 0,
    };

    console.log('Exporting 5.gfx to', OUTPUT_DIR);

    const result = await exporter.exportGfxFile(info, {
        outputDir: OUTPUT_DIR,
        includeMetadata: true,
        onProgress: (current, total, filename) => {
            if (current % 200 === 0 || current === total) {
                console.log(`  ${current}/${total} - ${filename}`);
            }
        },
    });

    console.log(`Done: ${result.exportedCount} exported, ${result.failedCount} failed`);
    if (result.errors.length > 0) {
        console.log('First errors:', result.errors.slice(0, 5).join('\n'));
    }
}

main().catch(console.error);
