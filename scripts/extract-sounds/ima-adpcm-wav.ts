/**
 * Converts Microsoft IMA ADPCM WAV files (format tag 0x11) to 16-bit PCM WAV.
 *
 * All sound effects in Snd/0.snd use IMA ADPCM, which browsers cannot decode
 * through Web Audio, so they are converted before playback.
 */

const FORMAT_PCM = 1;
const FORMAT_IMA_ADPCM = 0x11;

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

const STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
    118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
    6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767,
];

interface WavInfo {
    format: number;
    channels: number;
    sampleRate: number;
    blockAlign: number;
    /** Samples per channel from the 'fact' chunk, if present */
    sampleCount: number | null;
    dataOffset: number;
    dataLength: number;
}

function readWavInfo(wav: Uint8Array): WavInfo | null {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    let format = 0;
    let channels = 0;
    let sampleRate = 0;
    let blockAlign = 0;
    let sampleCount: number | null = null;
    let pos = 12; // after "RIFF" <size> "WAVE"
    while (pos + 8 <= wav.length) {
        const id = String.fromCharCode(wav[pos]!, wav[pos + 1]!, wav[pos + 2]!, wav[pos + 3]!);
        const size = view.getUint32(pos + 4, true);
        const body = pos + 8;
        if (id === 'fmt ') {
            format = view.getUint16(body, true);
            channels = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            blockAlign = view.getUint16(body + 12, true);
        } else if (id === 'fact') {
            sampleCount = view.getUint32(body, true);
        } else if (id === 'data') {
            const dataLength = Math.min(size, wav.length - body);
            return { format, channels, sampleRate, blockAlign, sampleCount, dataOffset: body, dataLength };
        }
        pos = body + size + (size & 1);
    }
    return null;
}

/** Per-channel decoder state. */
class ImaChannel {
    constructor(
        public predictor: number,
        public index: number
    ) {}

    decode(nibble: number): number {
        const step = STEP_TABLE[this.index]!;
        let diff = step >> 3;
        if (nibble & 1) {
            diff += step >> 2;
        }
        if (nibble & 2) {
            diff += step >> 1;
        }
        if (nibble & 4) {
            diff += step;
        }
        this.predictor += nibble & 8 ? -diff : diff;
        this.predictor = Math.max(-32768, Math.min(32767, this.predictor));
        this.index = Math.max(0, Math.min(88, this.index + INDEX_TABLE[nibble]!));
        return this.predictor;
    }
}

/**
 * Decode one block into `out` (interleaved), starting at frame `firstFrame`.
 * Block layout: per-channel 4-byte header, then 4-byte groups (8 samples) per channel, interleaved.
 * Returns the number of frames written.
 */
function decodeBlock(
    data: Uint8Array,
    start: number,
    end: number,
    ch: number,
    out: Int16Array,
    firstFrame: number
): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const maxFrames = out.length / ch - firstFrame;
    const states: ImaChannel[] = [];
    for (let c = 0; c < ch; c++) {
        const h = start + c * 4;
        states.push(new ImaChannel(view.getInt16(h, true), Math.min(88, data[h + 2]!)));
        out[firstFrame * ch + c] = states[c]!.predictor;
    }
    let frames = 1;
    for (let pos = start + 4 * ch; pos + 4 * ch <= end && frames < maxFrames; pos += 4 * ch) {
        for (let c = 0; c < ch; c++) {
            const group = pos + c * 4;
            for (let i = 0; i < 8 && frames + i < maxFrames; i++) {
                const byte = data[group + (i >> 1)]!;
                const nibble = i & 1 ? byte >> 4 : byte & 0x0f;
                out[(firstFrame + frames + i) * ch + c] = states[c]!.decode(nibble);
            }
        }
        frames += 8;
    }
    return Math.min(frames, maxFrames);
}

function encodePcmWav(samples: Int16Array, channels: number, sampleRate: number): Uint8Array {
    const dataBytes = samples.length * 2;
    const out = new Uint8Array(44 + dataBytes);
    const view = new DataView(out.buffer);
    const ascii = (pos: number, s: string) => Array.from(s, (c, i) => (out[pos + i] = c.charCodeAt(0)));
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, FORMAT_PCM, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < samples.length; i++) {
        view.setInt16(44 + i * 2, samples[i]!, true);
    }
    return out;
}

/**
 * Return a browser-playable WAV: IMA ADPCM is decoded to 16-bit PCM, anything else is returned unchanged.
 */
export function toPlayableWav(wav: Uint8Array): Uint8Array {
    const info = readWavInfo(wav);
    if (!info || info.format !== FORMAT_IMA_ADPCM || info.channels < 1 || info.blockAlign < 4 * info.channels) {
        return wav;
    }
    const { channels: ch, blockAlign } = info;
    const blocks = Math.ceil(info.dataLength / blockAlign);
    const framesPerBlock = ((blockAlign - 4 * ch) * 2) / ch + 1;
    // 'fact' chunk is optional in WAV; full blocks is the correct upper bound
    const totalFrames = info.sampleCount ?? blocks * framesPerBlock;
    const samples = new Int16Array(totalFrames * ch);

    let frame = 0;
    for (let b = 0; b < blocks && frame < totalFrames; b++) {
        const start = info.dataOffset + b * blockAlign;
        const end = Math.min(start + blockAlign, info.dataOffset + info.dataLength);
        if (end - start < 4 * ch) {
            break;
        }
        frame += decodeBlock(wav, start, end, ch, samples, frame);
    }
    return encodePcmWav(frame < totalFrames ? samples.subarray(0, frame * ch) : samples, ch, info.sampleRate);
}
