/**
 * Unit tests for the .sil/.snd sound archive readers, using a small synthetic archive
 * with the same layout as Snd/0.sil + Snd/0.snd.
 */

import { describe, it, expect } from 'vitest';
import { BinaryReader } from '@/resources/file/binary-reader';
import { SilFileReader } from '@/resources/gfx/sil-file-reader';
import { SndFileReader } from '@/resources/gfx/snd-file-reader';

const HEADER_SIZE = 20;

function int32(value: number): number[] {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function fakeWav(marker: number): number[] {
    const riff = [0x52, 0x49, 0x46, 0x46];
    return [...riff, ...int32(4), marker, marker, marker, marker];
}

/** Build .sil + .snd bytes; `null` entries become empty slots. */
function buildArchive(wavs: (number[] | null)[]): { sil: Uint8Array; snd: Uint8Array } {
    const snd: number[] = Array.from({ length: HEADER_SIZE }, () => 0);
    const offsets: number[] = [];
    for (const wav of wavs) {
        if (!wav) {
            offsets.push(0);
            continue;
        }
        offsets.push(snd.length);
        snd.push(...int32(1), ...int32(wav.length), ...wav);
    }
    const sil = [...Array.from({ length: HEADER_SIZE }, () => 0), ...offsets.flatMap(int32)];
    return { sil: new Uint8Array(sil), snd: new Uint8Array(snd) };
}

function openArchive(wavs: (number[] | null)[]): SndFileReader {
    const { sil, snd } = buildArchive(wavs);
    return new SndFileReader(new BinaryReader(snd), new SilFileReader(new BinaryReader(sil)));
}

describe('SilFileReader / SndFileReader', () => {
    it('reads every slot offset after the resource header', () => {
        const { sil } = buildArchive([null, fakeWav(1), fakeWav(2)]);
        expect(new SilFileReader(new BinaryReader(sil)).offsets).toEqual([0, 20, 40]);
    });

    it('extracts the WAV of each slot, skipping the 8-byte entry prefix', () => {
        const archive = openArchive([null, fakeWav(7), fakeWav(9)]);
        expect(archive.count).toBe(3);
        expect([...archive.getWav(1)!]).toEqual(fakeWav(7));
        expect([...archive.getWav(2)!]).toEqual(fakeWav(9));
    });

    it('returns null for empty, out-of-range and non-RIFF slots', () => {
        const archive = openArchive([null, fakeWav(1), [0, 1, 2, 3]]);
        expect(archive.getWav(0)).toBeNull();
        expect(archive.getWav(-1)).toBeNull();
        expect(archive.getWav(3)).toBeNull();
        expect(archive.getWav(2)).toBeNull();
    });
});
