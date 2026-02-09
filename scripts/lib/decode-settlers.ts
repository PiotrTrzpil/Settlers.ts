import { AraCrypt } from './ara-crypt';
import { BinaryReader } from './binary-reader';

export class DecodeSettlers {
    public static getReader(source: BinaryReader, size: number, offset = -1): BinaryReader {
        const araCrypt = new AraCrypt();

        if (offset >= 0) {
            source.setOffset(offset);
        }

        const maxSize = Math.max(0, source.length - source.getOffset());
        size = Math.min(maxSize, size);

        araCrypt.reset(0x30313233, 0x34353637, 0x38393031);

        const data = new Uint8Array(size);

        for (let i = 0; i < size; i++) {
            data[i] = (source.readByte() ^ araCrypt.getNextKey()) & 0xFF;
        }

        return new BinaryReader(data);
    }
}
