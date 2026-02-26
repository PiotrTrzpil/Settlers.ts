import { BinaryReader } from '../file/binary-reader';
import { IGfxImage } from './igfx-image';
import { ImageType } from './image-type';

export class GfxImage16Bit implements IGfxImage {
    public imageType = ImageType.Image16Bit;

    /** start of image data */
    public dataOffset = 0;

    /** width of the image */
    public width: number;
    /** height of the image */
    public height: number;
    /** left (x) offset to display the image */
    public left = 0;
    /** top (y) offset to display the image */
    public top = 0;

    public flag1 = 0;
    public flag2 = 0;
    public rowCount: number;

    private data: BinaryReader;

    private getImageData16Bit(buffer: Uint8Array, imgData: Uint8ClampedArray, pos: number, length: number) {
        let j = 0;
        while (j < length) {
            const value1 = buffer[pos]!;
            pos++;

            const value2 = buffer[pos]!;
            pos++;

            let r = value2 & 0xf8;
            let g = ((value1 >> 3) | (value2 << 5)) & 0xfc;
            let b = (value1 << 3) & 0xf8;

            // Expand 5/6-bit to full 8-bit range via bit replication (0-248 → 0-255)
            r |= r >> 5;
            g |= g >> 6;
            b |= b >> 5;

            imgData[j++] = r;
            imgData[j++] = g;
            imgData[j++] = b;
            imgData[j++] = 255; // alpha
        }
    }

    public getImageData(): ImageData {
        const img = new ImageData(this.width, this.height);
        const imgData = img.data;

        const buffer = this.data.getBuffer();
        const length = this.getDataSize();
        const pos = this.dataOffset;

        this.getImageData16Bit(buffer, imgData, pos, length);

        return img;
    }

    public getRaw16BitImage(): Uint16Array {
        const buffer = this.data.getBuffer();
        const length = this.getDataSize();
        const pos = this.dataOffset;

        if (pos % 2 === 0) {
            return new Uint16Array(buffer.buffer, pos, length / 2);
        }

        // Offset is not 2-byte aligned — copy into an aligned buffer
        const aligned = new Uint8Array(length);
        aligned.set(buffer.subarray(pos, pos + length));
        return new Uint16Array(aligned.buffer);
    }

    constructor(reader: BinaryReader, width: number, rowCount: number) {
        this.data = reader;
        this.rowCount = rowCount;
        this.width = width;
        this.height = rowCount * width;

        Object.seal(this);
    }

    public getDataSize(): number {
        return this.width * this.height * 2;
    }

    public toString(): string {
        return (
            ImageType[this.imageType] +
            ' - ' +
            'size: (' +
            this.width +
            ' x' +
            this.height +
            ') ' +
            'rows: ' +
            this.rowCount +
            '; ' +
            'data offset ' +
            this.dataOffset +
            '; ' +
            'data size ' +
            this.getDataSize() +
            ' ' +
            'flags: ' +
            this.flag1 +
            '    ' +
            this.flag2
        );
    }
}
