/**
 * Cross-platform ImageData alternative
 * Works in both Node.js and browser environments without Canvas dependencies
 */
export class RawImageData {
    public readonly width: number;
    public readonly height: number;
    public readonly data: Uint8ClampedArray;

    constructor(width: number, height: number, data?: Uint8ClampedArray) {
        this.width = width;
        this.height = height;
        this.data = data ?? new Uint8ClampedArray(width * height * 4);
    }

    /** Get pixel color at position (RGBA) */
    public getPixel(x: number, y: number): [number, number, number, number] {
        const offset = (y * this.width + x) * 4;
        return [
            this.data[offset],
            this.data[offset + 1],
            this.data[offset + 2],
            this.data[offset + 3]
        ];
    }

    /** Set pixel color at position (RGBA) */
    public setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
        const offset = (y * this.width + x) * 4;
        this.data[offset] = r;
        this.data[offset + 1] = g;
        this.data[offset + 2] = b;
        this.data[offset + 3] = a;
    }

    /** Create from browser ImageData */
    public static fromImageData(imageData: ImageData): RawImageData {
        return new RawImageData(
            imageData.width,
            imageData.height,
            new Uint8ClampedArray(imageData.data)
        );
    }

    /** Convert to browser ImageData if available */
    public toImageData(): ImageData {
        if (typeof ImageData !== 'undefined') {
            return new ImageData(this.data, this.width, this.height);
        }
        throw new Error('ImageData is not available in this environment');
    }

    /** Create from Uint32Array (RGBA as packed 32-bit values) */
    public static fromUint32Array(
        width: number,
        height: number,
        data: Uint32Array
    ): RawImageData {
        const rawData = new Uint8ClampedArray(data.buffer);
        return new RawImageData(width, height, rawData);
    }

    /** Get as Uint32Array view (for fast pixel manipulation) */
    public asUint32Array(): Uint32Array {
        return new Uint32Array(this.data.buffer);
    }
}
