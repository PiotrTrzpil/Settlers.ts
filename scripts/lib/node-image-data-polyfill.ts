/**
 * Polyfill `globalThis.ImageData` for Node.js scripts that decode GFX sprites.
 * Import this module (side-effect only) before any code that uses `ImageData`.
 *
 * Browser environments already have ImageData — the polyfill is a no-op there.
 */
if (typeof globalThis.ImageData === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ImageData = class ImageData {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;
        readonly colorSpace: string = 'srgb';

        constructor(
            dataOrWidth: Uint8ClampedArray | number,
            widthOrHeight: number,
            heightOrSettings?: number | { colorSpace?: string }
        ) {
            if (typeof dataOrWidth === 'number') {
                // new ImageData(width, height)
                this.width = dataOrWidth;
                this.height = widthOrHeight;
                this.data = new Uint8ClampedArray(this.width * this.height * 4);
            } else {
                // new ImageData(data, width, height?)
                this.data = dataOrWidth;
                this.width = widthOrHeight;
                this.height = (heightOrSettings as number) ?? dataOrWidth.length / 4 / widthOrHeight;
            }
        }
    };
}
