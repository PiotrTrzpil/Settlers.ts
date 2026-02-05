import { RawImageData } from './raw-image-data';

/**
 * Pure JavaScript PNG encoder
 * Works in both Node.js and browser environments
 * Uses deflate compression via platform APIs or fallback to stored blocks
 */

// CRC32 lookup table for PNG chunks
const CRC32_TABLE = new Uint32Array(256);
(function initCRC32Table() {
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            if (c & 1) {
                c = 0xedb88320 ^ (c >>> 1);
            } else {
                c = c >>> 1;
            }
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
    let a = 1;
    let b = 0;
    const MOD = 65521;

    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % MOD;
        b = (b + a) % MOD;
    }

    return (b << 16) | a;
}

/**
 * Create a minimal zlib wrapper with stored (uncompressed) deflate blocks
 * This is the simplest possible deflate stream that's still valid
 */
function createZlibStored(data: Uint8Array): Uint8Array {
    // Max block size for stored blocks is 65535 bytes
    const MAX_BLOCK = 65535;
    const numBlocks = Math.ceil(data.length / MAX_BLOCK);

    // zlib header (2 bytes) + blocks (5 bytes header + data each) + adler32 (4 bytes)
    const outputSize = 2 + numBlocks * 5 + data.length + 4;
    const output = new Uint8Array(outputSize);
    let pos = 0;

    // zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 (no dict, check bits)
    output[pos++] = 0x78;
    output[pos++] = 0x01;

    // Write stored blocks
    let remaining = data.length;
    let offset = 0;

    while (remaining > 0) {
        const blockSize = Math.min(remaining, MAX_BLOCK);
        const isLast = remaining <= MAX_BLOCK;

        // Block header: BFINAL (1 if last) | BTYPE=00 (stored)
        output[pos++] = isLast ? 0x01 : 0x00;

        // LEN (little-endian)
        output[pos++] = blockSize & 0xff;
        output[pos++] = (blockSize >> 8) & 0xff;

        // NLEN (one's complement of LEN)
        output[pos++] = (~blockSize) & 0xff;
        output[pos++] = ((~blockSize) >> 8) & 0xff;

        // Copy data
        output.set(data.subarray(offset, offset + blockSize), pos);
        pos += blockSize;

        offset += blockSize;
        remaining -= blockSize;
    }

    // Adler-32 checksum (big-endian)
    const checksum = adler32(data);
    output[pos++] = (checksum >> 24) & 0xff;
    output[pos++] = (checksum >> 16) & 0xff;
    output[pos++] = (checksum >> 8) & 0xff;
    output[pos++] = checksum & 0xff;

    return output;
}

/**
 * Try to use platform deflate for better compression
 */
async function deflateWithPlatform(data: Uint8Array): Promise<Uint8Array> {
    // Try Node.js zlib first
    if (typeof process !== 'undefined' && process.versions?.node) {
        try {
            const zlib = await import('zlib');
            return new Promise((resolve, reject) => {
                zlib.deflate(data, { level: 6 }, (err, result) => {
                    if (err) reject(err);
                    else resolve(new Uint8Array(result));
                });
            });
        } catch {
            // Fall through to other methods
        }
    }

    // Try browser CompressionStream API
    if (typeof CompressionStream !== 'undefined') {
        try {
            const stream = new CompressionStream('deflate');
            const writer = stream.writable.getWriter();
            writer.write(data);
            writer.close();

            const chunks: Uint8Array[] = [];
            const reader = stream.readable.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) chunks.push(value);
            }

            // Combine chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            return result;
        } catch {
            // Fall through to fallback
        }
    }

    // Fallback: use stored blocks (no compression)
    return createZlibStored(data);
}

/**
 * Synchronous fallback - uses stored blocks only
 */
function deflateSync(data: Uint8Array): Uint8Array {
    return createZlibStored(data);
}

function writeUint32BE(arr: Uint8Array, value: number, offset: number): void {
    arr[offset] = (value >> 24) & 0xff;
    arr[offset + 1] = (value >> 16) & 0xff;
    arr[offset + 2] = (value >> 8) & 0xff;
    arr[offset + 3] = value & 0xff;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(4 + 4 + data.length + 4);

    // Length (big-endian)
    writeUint32BE(chunk, data.length, 0);

    // Type (4 ASCII characters)
    for (let i = 0; i < 4; i++) {
        chunk[4 + i] = type.charCodeAt(i);
    }

    // Data
    chunk.set(data, 8);

    // CRC32 (over type + data)
    const crcData = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) {
        crcData[i] = type.charCodeAt(i);
    }
    crcData.set(data, 4);
    writeUint32BE(chunk, crc32(crcData), 8 + data.length);

    return chunk;
}

function createIHDR(width: number, height: number): Uint8Array {
    const data = new Uint8Array(13);
    writeUint32BE(data, width, 0);
    writeUint32BE(data, height, 4);
    data[8] = 8;   // bit depth
    data[9] = 6;   // color type: RGBA
    data[10] = 0;  // compression method
    data[11] = 0;  // filter method
    data[12] = 0;  // interlace method
    return createChunk('IHDR', data);
}

function createIDAT(compressedData: Uint8Array): Uint8Array {
    return createChunk('IDAT', compressedData);
}

function createIEND(): Uint8Array {
    return createChunk('IEND', new Uint8Array(0));
}

/**
 * Encode raw image data to PNG format
 * @param image RawImageData or ImageData-like object with width, height, and data properties
 * @returns PNG file as Uint8Array
 */
export function encodePNGSync(image: RawImageData | ImageData): Uint8Array {
    const { width, height, data } = image;

    // Create filtered scanlines (filter byte + RGBA data per row)
    const rowSize = 1 + width * 4;
    const filteredData = new Uint8Array(height * rowSize);

    for (let y = 0; y < height; y++) {
        const rowStart = y * rowSize;
        filteredData[rowStart] = 0; // Filter type: None

        const srcStart = y * width * 4;
        filteredData.set(
            data.subarray(srcStart, srcStart + width * 4),
            rowStart + 1
        );
    }

    // Compress filtered data
    const compressedData = deflateSync(filteredData);

    // Build PNG file
    const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = createIHDR(width, height);
    const idat = createIDAT(compressedData);
    const iend = createIEND();

    const pngSize = PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length;
    const png = new Uint8Array(pngSize);

    let offset = 0;
    png.set(PNG_SIGNATURE, offset);
    offset += PNG_SIGNATURE.length;
    png.set(ihdr, offset);
    offset += ihdr.length;
    png.set(idat, offset);
    offset += idat.length;
    png.set(iend, offset);

    return png;
}

/**
 * Encode raw image data to PNG format with async compression (better compression)
 * @param image RawImageData or ImageData-like object
 * @returns Promise<Uint8Array> PNG file
 */
export async function encodePNG(image: RawImageData | ImageData): Promise<Uint8Array> {
    const { width, height, data } = image;

    // Create filtered scanlines
    const rowSize = 1 + width * 4;
    const filteredData = new Uint8Array(height * rowSize);

    for (let y = 0; y < height; y++) {
        const rowStart = y * rowSize;
        filteredData[rowStart] = 0; // Filter type: None

        const srcStart = y * width * 4;
        filteredData.set(
            data.subarray(srcStart, srcStart + width * 4),
            rowStart + 1
        );
    }

    // Compress filtered data (async for better compression)
    const compressedData = await deflateWithPlatform(filteredData);

    // Build PNG file
    const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = createIHDR(width, height);
    const idat = createIDAT(compressedData);
    const iend = createIEND();

    const pngSize = PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length;
    const png = new Uint8Array(pngSize);

    let offset = 0;
    png.set(PNG_SIGNATURE, offset);
    offset += PNG_SIGNATURE.length;
    png.set(ihdr, offset);
    offset += ihdr.length;
    png.set(idat, offset);
    offset += idat.length;
    png.set(iend, offset);

    return png;
}

export class PngEncoder {
    /**
     * Encode image to PNG bytes (sync version, no compression)
     */
    public static encodeSync(image: RawImageData | ImageData): Uint8Array {
        return encodePNGSync(image);
    }

    /**
     * Encode image to PNG bytes (async version, with compression)
     */
    public static async encode(image: RawImageData | ImageData): Promise<Uint8Array> {
        return encodePNG(image);
    }
}
