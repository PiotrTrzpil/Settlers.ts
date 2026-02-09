import { BinaryReader } from '../file/binary-reader';

/** a image color palette */
export class Palette {
    private palette: Uint32Array;

    constructor(count = 256) {
        this.palette = new Uint32Array(count);

        Object.seal(this);
    }

    public setRGB(index: number, r: number, g: number, b: number): void {
        this.palette[index] = r | (g << 8) | (b << 16) | (255 << 24);
    }

    public getColor(index: number): number {
        return this.palette[index];
    }

    /** Get the raw palette data for worker transfer */
    public getData(): Uint32Array {
        return this.palette;
    }

    public read3BytePalette(buffer: Uint8Array, pos: number): number {
        for (let i = 0; i < this.palette.length; i++) {
            const r = buffer[pos++];
            const g = buffer[pos++];
            const b = buffer[pos++];

            this.setRGB(i, r, g, b);
        }

        return pos;
    }

    public read16BitPalette(buffer: BinaryReader, pos = 0): number {
        buffer.setOffset(pos);

        for (let i = 0; i < this.palette.length; i++) {
            const value1 = buffer.readByte();
            const value2 = buffer.readByte();

            // Extract 5-6-5 components (assuming Little Endian ordering of bytes/bits logic from original)
            // Original logic:
            // R: value2 & 0xF8 (Top 5 bits of byte 2)
            // G: ((value1 >> 3) | (value2 << 5)) & 0xFC (Top 3 of byte 1 | Bottom 3 of byte 2)
            // B: (value1 << 3) & 0xF8 (Bottom 5 bits of byte 1)

            let r = value2 & 0xF8;
            let g = ((value1 >> 3) | (value2 << 5)) & 0xFC;
            let b = (value1 << 3) & 0xF8;

            // Fix color artifacts by replicating higher bits into the lower empty bits
            // This converts 5/6-bit color to full 8-bit range (e.g. 0..31 -> 0..255)
            // instead of just shifting (0..31 -> 0..248), which causes banding.
            r |= (r >> 5);
            g |= (g >> 6);
            b |= (b >> 5);

            this.setRGB(i, r, g, b);
        }

        return buffer.getOffset();
    }
}
