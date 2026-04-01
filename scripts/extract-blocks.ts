#!/usr/bin/env npx tsx
/**
 * Extract specific 64×64 texture blocks from 2.gh6 for visual comparison.
 * Outputs PNG files to output/texture-blocks/.
 */

import './lib/node-image-data-polyfill';
import * as fs from 'fs/promises';
import * as path from 'path';

import { BinaryReader } from '../src/resources/file/binary-reader';
import { GhFileReader } from '../src/resources/gfx/gh-file-reader';
import { GfxImage16Bit } from '../src/resources/gfx/gfx-image-16bit';
import { ImageType } from '../src/resources/gfx/image-type';

// Blocks to extract: [label, col, row]
const BLOCKS: [string, number, number][] = [
    // Working transition: Beach↔Grass (cols 2-3, row 12-13)
    ['beach-grass-left-r12', 2, 12],
    ['beach-grass-right-r12', 3, 12],

    // River Slot C: Grass↔River4 (cols 2-3, rows 74-75) — THE PROBLEMATIC ONE
    ['slotC-left-r74', 2, 74],
    ['slotC-right-r74', 3, 74],
];

// Sub-region extraction: each 64×64 block has 6 sub-regions used by getTextureA/B
// Sub-regions are 32×32 pixels sampled from specific offsets within the block.
// destX offsets (in 16px units): +0, +1, +2, +3
// destY offsets (in 32px units): +0, +1
// getTextureA: t0min→(+2,+1), t1min→(+3,+0), t2min→(+1,+0)
// getTextureB: t0min→(+2,+1), t1min→(+1,+0), t2min→(+0,+1)
interface SubRegion {
    label: string;
    col: number;
    row: number;
    offX: number;
    offY: number;
}
const SUB_REGIONS: SubRegion[] = [];

// Extract sub-regions for Beach↔Grass left (col 2, row 12) and Slot C left (col 2, row 74)
for (const [name, col, row] of [
    ['beach-left', 2, 12],
    ['slotC-left', 2, 74],
] as const) {
    SUB_REGIONS.push({ label: `${name}_A-t2min(+1,+0)`, col, row, offX: 1, offY: 0 });
    SUB_REGIONS.push({ label: `${name}_A-t1min(+3,+0)`, col, row, offX: 3, offY: 0 });
    SUB_REGIONS.push({ label: `${name}_A-t0min(+2,+1)`, col, row, offX: 2, offY: 1 });
    SUB_REGIONS.push({ label: `${name}_B-t2min(+0,+1)`, col, row, offX: 0, offY: 1 });
    SUB_REGIONS.push({ label: `${name}_B-t1min(+1,+0)`, col, row, offX: 1, offY: 0 });
    SUB_REGIONS.push({ label: `${name}_B-t0min(+2,+1)`, col, row, offX: 2, offY: 1 });
}

function rgb565toRgb(val: number): [number, number, number] {
    const r = ((val >> 11) & 0x1f) << 3;
    const g = ((val >> 5) & 0x3f) << 2;
    const b = (val & 0x1f) << 3;
    return [r | (r >> 5), g | (g >> 6), b | (b >> 5)];
}

function extractSubRegion(
    raw: Uint16Array,
    imgWidth: number,
    col: number,
    row: number,
    offX: number,
    offY: number
): Uint8ClampedArray {
    // Sub-region: 32×32 pixels starting at block origin + offset
    const bx = col * 64 + offX * 16;
    const by = row * 64 + offY * 32;
    const rgba = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
            const srcIdx = (by + y) * imgWidth + (bx + x);
            const val = raw[srcIdx]!;
            const [r, g, b] = rgb565toRgb(val);
            const dstIdx = (y * 32 + x) * 4;
            rgba[dstIdx] = r;
            rgba[dstIdx + 1] = g;
            rgba[dstIdx + 2] = b;
            rgba[dstIdx + 3] = val === 0xf81f ? 128 : 255;
        }
    }
    return rgba;
}

function extractBlock(raw: Uint16Array, imgWidth: number, col: number, row: number): Uint8ClampedArray {
    const bx = col * 64;
    const by = row * 64;
    const rgba = new Uint8ClampedArray(64 * 64 * 4);

    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const srcIdx = (by + y) * imgWidth + (bx + x);
            const val = raw[srcIdx]!;
            const [r, g, b] = rgb565toRgb(val);
            const dstIdx = (y * 64 + x) * 4;
            rgba[dstIdx] = r;
            rgba[dstIdx + 1] = g;
            rgba[dstIdx + 2] = b;
            rgba[dstIdx + 3] = val === 0xf81f ? 128 : 255; // semi-transparent for magenta
        }
    }
    return rgba;
}

/** Write a minimal PNG (uncompressed, using zlib stored blocks). */
function writePPM(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
    // Use PPM (P6) format — trivial, no dependencies
    const header = `P6\n${width} ${height}\n255\n`;
    const buf = Buffer.alloc(header.length + width * height * 3);
    buf.write(header);
    let offset = header.length;
    for (let i = 0; i < width * height; i++) {
        buf[offset++] = rgba[i * 4]!;
        buf[offset++] = rgba[i * 4 + 1]!;
        buf[offset++] = rgba[i * 4 + 2]!;
    }
    return buf;
}

/** Create an HTML page that shows all blocks side by side for easy comparison */
function createHtmlViewer(blocks: { label: string; rgba: Uint8ClampedArray }[]): string {
    const canvasScripts = blocks.map((b, i) => {
        const dataArr = Array.from(b.rgba);
        return `
        {
            const c = document.getElementById('c${i}');
            c.width = 64; c.height = 64;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(64, 64);
            const d = [${dataArr.join(',')}];
            for (let i = 0; i < d.length; i++) img.data[i] = d[i];
            ctx.putImageData(img, 0, 0);
        }`;
    });

    return `<!DOCTYPE html>
<html><head><title>Texture Block Comparison</title>
<style>
body { background: #222; color: #eee; font-family: monospace; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 16px; }
.block { text-align: center; }
.block canvas { border: 1px solid #555; image-rendering: pixelated; width: 192px; height: 192px; }
.block .label { margin-top: 4px; font-size: 11px; }
h2 { padding: 0 16px; border-bottom: 1px solid #444; }
.magenta { color: #f0f; }
</style></head>
<body>
<h1>Texture Block Comparison</h1>
<p>Left = "outerType first" column, Right = "innerType first" column.<br>
<span class="magenta">Magenta (0xF81F)</span> = transparency key pixels shown semi-transparent.</p>

<h2>Working: Beach↔Grass (rows 12-13)</h2>
<div class="grid">
${blocks
    .slice(0, 4)
    .map((b, i) => `<div class="block"><canvas id="c${i}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<h2>Working: Desert gradient (row 40)</h2>
<div class="grid">
${blocks
    .slice(4, 6)
    .map((b, i) => `<div class="block"><canvas id="c${i + 4}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<h2>River uniform tiles</h2>
<div class="grid">
${blocks
    .slice(6, 8)
    .map((b, i) => `<div class="block"><canvas id="c${i + 6}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<h2>River Slot A: River3↔River1 (rows 72-73, cols 2-3)</h2>
<div class="grid">
${blocks
    .slice(8, 12)
    .map((b, i) => `<div class="block"><canvas id="c${i + 8}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<h2>River Slot B: River4↔River3 (rows 74-75, cols 0-1)</h2>
<div class="grid">
${blocks
    .slice(12, 16)
    .map((b, i) => `<div class="block"><canvas id="c${i + 12}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<h2>River Slot C: Grass↔River4 (rows 74-75, cols 2-3) — PROBLEMATIC</h2>
<div class="grid">
${blocks
    .slice(16, 20)
    .map((b, i) => `<div class="block"><canvas id="c${i + 16}"></canvas><div class="label">${b.label}</div></div>`)
    .join('\n')}
</div>

<script>
${canvasScripts.join('\n')}
</script>
</body></html>`;
}

async function main() {
    const filePath = path.resolve('public/Siedler4/Gfx/2.gh6');
    const data = await fs.readFile(filePath);
    const reader = new BinaryReader(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const ghReader = new GhFileReader(reader);
    const img = ghReader.findImageByType<GfxImage16Bit>(ImageType.Image16Bit);

    if (!img) {
        console.error('No 16-bit image found in 2.gh6');
        process.exit(1);
    }

    console.log(`Source image: ${img.width}×${img.height}`);
    const raw = img.getRaw16BitImage();

    const results: { label: string; rgba: Uint8ClampedArray }[] = [];

    for (const [label, col, row] of BLOCKS) {
        const pixelY = row * 64;
        if (pixelY + 64 > img.height) {
            console.warn(`Block ${label} (row ${row}) exceeds image height ${img.height}, skipping`);
            continue;
        }
        const rgba = extractBlock(raw, img.width, col, row);
        results.push({ label, rgba });
        console.log(`Extracted: ${label} (col=${col}, row=${row}, px=${col * 64},${row * 64})`);
    }

    const outDir = path.resolve('output/texture-blocks');
    await fs.mkdir(outDir, { recursive: true });

    // Write individual PPM files
    for (const { label, rgba } of results) {
        const ppm = writePPM(64, 64, rgba);
        await fs.writeFile(path.join(outDir, `${label}.ppm`), ppm);
    }

    // Full 64×64 block strips
    await writeStrip(outDir, 'strip-blocks', results, 64);

    // Sub-region extraction
    const subResults: { label: string; rgba: Uint8ClampedArray }[] = [];
    for (const sr of SUB_REGIONS) {
        const pixelY = sr.row * 64;
        if (pixelY + 64 > img.height) continue;
        const rgba = extractSubRegion(raw, img.width, sr.col, sr.row, sr.offX, sr.offY);
        subResults.push({ label: sr.label, rgba });
        console.log(`Sub-region: ${sr.label}`);
    }

    // Write sub-region strips: beach-left (6) then slotC-left (6)
    await writeStrip(outDir, 'strip-subregions-beach-left', subResults.slice(0, 6), 32);
    await writeStrip(outDir, 'strip-subregions-slotC-left', subResults.slice(6, 12), 32);

    const html = createHtmlViewer(results);
    const htmlPath = path.join(outDir, 'compare.html');
    await fs.writeFile(htmlPath, html);
    console.log(`\nFiles written to: ${outDir}`);

    async function writeStrip(
        dir: string,
        name: string,
        blocks: { label: string; rgba: Uint8ClampedArray }[],
        blockSize = 64
    ) {
        const n = blocks.length;
        const w = n * blockSize;
        const h = blockSize;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let bi = 0; bi < n; bi++) {
            const src = blocks[bi]!.rgba;
            for (let y = 0; y < blockSize; y++) {
                for (let x = 0; x < blockSize; x++) {
                    const si = (y * blockSize + x) * 4;
                    const di = (y * w + bi * blockSize + x) * 4;
                    rgba[di] = src[si]!;
                    rgba[di + 1] = src[si + 1]!;
                    rgba[di + 2] = src[si + 2]!;
                    rgba[di + 3] = src[si + 3]!;
                }
            }
        }
        const ppm = writePPM(w, h, rgba);
        await fs.writeFile(path.join(dir, `${name}.ppm`), ppm);
        console.log(`Strip: ${name}.ppm (${n} blocks)`);
    }
}

main().catch(console.error);
