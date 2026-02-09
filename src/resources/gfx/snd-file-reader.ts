import { BinaryReader } from '../file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { ResourceFile } from './resource-file';
import { SilFileReader } from './sil-file-reader';

/**
 * Reads .snd files which contain concatenated WAV files.
 */
export class SndFileReader extends ResourceFile {
    private static log = new LogHandler('SndFileReader');
    private data: BinaryReader | null = null;
    private sil: SilFileReader | null = null;

    constructor(resourceReader: BinaryReader, sil: SilFileReader) {
        super();
        this.sil = sil;
        this.data = this.readResource(resourceReader);
    }

    /**
     * Extract a specific sound index as a Blob URL (for Howler).
     */
    public getSound(index: number): string | null {
        if (!this.data || !this.sil || index < 0 || index >= this.sil.offsets.length) {
            return null;
        }

        // Determine Start and End
        // First file starts at 28 (header of .snd)
        // Subsequent files start where the previous one ended.

        let start = 28;
        if (index > 0) {
            start = this.sil.offsets[index - 1];
        }

        const end = this.sil.offsets[index];
        const length = end - start;

        if (length <= 0) {
            SndFileReader.log.warn(`Invalid length for sound ${index}: ${length} (Start: ${start}, End: ${end})`);
            return null;
        }

        const buffer = this.data.getBuffer(start, length);

        // The buffer should already be a valid WAV file including RIFF header
        // We verify the header "RIFF" just in case
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
            // Cast to any to avoid strict ArrayBufferLike issues with Blob constructor in some TS configs
            const blob = new Blob([buffer as any], { type: 'audio/wav' });
            return URL.createObjectURL(blob);
        } else {
            SndFileReader.log.warn(`Sound ${index} does not have RIFF header`);
            return null;
        }
    }
}
