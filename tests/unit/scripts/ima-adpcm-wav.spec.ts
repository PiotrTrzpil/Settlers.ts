/**
 * Unit tests for the IMA ADPCM → PCM WAV converter used for Snd/0.snd sound effects.
 * (Verified separately to match ffmpeg's adpcm_ima_wav decoder sample-for-sample on the real archive.)
 */

import { describe, it, expect } from 'vitest';
import { toPlayableWav } from '../../../scripts/extract-sounds/ima-adpcm-wav';

function u16(v: number): number[] {
    return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v: number): number[] {
    return [...u16(v & 0xffff), ...u16(v >>> 16)];
}
function ascii(s: string): number[] {
    return Array.from(s, c => c.charCodeAt(0));
}

/** Build a RIFF WAV with the given fmt fields, optional fact count and data bytes. */
function wav(opts: {
    format: number;
    channels: number;
    blockAlign: number;
    fact?: number;
    data: number[];
}): Uint8Array {
    const fmt = [
        ...u16(opts.format),
        ...u16(opts.channels),
        ...u32(22050),
        ...u32(0),
        ...u16(opts.blockAlign),
        ...u16(4),
    ];
    const fact = opts.fact === undefined ? [] : [...ascii('fact'), ...u32(4), ...u32(opts.fact)];
    const body = [...ascii('WAVE'), ...ascii('fmt '), ...u32(fmt.length), ...fmt, ...fact];
    body.push(...ascii('data'), ...u32(opts.data.length), ...opts.data);
    return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
}

function pcmSamples(out: Uint8Array): number[] {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    const bytes = view.getUint32(40, true);
    return Array.from({ length: bytes / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
}

describe('toPlayableWav', () => {
    it('decodes a mono block: header sample, then low nibble before high nibble', () => {
        // predictor 0, index 0 (step 7). Nibble 4 → +7 (index 2, step 9); nibble 0 → +1 (9>>3).
        const data = [...u16(0), 0, 0, 0x04, 0, 0, 0];
        const out = toPlayableWav(wav({ format: 0x11, channels: 1, blockAlign: 8, fact: 3, data }));
        expect(pcmSamples(out)).toEqual([0, 7, 8]);
    });

    it('decodes stereo blocks with 4-byte groups interleaved per channel', () => {
        const data = [...u16(100), 0, 0, ...u16(-100 & 0xffff), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const out = toPlayableWav(wav({ format: 0x11, channels: 2, blockAlign: 16, fact: 3, data }));
        expect(pcmSamples(out)).toEqual([100, -100, 100, -100, 100, -100]);
    });

    it('stops at the fact sample count across multiple blocks', () => {
        const block = [...u16(5), 0, 0, 0, 0, 0, 0];
        const out = toPlayableWav(
            wav({ format: 0x11, channels: 1, blockAlign: 8, fact: 11, data: [...block, ...block] })
        );
        expect(pcmSamples(out)).toHaveLength(11);
    });

    it('returns non-ADPCM files unchanged', () => {
        const pcm = wav({ format: 1, channels: 1, blockAlign: 2, data: [1, 0, 2, 0] });
        expect(toPlayableWav(pcm)).toBe(pcm);
    });
});
