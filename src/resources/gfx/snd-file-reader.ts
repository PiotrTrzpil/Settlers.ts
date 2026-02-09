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

    /** Cache of blob URLs to prevent memory leaks from repeated createObjectURL calls */
    private blobUrlCache: Map<number, string> = new Map();

    constructor(resourceReader: BinaryReader, sil: SilFileReader) {
        super();
        this.sil = sil;
        this.data = this.readResource(resourceReader);
    }

    /**
     * Release all cached blob URLs to free memory.
     * Call this when unloading the sound archive.
     */
    public dispose(): void {
        for (const url of this.blobUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.blobUrlCache.clear();
        this.data = null;
        this.sil = null;
        SndFileReader.log.debug('Disposed SndFileReader and revoked blob URLs');
    }

    /**
     * Extract a specific sound index as a Blob URL (for Howler).
     * URLs are cached to prevent memory leaks.
     */
    public getSound(index: number): string | null {
        if (!this.data || !this.sil || index < 0 || index >= this.sil.offsets.length) {
            return null;
        }

        // Return cached URL if available
        const cached = this.blobUrlCache.get(index);
        if (cached) {
            return cached;
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
            const url = URL.createObjectURL(blob);
            this.blobUrlCache.set(index, url);
            return url;
        } else {
            SndFileReader.log.warn(`Sound ${index} does not have RIFF header`);
            return null;
        }
    }

    /** Get the number of sounds in the archive */
    public get count(): number {
        return this.sil?.offsets.length ?? 0;
    }
}
