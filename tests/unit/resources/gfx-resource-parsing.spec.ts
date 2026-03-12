/**
 * GFX Resource Parsing Tests
 *
 * Tests for binary format parsing: RGB565 palette decoding, 16-bit image decoding,
 * RLE decompression, JIL fallback, and team color data.
 *
 * Reference: S4GFX (C# tool by Wizzard Maker) for format correctness.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Palette } from '@/resources/gfx/palette';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { GfxImage } from '@/resources/gfx/gfx-image';
import { BinaryReader } from '@/resources/file/binary-reader';
import { rgb565ToRgba, TEAM_COLOR_PALETTES, FILE_TEAM_COUNT } from '@/resources/gfx/team-colors';

// Polyfill ImageData for Node.js test environment
beforeAll(() => {
    if (typeof globalThis.ImageData === 'undefined') {
        (globalThis as any).ImageData = class ImageData {
            readonly width: number;
            readonly height: number;
            readonly data: Uint8ClampedArray;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
                this.data = new Uint8ClampedArray(width * height * 4);
            }
        };
    }
});

/** Helper: create a BinaryReader from raw bytes */
function readerFromBytes(bytes: number[]): BinaryReader {
    return new BinaryReader(new Uint8Array(bytes));
}

/** Helper: extract RGBA from a packed uint32 (ABGR layout in memory) */
function unpackColor(packed: number): { r: number; g: number; b: number; a: number } {
    return {
        r: packed & 0xff,
        g: (packed >> 8) & 0xff,
        b: (packed >> 16) & 0xff,
        a: (packed >> 24) & 0xff,
    };
}

describe('RGB565 Palette Decoding', () => {
    it('decodes pure white (0xFFFF) to 255,255,255', () => {
        // 0xFFFF = R:31, G:63, B:31 → all channels max
        const reader = readerFromBytes([0xff, 0xff]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        expect(color.r).toBe(255);
        expect(color.g).toBe(255);
        expect(color.b).toBe(255);
        expect(color.a).toBe(255);
    });

    it('decodes black (0x0000) to 0,0,0', () => {
        const reader = readerFromBytes([0x00, 0x00]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        expect(color.r).toBe(0);
        expect(color.g).toBe(0);
        expect(color.b).toBe(0);
    });

    it('decodes pure red (0xF800) correctly', () => {
        // 0xF800 LE bytes: [0x00, 0xF8]
        const reader = readerFromBytes([0x00, 0xf8]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        expect(color.r).toBe(255);
        expect(color.g).toBe(0);
        expect(color.b).toBe(0);
    });

    it('decodes pure green (0x07E0) correctly', () => {
        // 0x07E0 LE bytes: [0xE0, 0x07]
        const reader = readerFromBytes([0xe0, 0x07]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        expect(color.r).toBe(0);
        expect(color.g).toBe(255);
        expect(color.b).toBe(0);
    });

    it('decodes pure blue (0x001F) correctly', () => {
        // 0x001F LE bytes: [0x1F, 0x00]
        const reader = readerFromBytes([0x1f, 0x00]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        expect(color.r).toBe(0);
        expect(color.g).toBe(0);
        expect(color.b).toBe(255);
    });

    it('bit replication expands mid-range values correctly', () => {
        // R=16 (10000b), G=32 (100000b), B=16 (10000b)
        // RGB565 = 10000_100000_10000 = 0x8410
        // LE bytes: [0x10, 0x84]
        const reader = readerFromBytes([0x10, 0x84]);
        const palette = new Palette(1);
        palette.read16BitPalette(reader, 0);

        const color = unpackColor(palette.getColor(0));
        // R: 16 << 3 = 128, |= 128>>5 = 4 → 132
        expect(color.r).toBe(132);
        // G: 32 << 2 = 128, |= 128>>6 = 2 → 130
        expect(color.g).toBe(130);
        // B: 16 << 3 = 128, |= 128>>5 = 4 → 132
        expect(color.b).toBe(132);
    });
});

describe('16-bit Image Decoding', () => {
    function decode16BitPixel(value1: number, value2: number): { r: number; g: number; b: number } {
        // Create a 1x1 16-bit image
        const reader = readerFromBytes([value1, value2]);
        const img = new GfxImage16Bit(reader, 1, 1);
        img.dataOffset = 0;
        const imageData = img.getImageData();
        return {
            r: imageData.data[0]!,
            g: imageData.data[1]!,
            b: imageData.data[2]!,
        };
    }

    it('decodes pure white correctly', () => {
        const { r, g, b } = decode16BitPixel(0xff, 0xff);
        expect(r).toBe(255);
        expect(g).toBe(255);
        expect(b).toBe(255);
    });

    it('decodes black correctly', () => {
        const { r, g, b } = decode16BitPixel(0x00, 0x00);
        expect(r).toBe(0);
        expect(g).toBe(0);
        expect(b).toBe(0);
    });

    it('decodes pure red correctly', () => {
        const { r, g, b } = decode16BitPixel(0x00, 0xf8);
        expect(r).toBe(255);
        expect(g).toBe(0);
        expect(b).toBe(0);
    });

    it('decodes pure green correctly', () => {
        const { r, g, b } = decode16BitPixel(0xe0, 0x07);
        expect(r).toBe(0);
        expect(g).toBe(255);
        expect(b).toBe(0);
    });

    it('decodes pure blue correctly', () => {
        const { r, g, b } = decode16BitPixel(0x1f, 0x00);
        expect(r).toBe(0);
        expect(g).toBe(0);
        expect(b).toBe(255);
    });

    it('matches palette decoding for same input', () => {
        // Both paths should produce identical colors for the same RGB565 input
        const testCases = [
            [0xff, 0xff], // white
            [0x00, 0xf8], // red
            [0xe0, 0x07], // green
            [0x1f, 0x00], // blue
            [0x10, 0x84], // mid-gray
            [0x00, 0x00], // black
        ];

        for (const [v1, v2] of testCases) {
            // Palette path
            const reader = readerFromBytes([v1!, v2!]);
            const palette = new Palette(1);
            palette.read16BitPalette(reader, 0);
            const palColor = unpackColor(palette.getColor(0));

            // 16-bit image path
            const imgReader = readerFromBytes([v1!, v2!]);
            const img = new GfxImage16Bit(imgReader, 1, 1);
            img.dataOffset = 0;
            const imgData = img.getImageData();

            expect(imgData.data[0]).toBe(palColor.r);
            expect(imgData.data[1]).toBe(palColor.g);
            expect(imgData.data[2]).toBe(palColor.b);
        }
    });
});

describe('RLE Decompression', () => {
    function decodeRLE(bytes: number[], width: number, height: number): Uint32Array {
        const reader = readerFromBytes(bytes);
        const palette = new Palette(256);
        // Set up some palette colors for testing
        for (let i = 0; i < 256; i++) {
            palette.setRGB(i, i, i, i);
        }
        const img = new GfxImage(reader, palette, 0);
        img.width = width;
        img.height = height;
        img.imgType = 0; // RLE
        img.dataOffset = 0;
        const imageData = img.getImageData();
        return new Uint32Array(imageData.data.buffer);
    }

    it('decodes transparent runs (value 0)', () => {
        // [0, 3] = 3 transparent pixels
        const result = decodeRLE([0, 3], 3, 1);
        expect(result[0]).toBe(0x00000000);
        expect(result[1]).toBe(0x00000000);
        expect(result[2]).toBe(0x00000000);
    });

    it('decodes shadow runs (value 1)', () => {
        // [1, 2] = 2 shadow pixels (semi-transparent)
        const result = decodeRLE([1, 2], 2, 1);
        expect(result[0]).toBe(0x40000000);
        expect(result[1]).toBe(0x40000000);
    });

    it('decodes normal palette indices (value > 1)', () => {
        // [42] = single pixel with palette color 42
        const result = decodeRLE([42], 1, 1);
        const color = unpackColor(result[0]!);
        // Palette index 42 = RGB(42,42,42)
        expect(color.r).toBe(42);
        expect(color.g).toBe(42);
        expect(color.b).toBe(42);
        expect(color.a).toBe(255);
    });

    it('decodes mixed RLE data', () => {
        // [0, 1, 50, 1, 2, 60] = 1 transparent, 1 color, 2 shadow, 1 color
        const result = decodeRLE([0, 1, 50, 1, 2, 60], 5, 1);
        expect(result[0]).toBe(0x00000000); // transparent
        expect(unpackColor(result[1]!).r).toBe(50); // palette 50
        expect(result[2]).toBe(0x40000000); // shadow
        expect(result[3]).toBe(0x40000000); // shadow
        expect(unpackColor(result[4]!).r).toBe(60); // palette 60
    });

    it('unencoded mode (imgType=32) reads direct palette indices', () => {
        const reader = readerFromBytes([0, 1, 42, 100]);
        const palette = new Palette(256);
        for (let i = 0; i < 256; i++) {
            palette.setRGB(i, i, i, i);
        }
        const img = new GfxImage(reader, palette, 0);
        img.width = 4;
        img.height = 1;
        img.imgType = 32; // no encoding
        img.dataOffset = 0;
        const imageData = img.getImageData();
        const result = new Uint32Array(imageData.data.buffer);

        // In unencoded mode, ALL values are palette lookups (0 and 1 are colors, not operators)
        expect(unpackColor(result[0]!).r).toBe(0);
        expect(unpackColor(result[1]!).r).toBe(1);
        expect(unpackColor(result[2]!).r).toBe(42);
        expect(unpackColor(result[3]!).r).toBe(100);
    });
});

describe('Team Color Data', () => {
    it('has 8 team color palettes', () => {
        expect(TEAM_COLOR_PALETTES).toHaveLength(8);
    });

    it('each palette has 32 entries', () => {
        for (const palette of TEAM_COLOR_PALETTES) {
            expect(palette).toHaveLength(FILE_TEAM_COUNT);
        }
    });

    it('red team gradient increases in red channel', () => {
        const red = TEAM_COLOR_PALETTES[0]!;
        // Decode first non-zero and last entries
        const [, , , firstNonZeroIdx] = [0, 1, 2, 3]; // index 3 is 0x0800
        const first = rgb565ToRgba(red[firstNonZeroIdx]!);
        const last = rgb565ToRgba(red[31]!);
        expect(last[0]).toBeGreaterThan(first[0]); // red increases
    });

    it('blue team gradient increases in blue channel', () => {
        const blue = TEAM_COLOR_PALETTES[1]!;
        const mid = rgb565ToRgba(blue[15]!);
        const last = rgb565ToRgba(blue[31]!);
        expect(last[2]).toBeGreaterThan(mid[2]); // blue increases
    });

    it('rgb565ToRgba converts correctly', () => {
        // 0xF800 = pure red
        expect(rgb565ToRgba(0xf800)).toEqual([255, 0, 0, 255]);
        // 0x07E0 = pure green
        expect(rgb565ToRgba(0x07e0)).toEqual([0, 255, 0, 255]);
        // 0x001F = pure blue
        expect(rgb565ToRgba(0x001f)).toEqual([0, 0, 255, 255]);
        // 0x0000 = black
        expect(rgb565ToRgba(0x0000)).toEqual([0, 0, 0, 255]);
        // 0xFFFF = white
        expect(rgb565ToRgba(0xffff)).toEqual([255, 255, 255, 255]);
    });
});
