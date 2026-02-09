import { LogHandler } from './log-handler';

/** Class to provide a read pointer and read functions to a binary Buffer */
export class BinaryReader {
    private static log = new LogHandler('BinaryReader');
    public filename: string;
    protected readonly data: Uint8Array;
    protected readonly hiddenOffset: number;
    public readonly length: number;
    public pos: number;

    constructor(
        dataArray?: BinaryReader | Uint8Array | ArrayBuffer,
        offset = 0, length: number | null = null, filename: string | null = null
    ) {
        if (offset === null) {
            offset = 0;
        }

        let dataLength = 0;
        let srcHiddenOffset = 0;

        if (dataArray == null) {
            this.data = new Uint8Array(0);
            dataLength = 0;
        } else if (dataArray instanceof BinaryReader) {
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

        this.filename = (filename) || '[Unknown]';

        Object.seal(this);
    }

    public getBuffer(offset = 0, length = -1): Uint8Array {
        const l = (length >= 0) ? Math.min(this.length, length) : this.length;
        const o = this.hiddenOffset + offset;

        if ((l !== this.data.length) || (o > 0)) {
            return new Uint8Array(this.data.slice(o, o + l));
        } else {
            return this.data;
        }
    }

    public readByte(offset: number | null = null): number {
        if (offset !== null) {
            this.pos = (offset + this.hiddenOffset);
        }

        if ((this.pos < 0) || (this.pos > this.data.length)) {
            BinaryReader.log.error('read out of data: ' + this.filename + ' - size: ' + this.data.length + ' @ ' + this.pos);
            return 0;
        }

        const v = this.data[this.pos];
        this.pos++;

        return v;
    }

    public readInt(offset: number | null = null, length = 4): number {
        if (offset === null) {
            offset = this.pos;
        }

        if (length === 4) {
            const v = (this.data[offset] << 24) | (this.data[offset + 1] << 16) | (this.data[offset + 2] << 8) | (this.data[offset + 3]);
            this.pos = offset + 4;
            return v;
        }

        let v = 0;
        for (let i = length; i > 0; i--) {
            v = (v << 8) | this.data[offset];
            offset++;
        }

        this.pos = offset;

        return v;
    }

    public readIntBE(offset: number | null = null): number {
        if (offset == null) {
            offset = this.pos;
        }

        if ((this.pos < 0) || (this.pos + 4 > this.data.length)) {
            BinaryReader.log.error('read out of data: ' + this.filename + ' - size: ' + this.data.length + ' @ ' + this.pos);
            return 0;
        }

        this.pos = offset + 4;

        return (this.data[offset]) |
            (this.data[offset + 1] << 8) |
            (this.data[offset + 2] << 16) |
            (this.data[offset + 3] << 24);
    }

    public readWord(offset: number | null = null): number {
        if (offset === null) {
            offset = this.pos;
        }

        this.pos = offset + 2;
        return (this.data[offset] << 8) | (this.data[offset + 1]);
    }

    public readWordBE(offset?: number): number {
        if (offset == null) {
            offset = this.pos;
        }

        this.pos = offset + 2;
        return (this.data[offset]) |
            (this.data[offset + 1] << 8);
    }

    public readNullString(offset: number | null = null): string {
        if (offset != null) {
            this.pos = offset + this.hiddenOffset;
        }

        let result = '';

        while (this.pos < this.length) {
            const v: number = this.data[this.pos];
            this.pos++;
            if (v === 0) {
                return result;
            }
            result += String.fromCharCode(v);
        }

        return '';
    }

    public readString(length: number | null = null, offset: number | null = null): string {
        if (offset !== null) {
            this.pos = offset + this.hiddenOffset;
        }

        if (length === null) {
            length = this.length - this.getOffset();
        }

        let result = '';

        for (let i = 0; i < length; i++) {
            const v: number = this.data[this.pos];
            this.pos++;

            result += String.fromCharCode(v);
        }
        return result;
    }

    public getOffset(): number {
        return this.pos - this.hiddenOffset;
    }

    public setOffset(newPos: number): void {
        this.pos = newPos + this.hiddenOffset;
    }

    public eof(): boolean {
        const pos = this.pos - this.hiddenOffset;
        return ((pos >= this.length) || (pos < 0));
    }
}
