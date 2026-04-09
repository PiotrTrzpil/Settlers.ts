/**
 * Shared frame analysis, phase correlation, and displacement detection.
 * Used by both generate-frame-corrections.ts and debug-frame.ts.
 */
import { writeFileSync } from 'fs';

// ── Constants ─────────────────────────────────────────────────────────

export const BORDER_WIDTH = 3;

/** Min border-pixel excess (vs frame 0) to trigger the border-anomaly path. */
export const MIN_BORDER_SPIKE = 8;

/**
 * Min interior gap excess (vs median across frames) to flag a split.
 * Must be high enough to avoid false positives from extending limbs/weapons
 * (which increase gap by ~10-15px) while catching true wrap-around (gap 20+).
 * Also used for gap collapse detection (gap decreasing by this amount).
 */
export const MIN_SPLIT_GAP_EXCESS = 15;

// ── Types ─────────────────────────────────────────────────────────────

export interface FrameInfo {
    index: number;
    width: number;
    height: number;
    opaquePixels: number;
    /** Grayscale luminance sum per column */
    colGray: number[];
    /** Grayscale luminance sum per row */
    rowGray: number[];
    leftBorderPixels: number;
    rightBorderPixels: number;
    topBorderPixels: number;
    bottomBorderPixels: number;
    /** Largest interior horizontal gap in the alpha mask (wrap-around signal) */
    hGap: number;
    /** Opaque centroid X */
    centroidX: number;
    /** Opaque centroid Y (for dy estimation when row profiles are unreliable) */
    centroidY: number;
}

export interface MeasureResult {
    dx: number;
    dy: number;
    rawDx: number;
    rawDy: number;
    centroidDy: number;
    dySource: 'centroid' | 'phase';
    hasBorderAnomaly: boolean;
    hasHSplit: boolean;
    hasGapCollapse: boolean;
    signFlipped: boolean;
}

// ── Frame analysis ────────────────────────────────────────────────────

// eslint-disable-next-line sonarjs/cognitive-complexity -- pixel-level analysis with multiple metrics
export function computeFrameInfo(
    image: { width: number; height: number; getImageData(): ImageData },
    frameIndex: number
): FrameInfo {
    const imgData = image.getImageData();
    const rgba = imgData.data;
    const { width, height } = image;
    const colGray = new Array<number>(width).fill(0);
    const rowGray = new Array<number>(height).fill(0);
    const colHasOpaque = new Uint8Array(width);
    let count = 0,
        sumX = 0,
        sumY = 0;
    let leftBorder = 0,
        rightBorder = 0,
        topBorder = 0,
        bottomBorder = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (rgba[i + 3]! > 0) {
                const lum = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
                colGray[x] = colGray[x]! + lum;
                rowGray[y] = rowGray[y]! + lum;
                colHasOpaque[x] = 1;
                count++;
                sumX += x;
                sumY += y;
                if (x < BORDER_WIDTH) leftBorder++;
                if (x >= width - BORDER_WIDTH) rightBorder++;
                if (y < BORDER_WIDTH) topBorder++;
                if (y >= height - BORDER_WIDTH) bottomBorder++;
            }
        }
    }

    const hGap = findLargestInteriorGap(colHasOpaque);

    return {
        index: frameIndex,
        width,
        height,
        opaquePixels: count,
        colGray,
        rowGray,
        leftBorderPixels: leftBorder,
        rightBorderPixels: rightBorder,
        topBorderPixels: topBorder,
        bottomBorderPixels: bottomBorder,
        hGap,
        centroidX: count > 0 ? sumX / count : 0,
        centroidY: count > 0 ? sumY / count : 0,
    };
}

/** Find the largest interior transparent gap in a 1D occupancy array. */
function findLargestInteriorGap(occupancy: Uint8Array): number {
    const n = occupancy.length;
    let first = -1,
        last = -1;
    for (let i = 0; i < n; i++) {
        if (occupancy[i]!) {
            if (first < 0) first = i;
            last = i;
        }
    }
    if (first < 0 || first === last) return 0;

    let maxGap = 0,
        gapStart = -1;
    for (let i = first; i <= last; i++) {
        if (!occupancy[i]!) {
            if (gapStart < 0) gapStart = i;
        } else if (gapStart >= 0) {
            maxGap = Math.max(maxGap, i - gapStart);
            gapStart = -1;
        }
    }
    return maxGap;
}

// ── Phase correlation ─────────────────────────────────────────────────

/** Forward DFT of a real signal. O(N²) but N is small (sprite width ~50-160). */
function dft(signal: number[]): { re: number; im: number }[] {
    const N = signal.length;
    return Array.from({ length: N }, (_, k) => {
        let re = 0,
            im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (-2 * Math.PI * k * n) / N;
            re += signal[n]! * Math.cos(angle);
            im += signal[n]! * Math.sin(angle);
        }
        return { re, im };
    });
}

/** Inverse DFT → real signal. */
function idft(spectrum: { re: number; im: number }[]): number[] {
    const N = spectrum.length;
    return Array.from({ length: N }, (_, n) => {
        let re = 0;
        for (let k = 0; k < N; k++) {
            const angle = (2 * Math.PI * k * n) / N;
            re += spectrum[k]!.re * Math.cos(angle) - spectrum[k]!.im * Math.sin(angle);
        }
        return re / N;
    });
}

/**
 * Phase correlation on 1D grayscale density profiles.
 * Returns the cyclic shift (correction dx) that best aligns B back to A.
 * Uses magnitude-normalized cross-power spectrum → robust to pose changes.
 */
export function phaseCorrelationShift(a: number[], b: number[]): number {
    const A = dft(a);
    const B = dft(b);
    const N = A.length;
    const cp: { re: number; im: number }[] = [];
    for (let k = 0; k < N; k++) {
        const re = A[k]!.re * B[k]!.re + A[k]!.im * B[k]!.im;
        const im = A[k]!.im * B[k]!.re - A[k]!.re * B[k]!.im;
        const mag = Math.sqrt(re * re + im * im);
        cp.push(mag > 1e-10 ? { re: re / mag, im: im / mag } : { re: 0, im: 0 });
    }
    const result = idft(cp);
    let bestIdx = 0;
    for (let i = 1; i < N; i++) {
        if (result[i]! > result[bestIdx]!) bestIdx = i;
    }
    return bestIdx > N / 2 ? bestIdx - N : bestIdx;
}

// ── Detection / measurement ───────────────────────────────────────────

/**
 * Measure displacement of a single frame relative to baseline (f0).
 * Returns null if the frame shows no evidence of displacement.
 */
export function measureFrame(
    f0: FrameInfo,
    curr: FrameInfo,
    medianHGap: number,
    medianCentroidY: number
): MeasureResult | null {
    if (curr.opaquePixels < 50) return null;

    const leftExcess = curr.leftBorderPixels - f0.leftBorderPixels;
    const rightExcess = curr.rightBorderPixels - f0.rightBorderPixels;
    // Large opaque pixel increase means new content (spell effects, etc.) — not displacement
    const opaqueRatio = curr.opaquePixels / f0.opaquePixels;
    const hasBorderAnomaly = opaqueRatio < 1.5 && (leftExcess >= MIN_BORDER_SPIKE || rightExcess >= MIN_BORDER_SPIKE);
    const hasHSplit = curr.hGap > medianHGap + MIN_SPLIT_GAP_EXCESS;
    // Gap collapse: gap shrinking dramatically signals wrap-around filling the gap.
    const hasGapCollapse =
        medianHGap > MIN_SPLIT_GAP_EXCESS && curr.hGap < medianHGap - MIN_SPLIT_GAP_EXCESS && opaqueRatio < 1.5;
    const hasEvidence = hasBorderAnomaly || hasHSplit || hasGapCollapse;
    if (!hasEvidence) return null;

    const rawDx = phaseCorrelationShift(f0.colGray, curr.colGray);
    const rawDy = phaseCorrelationShift(f0.rowGray, curr.rowGray);
    const centroidDy = Math.round(medianCentroidY - curr.centroidY);

    // Border evidence determines correction direction: cyclicShiftRegion uses
    // srcX = (((x - dx) % w) + w) % w, so positive dx shifts content RIGHT.
    // If left border grew more → content displaced left → need positive dx to fix.
    let dx = rawDx;
    let signFlipped = false;
    if (hasBorderAnomaly && Math.abs(dx) >= 5) {
        const netBorderShift = leftExcess - rightExcess;
        if ((netBorderShift > 0 && dx < 0) || (netBorderShift < 0 && dx > 0)) {
            dx = -dx;
            signFlipped = true;
        }
    }

    // dy: phase correlation on row profiles is UNRELIABLE when the frame has a
    // horizontal wrap-around (content redistributed across rows non-cyclically).
    // Use centroid-based dy estimate in that case.
    let dy: number;
    let dySource: 'centroid' | 'phase';
    if ((hasBorderAnomaly || hasHSplit || hasGapCollapse) && Math.abs(dx) >= 5) {
        dy = centroidDy;
        dySource = 'centroid';
    } else {
        dy = rawDy;
        dySource = 'phase';
    }

    return { dx, dy, rawDx, rawDy, centroidDy, dySource, hasBorderAnomaly, hasHSplit, hasGapCollapse, signFlipped };
}

/**
 * Compute median of a numeric array (mutates via sort).
 */
export function median(values: number[]): number {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
}

// ── BMP writer ────────────────────────────────────────────────────────

export function writeBmp(path: string, rgba: Uint8ClampedArray, w: number, h: number): void {
    const pixelSize = w * 4 * h,
        headerSize = 54;
    const buf = Buffer.alloc(headerSize + pixelSize);
    buf.write('BM', 0);
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(headerSize, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(32, 28);
    buf.writeUInt32LE(pixelSize, 34);
    for (let y = 0; y < h; y++) {
        const bmpRow = h - 1 - y;
        for (let x = 0; x < w; x++) {
            const si = (y * w + x) * 4,
                di = headerSize + (bmpRow * w + x) * 4;
            const a = rgba[si + 3]!;
            buf[di] = a > 0 ? rgba[si + 2]! : 255;
            buf[di + 1] = a > 0 ? rgba[si + 1]! : 0;
            buf[di + 2] = a > 0 ? rgba[si]! : 255;
            buf[di + 3] = 255;
        }
    }
    writeFileSync(path, buf);
}
