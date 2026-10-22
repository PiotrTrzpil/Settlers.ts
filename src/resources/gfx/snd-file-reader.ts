import { BinaryReader } from '../file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { SilFileReader } from './sil-file-reader';

const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];

/**
 * Reads .snd sound archives (sound effects). Used by `pnpm sounds:extract`.
 *
 * Each slot listed in the companion .sil file points to an entry of the form:
 *   int32 count (always 1 in the shipped archive)
 *   int32 size
 *   `size` bytes of a complete WAV file (RIFF header included)
 */
export class SndFileReader {
    private static log = new LogHandler('SndFileReader');
    private readonly data: BinaryReader;
    private readonly sil: SilFileReader;

    constructor(sndFile: BinaryReader, sil: SilFileReader) {
        this.data = sndFile;
        this.sil = sil;
    }

    /** Extract the raw WAV bytes of a slot, or null if the slot is empty/invalid. */
    public getWav(slot: number): Uint8Array | null {
        if (slot < 0 || slot >= this.sil.offsets.length) {
            return null;
        }
        const offset = this.sil.offsets[slot]!;
        if (offset === 0) {
            return null;
        }

        this.data.setOffset(offset + 4);
        const size = this.data.readInt();
        if (size <= 0 || offset + 8 + size > this.data.length) {
            SndFileReader.log.warn(`Invalid sound slot ${slot}: size ${size} at offset ${offset}`);
            return null;
        }

        const wav = this.data.getBuffer(offset + 8, size);
        if (!RIFF_MAGIC.every((b, i) => wav[i] === b)) {
            SndFileReader.log.warn(`Sound slot ${slot} does not have a RIFF header`);
            return null;
        }
        return wav;
    }

    /** Number of slots in the archive (including empty ones) */
    public get count(): number {
        return this.sil.offsets.length;
    }
}
