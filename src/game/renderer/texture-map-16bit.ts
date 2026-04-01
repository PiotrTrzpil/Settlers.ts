import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';

export class TextureMapImage {
    private imgData: Uint16Array;
    private imgWidthHeight: number;
    /** the x-position in the texture this image is placed */
    public x: number;
    /** the x-position in the texture this image is placed */
    public y: number;
    public width: number;
    public height: number;

    constructor(imgData: Uint16Array, imgWidthHeight: number, x: number, y: number, width: number, height: number) {
        this.imgData = imgData;
        this.imgWidthHeight = imgWidthHeight;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    public copyFrom(srcImg: GfxImage16Bit, srcX: number, srcY: number, width: number, height: number, destX = 0): void {
        const img = srcImg.getRaw16BitImage();

        for (let y = 0; y < height; y++) {
            const srcOffset = (srcY + y) * srcImg.width + srcX;
            const destOffset = (this.y + y) * this.imgWidthHeight + this.x + destX;
            for (let x = 0; x < width; x++) {
                this.imgData[destOffset + x] = img[srcOffset + x]!;
            }
        }
    }
}

class Slot {
    public x = 0;
    public y: number;
    public height: number;
    public width: number;

    /** return the width that is left in the slot */
    public get leftSize() {
        return this.width - this.x;
    }

    /** return the bottom position of the slot */
    public get bottom() {
        return this.y + this.height;
    }

    constructor(y: number, width: number, height: number) {
        this.y = y;
        this.width = width;
        this.height = height;
    }

    /** reserve some width of the slot */
    public increase(width: number) {
        this.x += width;
    }
}

/**
 * RGB565 palette of 12 bright, distinct colors used as procedural fallback
 * when the real texture file (2.gh6) is unavailable.
 * Format: (R5 << 11) | (G6 << 5) | B5
 */
const PROCEDURAL_PALETTE: readonly number[] = [
    0x001f, // bright blue    (water)
    0xfe60, // sandy yellow   (beach)
    0x07e0, // bright green   (grass)
    0x0400, // dark green     (grass dark)
    0xce40, // olive          (grass dry)
    0xfd20, // orange         (desert)
    0x8410, // gray           (rock)
    0x4a49, // dark teal      (swamp)
    0xa145, // brown          (mud)
    0xffff, // white          (snow)
    0xdda0, // tan            (dusty way)
    0x632c, // dark gray      (rocky way)
];

/**
 * A big texture buffer where images can write to
 **/
export class TextureMap16Bit extends ShaderTexture {
    private static log = new LogHandler('TextureMap');
    private imgData: Uint16Array;
    /** the size of the texture map. width and height are equeal! */
    public imgWidthHeight: number;
    /*
     * every slot is 256 pixle height so y=index*256
     * the value of slotPosX is the position in x
     */
    private slots: Slot[] = [];
    /** Tracks all reserved block regions for per-block transparency patching */
    private reservedBlocks: { x: number; y: number; w: number; h: number }[] = [];

    constructor(widthHeight: number, textureIndex: number) {
        super(textureIndex);

        this.imgWidthHeight = widthHeight;
        this.imgData = new Uint16Array(widthHeight * widthHeight);

        const numberOfPixles = widthHeight * widthHeight;
        for (let i = 0; i < numberOfPixles; i++) {
            this.imgData[i] = 0xf81f;
        }

        // reserve the 0/0 position as null slot
        const nullSlot = new Slot(0, this.imgWidthHeight, 256);
        this.slots.push(nullSlot);
        nullSlot.increase(256);

        Object.seal(this);
    }

    /** declare an image of the given size within the texture map */
    public reserve(width: number, height: number): TextureMapImage | null {
        // find existing slot that can be used for the image
        let slot = this.slots.find(s => s.height === height && s.leftSize >= width);
        if (slot == null) {
            // create new slot
            // eslint-disable-next-line no-restricted-syntax -- slots may be empty on first allocation; 0 (top of texture) is correct starting Y
            const freeY = this.slots[this.slots.length - 1]?.bottom ?? 0;
            slot = new Slot(freeY, this.imgWidthHeight, height);
            this.slots.push(slot);
        }

        const newImg = new TextureMapImage(this.imgData, this.imgWidthHeight, slot.x, slot.y, width, height);
        this.reservedBlocks.push({ x: slot.x, y: slot.y, w: width, h: height });

        slot.increase(width);

        return newImg;
    }

    /**
     * Fill the atlas with procedural colors so terrain types are visually
     * distinguishable when the real texture file (2.gh6) is unavailable.
     * Each 256x256 block row gets a unique color from the palette.
     */
    public fillProceduralColors(): void {
        const size = this.imgWidthHeight;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const bx = Math.floor(x / 256);
                const by = Math.floor(y / 256);
                const idx = (bx + by * Math.ceil(size / 256)) % PROCEDURAL_PALETTE.length;
                this.imgData[y * size + x] = PROCEDURAL_PALETTE[idx]!;
            }
        }
    }

    /**
     * Replace magenta transparency-key pixels (0xF81F) via per-block iterative
     * dilation. The original Settlers 4 texture uses magenta as a color key in
     * hexagonal transition blocks; the original engine composites these over
     * the base terrain. Our single-pass renderer patches them by spreading
     * non-magenta pixels inward within each atlas block, preventing color
     * bleeding across block boundaries.
     */
    public patchTransparencyKey(): void {
        for (const block of this.reservedBlocks) {
            this.dilateBlock(block.x, block.y, block.x + block.w, block.y + block.h);
        }
    }

    /** Iteratively replace 0xF81F pixels within a rectangular region by
     *  spreading the nearest non-magenta 4-connected neighbor inward. */
    private dilateBlock(bx0: number, by0: number, bx1: number, by1: number): void {
        const MAGENTA = 0xf81f;
        const data = this.imgData;

        let queue = this.findBorderMagenta(bx0, by0, bx1, by1);

        for (let pass = 0; pass < 64 && queue.length > 0; pass++) {
            const next: number[] = [];
            for (const idx of queue) {
                if (data[idx] !== MAGENTA) {
                    continue;
                }
                const replaced = this.replaceFromNeighbor(idx, bx0, by0, bx1, by1);
                if (replaced) {
                    this.enqueueMagentaNeighbors(idx, bx0, by0, bx1, by1, next);
                }
            }
            queue = next;
        }
    }

    /** Find magenta pixels that have at least one non-magenta 4-neighbor within bounds. */
    private findBorderMagenta(bx0: number, by0: number, bx1: number, by1: number): number[] {
        const MAGENTA = 0xf81f;
        const size = this.imgWidthHeight;
        const data = this.imgData;
        const queue: number[] = [];

        for (let y = by0; y < by1; y++) {
            for (let x = bx0; x < bx1; x++) {
                const idx = y * size + x;
                if (data[idx] !== MAGENTA) {
                    continue;
                }
                if (this.hasNonMagentaNeighbor(x, y, bx0, by0, bx1, by1)) {
                    queue.push(idx);
                }
            }
        }
        return queue;
    }

    private hasNonMagentaNeighbor(x: number, y: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
        const MAGENTA = 0xf81f;
        const size = this.imgWidthHeight;
        const data = this.imgData;
        const DX = [1, -1, 0, 0];
        const DY = [0, 0, 1, -1];

        for (let d = 0; d < 4; d++) {
            const nx = x + DX[d]!;
            const ny = y + DY[d]!;
            if (nx >= bx0 && nx < bx1 && ny >= by0 && ny < by1 && data[ny * size + nx] !== MAGENTA) {
                return true;
            }
        }
        return false;
    }

    /** Replace a magenta pixel with the first non-magenta 4-neighbor. Returns true if replaced. */
    private replaceFromNeighbor(idx: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
        const MAGENTA = 0xf81f;
        const size = this.imgWidthHeight;
        const data = this.imgData;
        const x = idx % size;
        const y = (idx - x) / size;
        const DX = [1, -1, 0, 0];
        const DY = [0, 0, 1, -1];

        for (let d = 0; d < 4; d++) {
            const nx = x + DX[d]!;
            const ny = y + DY[d]!;
            if (nx < bx0 || nx >= bx1 || ny < by0 || ny >= by1) {
                continue;
            }
            const nv = data[ny * size + nx]!;
            if (nv !== MAGENTA) {
                data[idx] = nv;
                return true;
            }
        }
        return false;
    }

    /** Add any magenta 4-neighbors of pixel at idx to the queue. */
    private enqueueMagentaNeighbors(
        idx: number,
        bx0: number,
        by0: number,
        bx1: number,
        by1: number,
        queue: number[]
    ): void {
        const MAGENTA = 0xf81f;
        const size = this.imgWidthHeight;
        const data = this.imgData;
        const x = idx % size;
        const y = (idx - x) / size;
        const DX = [1, -1, 0, 0];
        const DY = [0, 0, 1, -1];

        for (let d = 0; d < 4; d++) {
            const nx = x + DX[d]!;
            const ny = y + DY[d]!;
            if (nx >= bx0 && nx < bx1 && ny >= by0 && ny < by1 && data[ny * size + nx] === MAGENTA) {
                queue.push(ny * size + nx);
            }
        }
    }

    public load(gl: WebGL2RenderingContext): void {
        const level = 0;
        const internalFormat = gl.RGB;
        const width = this.imgWidthHeight;
        const height = this.imgWidthHeight;
        const border = 0;
        const format = gl.RGB;
        const type = gl.UNSIGNED_SHORT_5_6_5;

        super.bind(gl);

        // UNPACK_ALIGNMENT must be set before texImage2D so that WebGL
        // interprets the source data rows with the correct stride.
        // 16-bit (2 byte) texels require alignment of 2.
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);

        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, format, type, this.imgData);
    }
}
