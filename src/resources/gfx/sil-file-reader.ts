import { BinaryReader } from '../file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { ResourceFile } from './resource-file';

/**
 * Reads .sil files: the slot index for a .snd sound archive.
 *
 * Layout: the standard 20-byte resource header, followed by one little-endian
 * int32 per sound slot. Each value is the absolute byte offset of that slot's
 * entry in the .snd file, or 0 when the slot is empty (slot 0 is always empty).
 */
export class SilFileReader extends ResourceFile {
    private static log = new LogHandler('SilFileReader');
    /** Absolute .snd file offset per slot (0 = empty slot). */
    public offsets: number[] = [];

    constructor(resourceReader: BinaryReader) {
        super();
        const payload = this.readResource(resourceReader);
        while (!payload.eof()) {
            this.offsets.push(payload.readInt());
        }
        SilFileReader.log.debug(`Loaded ${this.offsets.length} sound slots.`);
    }
}
