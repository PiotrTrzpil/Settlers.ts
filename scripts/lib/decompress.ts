import { LogHandler } from './log-handler';
import { BinaryReader } from './binary-reader';
import { BitReader } from './bit-reader';
import { IndexValueTable, Packer } from './packer';
import { StreamWriter } from './stream-writer';

/** Lz + Huffman decompressing */
export class Decompress extends Packer {
    private static log: LogHandler = new LogHandler('Decompress');

    constructor() {
        super();
        Object.seal(this);
    }

    private buildNewHuffmanTable(inData: BitReader): IndexValueTable {
        const newIndex: number[] = [];
        const newValues: number[] = [];
        let base = 0;
        let length = 0;

        for (let i = 0; i < 16; i++) {
            length--;
            let bitValue = 0;
            do {
                length++;
                bitValue = inData.read(1);
            } while (bitValue === 0);

            newIndex.push(length);
            newValues.push(base);
            base += (1 << length);
        }

        return new IndexValueTable(newIndex, newValues);
    }

    private handleEndOfStream(inData: BitReader, writer: StreamWriter): 'done' | 'continue' | 'error' {
        if (inData.sourceLeftLength() > 2) {
            if (writer.eof()) {
                Decompress.log.error(
                    `End-of-stream but Data buffer is not empty (${inData.sourceLeftLength()} IN bytes left; ${writer.getLeftSize()} OUT bytes left)? Out of sync!`
                );
                return 'error';
            }
            inData.resetBitBuffer();
            return 'continue';
        }

        if (!writer.eof()) {
            Decompress.log.error(
                `Done decompress (${inData.sourceLeftLength()} IN bytes left; ${writer.getLeftSize()} OUT bytes left)!`
            );
        }
        return 'done';
    }

    public unpack(inDataSrc: BinaryReader, inOffset: number, inLength: number, outLength: number): BinaryReader {
        const inData = new BitReader(inDataSrc, inOffset, inLength);
        const writer = new StreamWriter(outLength);
        let huffmanTable = Packer.DefaultHuffmanTable;
        let done = false;
        const codeTable = Packer.createSymbolDirectory();

        while (!inData.eof()) {
            const codeType = inData.read(4);
            if (codeType < 0) {
                Decompress.log.error('CodeType == 0 -> out of sync!');
                break;
            }

            const codeWordLength = huffmanTable.index[codeType];
            let codeWordIndex = huffmanTable.value[codeType];

            if (codeWordLength > 0) {
                codeWordIndex += inData.read(codeWordLength);
                if (codeWordIndex >= 0x0112) {
                    Decompress.log.error('CodeType(' + codeWordIndex + ') >= 0x0112 -> out of sync!');
                    break;
                }
            }

            const codeWord = codeTable.codeTable[codeWordIndex];
            codeTable.inc(codeWord);

            if (codeWord < 0x0100) {
                if (writer.eof()) { Decompress.log.error('OutBuffer is to small!'); break }
                writer.setByte(codeWord);
            } else if (codeWord === 0x110) {
                codeTable.generateCodes();
                huffmanTable = this.buildNewHuffmanTable(inData);
            } else if (codeWord === 0x0111) {
                const result = this.handleEndOfStream(inData, writer);
                if (result === 'done') { done = true; break }
                if (result === 'error') break;
            } else if (!this.fromDictionary(inData, writer, codeWord)) {
                Decompress.log.error('Bad dictionary entry!');
                break;
            }
        }

        if (!done) {
            Decompress.log.error('Unexpected End of Data in ' + inDataSrc.filename + ' eof: ' + inData.toString());
        }

        return writer.getReader();
    }

    private fromDictionary(inData: BitReader, writer: StreamWriter, codeWord: number): boolean {
        let entryLength = 4;

        if (codeWord < 0x108) {
            entryLength += codeWord - 0x0100;
        } else {
            const index = codeWord - 0x0108;
            const bitCount = Packer.LengthTable.index[index];
            const readInByte = inData.read(bitCount);
            entryLength += Packer.LengthTable.value[index] + readInByte;
        }

        const distanceIndex = inData.read(3);
        const distanceLength = Packer.DistanceTable.index[distanceIndex] + 1;
        const baseValue = Packer.DistanceTable.value[distanceIndex];

        const base = inData.read(8);
        const offsetValue = inData.read(distanceLength);

        if (writer.getWriteOffset() + entryLength > writer.getLength()) {
            Decompress.log.error('Out buffer is to small!');
            return false;
        }

        let srcPos = writer.getWriteOffset() - ((offsetValue | (base << distanceLength)) + (baseValue << 9));

        for (let i = entryLength; i > 0; i--) {
            writer.setByte(writer.getByte(srcPos));
            srcPos++;
        }

        return true;
    }
}
