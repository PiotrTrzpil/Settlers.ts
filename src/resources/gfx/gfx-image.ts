import { BinaryReader } from '../file/binary-reader';
import { IGfxImage } from './igfx-image';
import { ImageType } from './image-type';
import { Palette } from './palette';

/** Parameters needed for worker-based decoding */
export interface GfxDecodeParams {
    buffer: ArrayBuffer;
    offset: number;
    width: number;
    height: number;
    imgType: number;
    paletteData: Uint32Array;
    paletteOffset: number;
}

export class GfxImage implements IGfxImage {
    public imageType = ImageType.ImageGfx;

    /** start of image data */
    public dataOffset = 0;

    public headType = false;

    public imgType = 0;
    /** width of the image */
    public width = 0;
    /** height of the image */
    public height = 0;
    /** left (x) offset to display the image */
    public left = 0;
    /** top (y) offset to display the image */
    public top = 0;

    public flag1 = 0;
    public flag2 = 0;

    private data: BinaryReader;

    private palette: Palette;
    private paletteOffset: number;

    public getDataSize(): number {
        return 0;
    }

    private getImageDataWithRunLengthEncoding(buffer: Uint8Array, imgData: Uint32Array, pos: number, length: number) {
        const paletteOffset = this.paletteOffset;
        const palette = this.palette;
        const bufferLength = buffer.length;

        let j = 0;
        while (j < length && pos < bufferLength) {
            const value = buffer[pos];
            pos++;

            if (value <= 1) {
                // Bounds check before reading count byte
                if (pos >= bufferLength) break;
                const count = buffer[pos];
                pos++;

                // Palette index 0 = transparent, index 1 = shadow/semi-transparent
                const color = value === 0 ? 0x00000000 : 0x40000000;
                for (let i = 0; (i < count) && (j < length); i++) {
                    imgData[j++] = color;
                }
            } else {
                const color = palette.getColor(paletteOffset + value);
                imgData[j++] = color;
            }
        }
    }

    private getImageDataWithNoEncoding(buffer: Uint8Array, imgData: Uint32Array, pos: number, length: number) {
        const paletteOffset = this.paletteOffset;
        const palette = this.palette;
        const bufferLength = buffer.length;

        let j = 0;
        while (j < length && pos < bufferLength) {
            const value = buffer[pos];
            pos++;

            imgData[j++] = palette.getColor(paletteOffset + value);
        }
    }

    public getImageData(): ImageData {
        const img = new ImageData(this.width, this.height);
        const imgData = new Uint32Array(img.data.buffer);

        const buffer = this.data.getBuffer();
        const length = this.width * this.height; // Pixel count (Uint32Array elements)
        const pos = this.dataOffset;

        if (this.imgType !== 32) {
            this.getImageDataWithRunLengthEncoding(buffer, imgData, pos, length);
        } else {
            this.getImageDataWithNoEncoding(buffer, imgData, pos, length);
        }

        return img;
    }

    constructor(reader: BinaryReader, palette: Palette, paletteOffset: number) {
        this.data = reader;
        this.palette = palette;
        this.paletteOffset = paletteOffset;

        Object.seal(this);
    }

    public toString(): string {
        return ImageType[this.imageType] + ' - ' +
                    'size: (' + this.width + ' x' + this.height + ') ' +
                    'pos (' + this.left + ', ' + this.top + ') ' +
                    'type ' + this.imgType + '; ' +
                    'data offset ' + this.dataOffset + '; ' +
                    'flags: ' + this.flag1 + ' / ' + this.flag2 + ' ' +
                    'header Type: ' + this.headType;
    }

    /**
     * Get palette indices (Uint16Array) for this sprite.
     * Used for synchronous indexed decoding (fallback when workers unavailable).
     * Index 0 = transparent, 1 = shadow, others = paletteOffset + value.
     * paletteBaseOffset is added per-sprite in the shader to avoid Uint16 overflow.
     *
     * @param _paletteBaseOffset Deprecated, kept for API compatibility but ignored
     */
    public getIndexData(_paletteBaseOffset: number): Uint16Array {
        const length = this.width * this.height;
        const indices = new Uint16Array(length);
        const buffer = this.data.getBuffer();
        const bufferLength = buffer.length;
        let pos = this.dataOffset;
        const pOff = this.paletteOffset;

        if (this.imgType !== 32) {
            // RLE encoding
            let j = 0;
            while (j < length && pos < bufferLength) {
                const value = buffer[pos++];
                if (value <= 1) {
                    if (pos >= bufferLength) break;
                    const count = buffer[pos++];
                    for (let i = 0; i < count && j < length; i++) {
                        indices[j++] = value; // 0 = transparent, 1 = shadow
                    }
                } else {
                    // Relative index: paletteOffset + value
                    // paletteBaseOffset will be added in shader
                    indices[j++] = pOff + value;
                }
            }
        } else {
            // No encoding
            for (let j = 0; j < length && pos < bufferLength; j++) {
                const value = buffer[pos++];
                // paletteBaseOffset added in shader
                indices[j] = pOff + value;
            }
        }

        return indices;
    }

    /** Get parameters for worker-based async decoding */
    public getDecodeParams(): GfxDecodeParams {
        return {
            buffer: this.data.getBuffer().buffer,
            offset: this.dataOffset,
            width: this.width,
            height: this.height,
            imgType: this.imgType,
            paletteData: this.palette.getData(),
            paletteOffset: this.paletteOffset,
        };
    }
}
