import { LogHandler } from './log-handler';
import { BinaryReader } from './binary-reader';

/** Reads bits from a BinaryReader */
export class BitReader {
    private data: Uint8Array;
    private pos: number;
    private buffer: number;
    private bufferLen: number;
    private static log: LogHandler = new LogHandler('BitReader');

    constructor(fileReader: BinaryReader, offset?: number, sourceLength?: number) {
        this.data = fileReader.getBuffer(offset, sourceLength);
        this.pos = 0;

        this.buffer = 0;
        this.bufferLen = 0;

        Object.seal(this);
    }

    public getSourceOffset(): number {
        return this.pos;
    }

    public sourceLeftLength(): number {
        return Math.max(0, (this.data.length - this.pos));
    }

    public getBufferLength(): number {
        return this.bufferLen;
    }

    public resetBitBuffer(): void {
        this.pos = this.pos - (this.bufferLen >> 3);
        this.bufferLen = 0;
        this.buffer = 0;
    }

    public read(bitCount: number): number {
        if (this.bufferLen < bitCount) {
            if (this.pos >= this.data.length) {
                BitReader.log.error('Unable to read more data - End of data!');
                return 0;
            }

            const readInByte = this.data[this.pos];
            this.pos++;

            this.buffer |= (readInByte << (24 - this.bufferLen));
            this.bufferLen += 8;
        }

        const bitValue = this.buffer >>> (32 - bitCount);

        this.buffer = this.buffer << bitCount;
        this.bufferLen -= bitCount;

        return bitValue;
    }

    public eof(): boolean {
        return ((this.pos >= this.data.length) && (this.bufferLen <= 0));
    }

    public toString(): string {
        return 'pos: ' + this.pos + ' len: ' + this.data.length + ' eof?: ' + this.eof();
    }
}
