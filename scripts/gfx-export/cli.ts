#!/usr/bin/env npx tsx

/**
 * GFX Image Exporter CLI
 *
 * Exports images from Settlers 4 GFX files to PNG format.
 *
 * Usage:
 *   npx tsx scripts/gfx-export/cli.ts <input> [output] [options]
 *
 * Examples:
 *   # Export a single GFX file
 *   npx tsx scripts/gfx-export/cli.ts path/to/file.gfx ./output
 *
 *   # Export all GFX files in a directory
 *   npx tsx scripts/gfx-export/cli.ts path/to/gfx/directory ./output
 *
 *   # Export specific image indices
 *   npx tsx scripts/gfx-export/cli.ts path/to/file.gfx ./output --indices 0,1,2,10-20
 *
 *   # Include metadata in filenames
 *   npx tsx scripts/gfx-export/cli.ts path/to/file.gfx ./output --metadata
 *
 *   # List images without exporting
 *   npx tsx scripts/gfx-export/cli.ts path/to/file.gfx --info
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Using path aliases from tsconfig.json
import { BinaryReader } from '@/resources/file/binary-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { LibFileReader } from '@/resources/lib/lib-file-reader';

// ============================================================================
// PNG Encoder (inline to avoid import issues)
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
(function initCRC32Table() {
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        CRC32_TABLE[n] = c;
    }
})();

function crc32(data: Uint8Array, start = 0, length?: number): number {
    const len = length ?? data.length - start;
    let crc = 0xffffffff;
    for (let i = start; i < start + len; i++) {
        crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return crc ^ 0xffffffff;
}

function adler32(data: Uint8Array): number {
    let a = 1, b = 0;
    const MOD = 65521;
    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % MOD;
        b = (b + a) % MOD;
    }
    return (b << 16) | a;
}

function writeUint32BE(arr: Uint8Array, value: number, offset: number): void {
    arr[offset] = (value >> 24) & 0xff;
    arr[offset + 1] = (value >> 16) & 0xff;
    arr[offset + 2] = (value >> 8) & 0xff;
    arr[offset + 3] = value & 0xff;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(4 + 4 + data.length + 4);
    writeUint32BE(chunk, data.length, 0);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    const crcData = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) crcData[i] = type.charCodeAt(i);
    crcData.set(data, 4);
    writeUint32BE(chunk, crc32(crcData), 8 + data.length);
    return chunk;
}

async function encodePng(imageData: ImageData): Promise<Uint8Array> {
    const { width, height, data } = imageData;

    // Create filtered scanlines
    const rowSize = 1 + width * 4;
    const filteredData = new Uint8Array(height * rowSize);
    for (let y = 0; y < height; y++) {
        filteredData[y * rowSize] = 0; // No filter
        const srcStart = y * width * 4;
        filteredData.set(data.subarray(srcStart, srcStart + width * 4), y * rowSize + 1);
    }

    // Compress using Node.js zlib
    const zlib = await import('zlib');
    const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.deflate(filteredData, { level: 6 }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });

    // Build PNG
    const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdrData = new Uint8Array(13);
    writeUint32BE(ihdrData, width, 0);
    writeUint32BE(ihdrData, height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // RGBA
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    const ihdr = createPngChunk('IHDR', ihdrData);
    const idat = createPngChunk('IDAT', new Uint8Array(compressed));
    const iend = createPngChunk('IEND', new Uint8Array(0));

    const png = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length);
    let offset = 0;
    png.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
    png.set(ihdr, offset); offset += ihdr.length;
    png.set(idat, offset); offset += idat.length;
    png.set(iend, offset);

    return png;
}

// ============================================================================
// CLI Implementation
// ============================================================================

interface CliOptions {
    input: string;
    output: string;
    indices?: number[];
    metadata: boolean;
    info: boolean;
    verbose: boolean;
}

function parseIndices(str: string): number[] {
    const result: number[] = [];
    const parts = str.split(',');

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                result.push(i);
            }
        } else {
            result.push(Number(part));
        }
    }

    return result.filter(n => !isNaN(n));
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        input: '',
        output: './output',
        metadata: false,
        info: false,
        verbose: false
    };

    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--indices' || arg === '-i') {
            options.indices = parseIndices(args[++i] || '');
        } else if (arg === '--metadata' || arg === '-m') {
            options.metadata = true;
        } else if (arg === '--info') {
            options.info = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    options.input = positional[0] || '';
    options.output = positional[1] || './output';

    return options;
}

function printHelp(): void {
    console.log(`
GFX Image Exporter - Export images from Settlers 4 GFX files

Usage:
  npx tsx scripts/gfx-export/cli.ts <input> [output] [options]

Arguments:
  input           Path to a .gfx, .gh5, .gh6 file, .lib archive, or directory
  output          Output directory (default: ./output)

Options:
  -i, --indices   Export specific indices (e.g., "0,1,2,10-20")
  -m, --metadata  Include size/offset info in filenames
  --info          Show file info without exporting
  -v, --verbose   Verbose output
  -h, --help      Show this help message

Examples:
  # Export a single GFX file
  npx tsx scripts/gfx-export/cli.ts Gfx/1.gfx ./exported

  # Export from a .lib archive
  npx tsx scripts/gfx-export/cli.ts Gfx.lib ./exported

  # Export specific images
  npx tsx scripts/gfx-export/cli.ts Gfx/1.gfx ./exported -i 0-100

  # Show file info
  npx tsx scripts/gfx-export/cli.ts Gfx/1.gfx --info
`);
}

async function readBinaryFile(filePath: string): Promise<BinaryReader> {
    const data = await fs.readFile(filePath);
    return new BinaryReader(new Uint8Array(data), 0, null, path.basename(filePath));
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

interface GfxFileSet {
    name: string;
    gfxPath: string;
    gilPath: string;
    palettePath: string;
    pilPath: string;
    jilPath?: string;
    dilPath?: string;
}

async function findGfxCompanions(gfxPath: string): Promise<GfxFileSet | null> {
    const dir = path.dirname(gfxPath);
    const baseName = path.basename(gfxPath, path.extname(gfxPath));

    const gilPath = path.join(dir, `${baseName}.gil`);
    const pa6Path = path.join(dir, `${baseName}.pa6`);
    const p46Path = path.join(dir, `${baseName}.p46`);
    const pilPath = path.join(dir, `${baseName}.pil`);
    const pi4Path = path.join(dir, `${baseName}.pi4`);
    const jilPath = path.join(dir, `${baseName}.jil`);
    const dilPath = path.join(dir, `${baseName}.dil`);

    const hasGil = await fileExists(gilPath);
    const hasPa6 = await fileExists(pa6Path);
    const hasP46 = await fileExists(p46Path);
    const hasPil = await fileExists(pilPath);
    const hasPi4 = await fileExists(pi4Path);
    const hasJil = await fileExists(jilPath);
    const hasDil = await fileExists(dilPath);

    if (!hasGil) return null;
    if (!hasPa6 && !hasP46) return null;
    if (!hasPil && !hasPi4) return null;

    return {
        name: baseName,
        gfxPath,
        gilPath,
        palettePath: hasPa6 ? pa6Path : p46Path,
        pilPath: hasPil ? pilPath : pi4Path,
        jilPath: hasJil ? jilPath : undefined,
        dilPath: hasDil ? dilPath : undefined
    };
}

async function loadGfxReader(fileSet: GfxFileSet): Promise<GfxFileReader> {
    const [gfxData, gilData, paletteData, pilData] = await Promise.all([
        readBinaryFile(fileSet.gfxPath),
        readBinaryFile(fileSet.gilPath),
        readBinaryFile(fileSet.palettePath),
        readBinaryFile(fileSet.pilPath)
    ]);

    const jilData = fileSet.jilPath ? await readBinaryFile(fileSet.jilPath).catch(() => null) : null;
    const dilData = fileSet.dilPath ? await readBinaryFile(fileSet.dilPath).catch(() => null) : null;

    const gilReader = new GilFileReader(gilData);
    const pilReader = new PilFileReader(pilData);
    const paletteCollection = new PaletteCollection(paletteData, pilReader);
    const jilReader = jilData ? new JilFileReader(jilData) : null;
    const dilReader = dilData ? new DilFileReader(dilData) : null;

    return new GfxFileReader(gfxData, gilReader, jilReader, dilReader, paletteCollection);
}

async function exportImage(image: IGfxImage, outputPath: string): Promise<void> {
    const imageData = image.getImageData();
    const pngData = await encodePng(imageData);
    await fs.writeFile(outputPath, pngData);
}

async function exportGfxFile(
    fileSet: GfxFileSet,
    outputDir: string,
    options: CliOptions
): Promise<{ exported: number; failed: number }> {
    const reader = await loadGfxReader(fileSet);
    const imageCount = reader.getImageCount();

    const outDir = path.join(outputDir, fileSet.name);
    await fs.mkdir(outDir, { recursive: true });

    const indices = options.indices ?? Array.from({ length: imageCount }, (_, i) => i);

    let exported = 0;
    let failed = 0;

    for (const index of indices) {
        if (index < 0 || index >= imageCount) continue;

        try {
            const image = reader.getImage(index);
            if (!image || image.width === 0 || image.height === 0) continue;

            let filename = index.toString().padStart(5, '0');
            if (options.metadata) {
                filename += `_${image.width}x${image.height}`;
                if (image.left !== 0 || image.top !== 0) {
                    filename += `_offset${image.left}x${image.top}`;
                }
            }
            filename += '.png';

            const outputPath = path.join(outDir, filename);
            await exportImage(image, outputPath);

            if (options.verbose) {
                console.log(`  Exported: ${filename}`);
            }

            exported++;
        } catch (err) {
            failed++;
            if (options.verbose) {
                console.error(`  Failed: ${index} - ${err}`);
            }
        }
    }

    return { exported, failed };
}

async function exportGhFile(
    filePath: string,
    outputDir: string,
    options: CliOptions
): Promise<{ exported: number; failed: number }> {
    const data = await readBinaryFile(filePath);
    const reader = new GhFileReader(data);
    const imageCount = reader.getImageCount();

    const baseName = path.basename(filePath, path.extname(filePath));
    const outDir = path.join(outputDir, baseName);
    await fs.mkdir(outDir, { recursive: true });

    const indices = options.indices ?? Array.from({ length: imageCount }, (_, i) => i);

    let exported = 0;
    let failed = 0;

    for (const index of indices) {
        if (index < 0 || index >= imageCount) continue;

        try {
            const image = reader.getImage(index);
            if (!image || image.width === 0 || image.height === 0) continue;

            let filename = index.toString().padStart(3, '0');
            if (options.metadata) {
                filename += `_${image.width}x${image.height}`;
            }
            filename += '.png';

            const outputPath = path.join(outDir, filename);
            await exportImage(image, outputPath);

            if (options.verbose) {
                console.log(`  Exported: ${filename}`);
            }

            exported++;
        } catch (err) {
            failed++;
            if (options.verbose) {
                console.error(`  Failed: ${index} - ${err}`);
            }
        }
    }

    return { exported, failed };
}

async function showGfxInfo(fileSet: GfxFileSet): Promise<void> {
    const reader = await loadGfxReader(fileSet);
    const imageCount = reader.getImageCount();

    console.log(`\nFile: ${fileSet.name}`);
    console.log(`Total images: ${imageCount}`);
    console.log(`\nImage details:`);

    let validCount = 0;
    for (let i = 0; i < imageCount; i++) {
        const image = reader.getImage(i);
        if (image && image.width > 0 && image.height > 0) {
            validCount++;
            if (validCount <= 20) {
                console.log(
                    `  [${i.toString().padStart(5)}] ${image.width}x${image.height} ` +
                    `offset: (${image.left}, ${image.top})`
                );
            }
        }
    }

    if (validCount > 20) {
        console.log(`  ... and ${validCount - 20} more images`);
    }

    console.log(`\nValid images: ${validCount}`);
}

async function showGhInfo(filePath: string): Promise<void> {
    const data = await readBinaryFile(filePath);
    const reader = new GhFileReader(data);
    const imageCount = reader.getImageCount();

    console.log(`\nFile: ${path.basename(filePath)}`);
    console.log(`Total images: ${imageCount}`);
    console.log(`\nImage details:`);

    for (let i = 0; i < imageCount; i++) {
        const image = reader.getImage(i);
        if (image) {
            console.log(
                `  [${i.toString().padStart(3)}] ${image.width}x${image.height} ` +
                `type: ${image.imageType}`
            );
        }
    }
}

async function processLibFile(
    libPath: string,
    outputDir: string,
    options: CliOptions
): Promise<void> {
    const data = await readBinaryFile(libPath);
    const reader = new LibFileReader(data);
    const fileCount = reader.getFileCount();

    console.log(`Processing LIB archive: ${path.basename(libPath)}`);
    console.log(`Contains ${fileCount} files\n`);

    // Create a temporary directory to extract files
    const tempDir = path.join(outputDir, '.temp_lib');
    await fs.mkdir(tempDir, { recursive: true });

    let totalExported = 0;
    let totalFailed = 0;

    for (let i = 0; i < fileCount; i++) {
        const fileInfo = reader.getFileInfo(i);
        const fileName = fileInfo.fileName.toLowerCase();

        // Check if it's a GFX-related file
        if (fileName.endsWith('.gfx') || fileName.endsWith('.gh5') || fileName.endsWith('.gh6')) {
            const fullPath = reader.getFullPathName(i);
            console.log(`Found: ${fullPath}`);

            // Extract the file and its companions
            const extractedFiles = new Map<string, BinaryReader>();
            const baseName = path.basename(fileName, path.extname(fileName));

            // Find all files with same base name
            for (let j = 0; j < fileCount; j++) {
                const otherInfo = reader.getFileInfo(j);
                const otherName = otherInfo.fileName.toLowerCase();
                const otherBase = path.basename(otherName, path.extname(otherName));

                if (otherBase === baseName) {
                    extractedFiles.set(otherName, otherInfo.getReader());
                }
            }

            // Process the extracted files
            if (fileName.endsWith('.gfx')) {
                // Check if we have all required files
                const hasGil = extractedFiles.has(`${baseName}.gil`);
                const hasPa6 = extractedFiles.has(`${baseName}.pa6`) || extractedFiles.has(`${baseName}.p46`);
                const hasPil = extractedFiles.has(`${baseName}.pil`) || extractedFiles.has(`${baseName}.pi4`);

                if (hasGil && hasPa6 && hasPil) {
                    const gfxData = extractedFiles.get(`${baseName}.gfx`)!;
                    const gilData = extractedFiles.get(`${baseName}.gil`)!;
                    const paletteData = extractedFiles.get(`${baseName}.pa6`) || extractedFiles.get(`${baseName}.p46`)!;
                    const pilData = extractedFiles.get(`${baseName}.pil`) || extractedFiles.get(`${baseName}.pi4`)!;
                    const jilData = extractedFiles.get(`${baseName}.jil`);
                    const dilData = extractedFiles.get(`${baseName}.dil`);

                    const gilReader = new GilFileReader(gilData);
                    const pilReader = new PilFileReader(pilData);
                    const paletteCollection = new PaletteCollection(paletteData, pilReader);
                    const jilReader = jilData ? new JilFileReader(jilData) : null;
                    const dilReader = dilData ? new DilFileReader(dilData) : null;

                    const gfxReader = new GfxFileReader(gfxData, gilReader, jilReader, dilReader, paletteCollection);
                    const imageCount = gfxReader.getImageCount();

                    if (options.info) {
                        console.log(`  Images: ${imageCount}`);
                    } else {
                        const outDir = path.join(outputDir, baseName);
                        await fs.mkdir(outDir, { recursive: true });

                        const indices = options.indices ?? Array.from({ length: imageCount }, (_, k) => k);

                        for (const index of indices) {
                            if (index < 0 || index >= imageCount) continue;

                            try {
                                const image = gfxReader.getImage(index);
                                if (!image || image.width === 0 || image.height === 0) continue;

                                let filename = index.toString().padStart(5, '0');
                                if (options.metadata) {
                                    filename += `_${image.width}x${image.height}`;
                                }
                                filename += '.png';

                                await exportImage(image, path.join(outDir, filename));
                                totalExported++;

                                if (options.verbose) {
                                    console.log(`    Exported: ${filename}`);
                                }
                            } catch {
                                totalFailed++;
                            }
                        }

                        console.log(`  Exported ${totalExported} images from ${baseName}`);
                    }
                }
            } else if (fileName.endsWith('.gh5') || fileName.endsWith('.gh6')) {
                const ghData = extractedFiles.get(fileName)!;
                const ghReader = new GhFileReader(ghData);
                const imageCount = ghReader.getImageCount();

                if (options.info) {
                    console.log(`  Images: ${imageCount}`);
                } else {
                    const outDir = path.join(outputDir, baseName);
                    await fs.mkdir(outDir, { recursive: true });

                    const indices = options.indices ?? Array.from({ length: imageCount }, (_, k) => k);

                    for (const index of indices) {
                        if (index < 0 || index >= imageCount) continue;

                        try {
                            const image = ghReader.getImage(index);
                            if (!image || image.width === 0 || image.height === 0) continue;

                            let filename = index.toString().padStart(3, '0');
                            if (options.metadata) {
                                filename += `_${image.width}x${image.height}`;
                            }
                            filename += '.png';

                            await exportImage(image, path.join(outDir, filename));
                            totalExported++;
                        } catch {
                            totalFailed++;
                        }
                    }

                    console.log(`  Exported ${totalExported} images from ${baseName}`);
                }
            }
        }
    }

    // Cleanup temp directory
    try {
        await fs.rm(tempDir, { recursive: true });
    } catch {
        // Ignore cleanup errors
    }

    if (!options.info) {
        console.log(`\nTotal: ${totalExported} exported, ${totalFailed} failed`);
    }
}

async function processDirectory(
    dirPath: string,
    outputDir: string,
    options: CliOptions
): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    let totalExported = 0;
    let totalFailed = 0;

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const filePath = path.join(dirPath, entry.name);
        const lower = entry.name.toLowerCase();

        if (lower.endsWith('.gfx')) {
            const fileSet = await findGfxCompanions(filePath);
            if (fileSet) {
                console.log(`Processing: ${entry.name}`);

                if (options.info) {
                    await showGfxInfo(fileSet);
                } else {
                    const result = await exportGfxFile(fileSet, outputDir, options);
                    totalExported += result.exported;
                    totalFailed += result.failed;
                    console.log(`  Exported: ${result.exported}, Failed: ${result.failed}`);
                }
            }
        } else if (lower.endsWith('.gh5') || lower.endsWith('.gh6')) {
            console.log(`Processing: ${entry.name}`);

            if (options.info) {
                await showGhInfo(filePath);
            } else {
                const result = await exportGhFile(filePath, outputDir, options);
                totalExported += result.exported;
                totalFailed += result.failed;
                console.log(`  Exported: ${result.exported}, Failed: ${result.failed}`);
            }
        } else if (lower.endsWith('.lib')) {
            await processLibFile(filePath, outputDir, options);
        }
    }

    if (!options.info) {
        console.log(`\nTotal: ${totalExported} exported, ${totalFailed} failed`);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (!options.input) {
        printHelp();
        process.exit(1);
    }

    // Check if input exists
    try {
        await fs.access(options.input);
    } catch {
        console.error(`Error: Input not found: ${options.input}`);
        process.exit(1);
    }

    const stats = await fs.stat(options.input);
    const lower = options.input.toLowerCase();

    if (stats.isDirectory()) {
        // Process directory
        await processDirectory(options.input, options.output, options);
    } else if (lower.endsWith('.lib')) {
        // Process LIB archive
        await processLibFile(options.input, options.output, options);
    } else if (lower.endsWith('.gfx')) {
        // Process single GFX file
        const fileSet = await findGfxCompanions(options.input);
        if (!fileSet) {
            console.error('Error: Missing companion files (gil, pa6/p46, pil/pi4)');
            process.exit(1);
        }

        if (options.info) {
            await showGfxInfo(fileSet);
        } else {
            console.log(`Processing: ${fileSet.name}`);
            await fs.mkdir(options.output, { recursive: true });
            const result = await exportGfxFile(fileSet, options.output, options);
            console.log(`Exported: ${result.exported}, Failed: ${result.failed}`);
        }
    } else if (lower.endsWith('.gh5') || lower.endsWith('.gh6')) {
        // Process single GH file
        if (options.info) {
            await showGhInfo(options.input);
        } else {
            console.log(`Processing: ${path.basename(options.input)}`);
            await fs.mkdir(options.output, { recursive: true });
            const result = await exportGhFile(options.input, options.output, options);
            console.log(`Exported: ${result.exported}, Failed: ${result.failed}`);
        }
    } else {
        console.error('Error: Unsupported file type. Use .gfx, .gh5, .gh6, .lib, or a directory.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
