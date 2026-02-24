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
    private _paletteOffset: number;

    public getDataSize(): number {
        return 0;
    }

    private getImageDataWithRunLengthEncoding(buffer: Uint8Array, imgData: Uint32Array, pos: number, length: number) {
        const paletteOffset = this._paletteOffset;
        const palette = this.palette;
        const bufferLength = buffer.length;

        let j = 0;
        while (j < length && pos < bufferLength) {
            const value = buffer[pos]!;
            pos++;

            if (value <= 1) {
                // Bounds check before reading count byte
                if (pos >= bufferLength) break;
                const count = buffer[pos]!;
                pos++;

                // Palette index 0 = transparent, index 1 = shadow/semi-transparent
                const color = value === 0 ? 0x00000000 : 0x40000000;
                for (let i = 0; i < count && j < length; i++) {
                    imgData[j++] = color;
                }
            } else {
                const color = palette.getColor(paletteOffset + value);
                imgData[j++] = color;
            }
        }
    }

    private getImageDataWithNoEncoding(buffer: Uint8Array, imgData: Uint32Array, pos: number, length: number) {
        const paletteOffset = this._paletteOffset;
        const palette = this.palette;
        const bufferLength = buffer.length;

        let j = 0;
        while (j < length && pos < bufferLength) {
            const value = buffer[pos]!;
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

    /** Palette offset within the file's palette data (for per-sprite palette base) */
    public get paletteOffset(): number {
        return this._paletteOffset;
    }

    constructor(reader: BinaryReader, palette: Palette, paletteOffset: number) {
        this.data = reader;
        this.palette = palette;
        this._paletteOffset = paletteOffset;

        Object.seal(this);
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
            'pos (' +
            this.left +
            ', ' +
            this.top +
            ') ' +
            'type ' +
            this.imgType +
            '; ' +
            'data offset ' +
            this.dataOffset +
            '; ' +
            'flags: ' +
            this.flag1 +
            ' / ' +
            this.flag2 +
            ' ' +
            'header Type: ' +
            this.headType
        );
    }

    /**
     * Get palette indices (Uint16Array) for this sprite.
     * Used for synchronous indexed decoding (fallback when workers unavailable).
     * Index 0 = transparent, 1 = shadow, others = raw value + 2.
     * The +2 offset prevents raw values 0/1 from colliding with transparent/shadow.
     * paletteOffset and paletteBaseOffset are added per-sprite in the shader via v_paletteBase.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- RLE index decode loop with multiple image type branches
    public getIndexData(): Uint16Array {
        const length = this.width * this.height;
        const indices = new Uint16Array(length);
        const buffer = this.data.getBuffer();
        const bufferLength = buffer.length;
        let pos = this.dataOffset;

        if (this.imgType !== 32) {
            // RLE encoding
            let j = 0;
            while (j < length && pos < bufferLength) {
                const value = buffer[pos++]!;
                if (value <= 1) {
                    if (pos >= bufferLength) break;
                    const count = buffer[pos++]!;
                    for (let i = 0; i < count && j < length; i++) {
                        indices[j++] = value; // 0 = transparent, 1 = shadow
                    }
                } else {
                    // Store raw value + 2 to avoid collision with special indices 0/1.
                    // paletteOffset + paletteBaseOffset added in shader via v_paletteBase.
                    indices[j++] = value + 2;
                }
            }
        } else {
            // No encoding — all bytes are palette indices
            for (let j = 0; j < length && pos < bufferLength; j++) {
                const value = buffer[pos++]!;
                // +2 offset: raw value 0/1 must not be treated as transparent/shadow
                indices[j] = value + 2;
            }
        }

        return indices;
    }

    /** Get parameters for worker-based async decoding */
    public getDecodeParams(): GfxDecodeParams {
        return {
            buffer: this.data.getBuffer().buffer as ArrayBuffer,
            offset: this.dataOffset,
            width: this.width,
            height: this.height,
            imgType: this.imgType,
            paletteData: this.palette.getData(),
            paletteOffset: this._paletteOffset,
        };
    }
}
