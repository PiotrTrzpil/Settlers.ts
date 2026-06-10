import { LogHandler } from '@/utilities/log-handler';

/**
 * Class to provide a read pointer and read functions to a binary Buffer.
 *
 * All reads happen at the cursor and advance it; position explicitly with
 * setOffset(). Out-of-data reads log an error and return 0 / '' without
 * advancing the cursor.
 */
export class BinaryReader {
    private static log = new LogHandler('BinaryReader');
    public filename: string;
    protected readonly data: Uint8Array;
    protected readonly hiddenOffset: number;
    public readonly length: number;
    public pos: number;

    constructor(
        dataArray?: BinaryReader | Uint8Array | ArrayBuffer,
        offset = 0,
        length: number | null = null,
        filename: string | null = null
    ) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison -- JS callers
        if (offset === null) {
            offset = 0;
        }

        let dataLength: number;
        let srcHiddenOffset = 0;

        if (dataArray == null) {
            this.data = new Uint8Array(0);
            dataLength = 0;
        } else if (dataArray instanceof BinaryReader) {
            // - if dataArray is BinaryReader use there data
            this.data = dataArray.data;
            dataLength = dataArray.length;
            srcHiddenOffset = dataArray.hiddenOffset;

            if (!filename) {
                filename = dataArray.filename;
            }
        } else if (dataArray instanceof Uint8Array) {
            this.data = dataArray;
            dataLength = dataArray.byteLength;
        } else if (dataArray instanceof ArrayBuffer) {
            this.data = new Uint8Array(dataArray);
            dataLength = dataArray.byteLength;
        } else {
            this.data = dataArray;
            dataLength = this.data.length;
            BinaryReader.log.error('BinaryReader from unknown: ' + dataArray + '; size:' + dataLength);
        }

        if (length == null) {
            length = dataLength - offset;
        }

        this.hiddenOffset = offset + srcHiddenOffset;
        this.length = length;
        this.pos = this.hiddenOffset;

        this.filename = filename || '[Unknown]';

        Object.seal(this);
    }

    /** return the selected data as new Uint8Array */
    public getBuffer(offset = 0, length = -1): Uint8Array {
        const l = length >= 0 ? Math.min(this.length, length) : this.length;
        const o = this.hiddenOffset + offset;

        if (l !== this.data.length || o > 0) {
            return new Uint8Array(this.data.slice(o, o + l));
        } else {
            return this.data;
        }
    }

    /**
     * Validate a read of `count` bytes at the cursor and advance the cursor.
     * Returns the read start position, or -1 (with an error logged) when out of data.
     */
    private take(count: number): number {
        const start = this.pos;
        if (start < 0 || start + count > this.data.length) {
            BinaryReader.log.error(
                'read out of data: ' + this.filename + ' - size: ' + this.data.length + ' @ ' + start
            );
            return -1;
        }
        this.pos = start + count;
        return start;
    }

    /** Read one Byte from stream */
    public readByte(): number {
        const p = this.take(1);
        return p < 0 ? 0 : this.data[p]!;
    }

    /** Read one DWord (4 Byte) from stream (little-endian) */
    public readInt(): number {
        const p = this.take(4);
        if (p < 0) {
            return 0;
        }
        return this.data[p]! | (this.data[p + 1]! << 8) | (this.data[p + 2]! << 16) | (this.data[p + 3]! << 24);
    }

    /** Read `length` bytes from stream as a big-endian integer */
    public readIntBE(length = 4): number {
        const p = this.take(length);
        if (p < 0) {
            return 0;
        }
        let v = 0;
        for (let i = 0; i < length; i++) {
            v = (v << 8) | this.data[p + i]!;
        }
        return v;
    }

    /** Read one Word (2 Byte) from stream (little-endian) */
    public readWord(): number {
        const p = this.take(2);
        return p < 0 ? 0 : this.data[p]! | (this.data[p + 1]! << 8);
    }

    /** Read one Word (2 Byte) from stream (big-endian) */
    public readWordBE(): number {
        const p = this.take(2);
        return p < 0 ? 0 : (this.data[p]! << 8) | this.data[p + 1]!;
    }

    /** Read a zero-terminated String */
    public readNullString(): string {
        let result = '';

        while (!this.eof()) {
            const v: number = this.data[this.pos]!;
            this.pos++;
            if (v === 0) {
                return result;
            }
            result += String.fromCharCode(v);
        }

        return '';
    }

    /** Read a String of `length` bytes (to the end of the data when omitted) */
    public readString(length: number | null = null): string {
        if (length === null) {
            length = this.length - this.getOffset();
        }

        const p = this.take(length);
        if (p < 0) {
            return '';
        }

        let result = '';
        for (let i = 0; i < length; i++) {
            result += String.fromCharCode(this.data[p + i]!);
        }
        return result;
    }

    /** Read `length` bytes as a hex String (to the end of the data when omitted) */
    public readStringHex(length: number | null = null, spacer = ''): string {
        if (length === null) {
            length = this.length - this.getOffset();
        }

        const p = this.take(length);
        if (p < 0) {
            return '';
        }

        let result = '';
        for (let i = 0; i < length; i++) {
            result += ('0' + this.data[p + i]!.toString(16)).slice(-2) + spacer;
        }
        return result;
    }

    /** return the current curser position */
    public getOffset(): number {
        return this.pos - this.hiddenOffset;
    }

    /** set the current curser position */
    public setOffset(newPos: number): void {
        this.pos = newPos + this.hiddenOffset;
    }

    /** return true if the curser position is out of data */
    public eof(): boolean {
        const pos = this.pos - this.hiddenOffset;
        return pos >= this.length || pos < 0;
    }

    /** return a String of the data */
    public readAll(): string {
        this.setOffset(0);
        return this.readString(this.length);
    }
}
