import { BinaryReader } from '../file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { ResourceFile } from './resource-file';

/**
 * Reads .sil files which contain offsets for the .snd audio archive.
 * Format based on analysis:
 * - Header (first ~28 bytes?)
 * - List of Int32LE offsets indicating the END of each audio chunk in the .snd file.
 */
export class SilFileReader extends ResourceFile {
    private static log = new LogHandler('SilFileReader');
    public offsets: number[] = [];

    constructor(resourceReader: BinaryReader) {
        super();
        this.read(resourceReader);
    }

    private read(reader: BinaryReader): void {
        const d = this.readResource(reader);

        // Based on analysis of 0.sil:
        // 0: 32771 (0x8003) - Version?
        // ...
        // 28: 6568 -> End of first file.
        // The first file starts at 28 in .snd? 
        // Let's assume the list of offsets starts at 28 in .sil?

        // In 0.sil:
        // offset 28 is the first "likely" end offset (6568).

        // Let's try reading from offset 28 until we hit zeros or end.
        // But wait, the file length of 0.sil is small.

        d.setOffset(28);
        this.offsets = [];

        // The 0.sil file seems to just be a list of 4-byte integers.
        // We know from analysis that 0.snd's first RIFF is at 28.
        // The first offset in 0.sil at 28 is 6568.
        // 6568 - 28 = 6540.
        // The chunk size was 6532 + 8 = 6540.
        // So the loop is:
        // Start = 28 (global header size of .snd?)
        // Loop:
        //   End = readNextOffset()
        //   Len = End - Start
        //   Extract(Start, Len)
        //   Start = End

        // We need to read all offsets.
        while (!d.eof()) {
            const val = d.readInt();
            if (val === 0) break; // End of list?
            this.offsets.push(val);
        }

        SilFileReader.log.debug(`Loaded ${this.offsets.length} sound offsets.`);
    }
}
